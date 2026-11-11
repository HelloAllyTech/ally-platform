import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  CL_AGENT_CANDIDATE_MAX_WAIT_HOURS,
  CL_AGENT_CANDIDATES_PER_PASS,
  CL_AGENT_CURATE_LOCK_TTL_SECONDS,
} from '../constants/context-library.constants';
import { ClChunk } from '../entity/cl-chunk.entity';
import { ClCollection } from '../entity/cl-collection.entity';
import {
  ClChunkOrigin,
  ClChunkStatus,
  ClLoop,
  ClLoopActionType,
} from '../enum/context-library.enum';
import { COLLECTION_PROFILES, CollectionProfile } from '../profiles';
import {
  CuratorOperation,
  agentEvidenceScore,
  agentRetirementDecision,
  mergeLabels,
  normaliseLabels,
  parseCuratorOperations,
} from '../util/agent-curator.util';
import { ContextChunkService } from './context-chunk.service';
import { ContextLlmService } from './context-llm.service';
import { ContextLoopActionsService } from './context-loop-actions.service';

export const CL_AGENT_CURATE_TASK = 'context-library-agent-curate';
const LOCK_PREFIX = 'cl-agent-curate:';

export interface AgentCurationResult {
  collectionId: string;
  considered: number;
  applied: number;
  skipped: string | null;
}

/** Evidence lists kept in `attributes`; agreeing chunks pool theirs. */
const EVIDENCE_ATTRIBUTES = ['sessionIds', 'runIds', 'findingIds'];

/**
 * The agent curator (PLAN §6.3, §8): keeps each agent-written collection — Builder Lessons, Bug
 * Hunter Notes — a curated set rather than an append-only log.
 *
 * **Hourly, the ExpeL pass.** The candidates an agent wrote are folded into the active set by a
 * fast model answering one operation per candidate: AGREE with an active chunk (the candidate is
 * superseded and the agreement counted in `sourceCount`), EDIT a chunk to be more precise, ADD
 * the candidate as new, or REMOVE a chunk it makes stale. Generalised from Builder's lesson
 * curator and the agent-memory curator, with their guardrails in code, not in the prompt:
 *  - pinned chunks, and anything a person wrote, are never edited or removed;
 *  - at most `maxActiveChangesPerPass` edits or removals of already-active chunks per pass;
 *  - a candidate the model says nothing about is added rather than left unseen, and when the
 *    model is unavailable every candidate is added uncurated — an untidy set beats a lost lesson;
 *  - the active cap is enforced after every pass by evidence, pinned and written chunks exempt;
 *  - an admin's Undo is respected: the curator never repeats an undone change on that chunk.
 *
 * **Nightly, usage-based retirement** (called from the learning loops): a chunk contradicted more
 * often than applied, or never applied across enough runs that reported what they used, is
 * archived. Replaces Bug Hunter's own note-retirement pass.
 *
 * Every change is a `cl_loop_actions` row with the state Undo restores.
 */
@Injectable()
export class ContextAgentCuratorService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    ContextAgentCuratorService.name,
  );

  constructor(
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
    @InjectRepository(ClCollection)
    private readonly collections: Repository<ClCollection>,
    private readonly llm: ContextLlmService,
    private readonly actions: ContextLoopActionsService,
    private readonly chunkService: ContextChunkService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    // Hourly: a sweep writes at 2am and its notes should be searchable by the next one. No-ops
    // on one indexed query per collection when nothing is new.
    scheduledTaskRegistry.register('hourly', CL_AGENT_CURATE_TASK, () =>
      this.curateAll().then(() => undefined),
    );
  }

  /** Profiles of the collections agents write to. */
  static agentProfiles(): CollectionProfile[] {
    return Object.values(COLLECTION_PROFILES).filter(
      (p): p is CollectionProfile => Boolean(p?.agentCuration),
    );
  }

  async curateAll(force = false): Promise<AgentCurationResult[]> {
    const results: AgentCurationResult[] = [];
    for (const profile of ContextAgentCuratorService.agentProfiles()) {
      try {
        results.push(await this.curate(profile.id, force));
      } catch (error) {
        this.logger.warn(
          `Agent curation for ${profile.id} failed: ${(error as Error).message}`,
        );
      }
    }
    return results;
  }

  /** One collection's pass, one pod at a time. */
  async curate(
    collectionId: string,
    force = false,
  ): Promise<AgentCurationResult> {
    const profile = COLLECTION_PROFILES[
      collectionId as keyof typeof COLLECTION_PROFILES
    ] as CollectionProfile | undefined;
    if (!profile?.agentCuration) {
      return {
        collectionId,
        considered: 0,
        applied: 0,
        skipped: 'not an agent collection',
      };
    }
    const collection = await this.collections.findOne({
      where: { id: collectionId },
    });
    if (!collection || collection.status !== 'active') {
      return {
        collectionId,
        considered: 0,
        applied: 0,
        skipped: 'collection not active',
      };
    }
    if ((collection.loopSettings?.paused ?? []).includes(ClLoop.CURATOR)) {
      return {
        collectionId,
        considered: 0,
        applied: 0,
        skipped: 'curator paused in Settings',
      };
    }
    const lock = `${LOCK_PREFIX}${collectionId}`;
    if (
      !(await this.redis.acquireLock(lock, CL_AGENT_CURATE_LOCK_TTL_SECONDS))
    ) {
      return {
        collectionId,
        considered: 0,
        applied: 0,
        skipped: 'another pod is curating',
      };
    }
    try {
      return await this.curateLocked(profile, force);
    } finally {
      await this.redis.releaseLock(lock).catch(() => undefined);
    }
  }

  private async curateLocked(
    profile: CollectionProfile,
    force: boolean,
  ): Promise<AgentCurationResult> {
    const spec = profile.agentCuration!;
    const candidates = await this.chunks.find({
      where: { collectionId: profile.id, status: ClChunkStatus.CANDIDATE },
      order: { createdAt: 'ASC' },
      take: CL_AGENT_CANDIDATES_PER_PASS,
    });
    const result = (applied: number, skipped: string | null) => ({
      collectionId: profile.id,
      considered: candidates.length,
      applied,
      skipped,
    });
    // The cap is enforced every pass, not only when there is new material: an admin pinning or
    // restoring entries can push the active set over it.
    if (!candidates.length) {
      await this.enforceCap(profile);
      return result(0, 'nothing new');
    }
    const oldestHours =
      (Date.now() - new Date(candidates[0].createdAt).getTime()) / 3_600_000;
    if (
      !force &&
      candidates.length < spec.candidateTrigger &&
      oldestHours < CL_AGENT_CANDIDATE_MAX_WAIT_HOURS
    ) {
      // Curating one note at a time would spend a model call to decide almost nothing; they
      // wait for a batch, but never longer than a day.
      await this.enforceCap(profile);
      return result(0, 'below the batch threshold');
    }

    const active = await this.chunks.find({
      where: { collectionId: profile.id, status: ClChunkStatus.ACTIVE },
      order: { createdAt: 'ASC' },
    });

    let operations: CuratorOperation[];
    let fallback: string | null = null;
    try {
      const { value } = await this.llm.agentCurate<{ operations?: unknown }>(
        this.renderRequest(profile, candidates, active),
      );
      operations = parseCuratorOperations(value);
    } catch (error) {
      this.logger.warn(
        `Agent curation (${profile.id}) could not ask the model: ${(error as Error).message}`,
      );
      operations = [];
      fallback = 'the curator model was unavailable';
    }

    const applied = await this.apply(
      profile,
      operations,
      candidates,
      active,
      fallback,
    );
    await this.enforceCap(profile);
    this.logger.info(
      `Agent curation (${profile.id}): ${candidates.length} candidate(s), ${applied} operation(s) applied.`,
    );
    return result(applied, fallback ? `${fallback} — added uncurated` : null);
  }

  /** The user message: what the collection is, then the active set, then the candidates. */
  private renderRequest(
    profile: CollectionProfile,
    candidates: ClChunk[],
    active: ClChunk[],
  ): string {
    const categoryKey = profile.agentCuration!.categoryFacet;
    const categories = categoryKey
      ? profile.facets[categoryKey]?.values
      : undefined;
    const line = (c: ClChunk) => {
      const repos = Array.isArray(c.facets?.repos)
        ? (c.facets.repos as string[]).join('/')
        : '';
      const tags = Array.isArray(c.facets?.tags)
        ? (c.facets.tags as string[]).join(', ')
        : '';
      const category = categoryKey ? String(c.facets?.[categoryKey] ?? '') : '';
      const meta = [
        category,
        repos || 'platform',
        tags,
        `seen ${c.sourceCount}×`,
        isProtected(c) ? 'PINNED' : '',
      ]
        .filter(Boolean)
        .join('; ');
      return `- [${c.code}] (${meta}) ${c.statement}`;
    };
    return [
      `Collection: ${profile.name}. One entry is a ${profile.noun}; at most ${profile.statementMaxChars} characters each.`,
      categories?.length
        ? `Categories: ${categories.join(' | ')}.`
        : 'This collection has no categories; leave "category" out.',
      '',
      `## Active ${profile.nounPlural}`,
      active.length ? active.map(line).join('\n') : '(none yet)',
      '',
      '## New candidates',
      candidates.map(line).join('\n'),
      '',
      'Return the JSON object of operations and nothing else.',
    ].join('\n');
  }

  /** Apply the operations with every guardrail enforced here rather than trusted to the model. */
  private async apply(
    profile: CollectionProfile,
    operations: CuratorOperation[],
    candidates: ClChunk[],
    active: ClChunk[],
    fallback: string | null,
  ): Promise<number> {
    const spec = profile.agentCuration!;
    const byCode = new Map(
      [...candidates, ...active].map((c) => [c.code, c] as const),
    );
    const candidateIds = new Set(candidates.map((c) => c.id));
    const handled = new Set<string>();
    const gone = new Set<string>();
    const [undoneEdits, undoneRemovals] = await Promise.all([
      this.actions.overruled(profile.id, ClLoopActionType.EDIT),
      this.actions.overruled(profile.id, ClLoopActionType.REMOVE),
    ]);
    let activeChanges = 0;
    let applied = 0;
    const withinBudget = (c: ClChunk) =>
      candidateIds.has(c.id) || activeChanges < spec.maxActiveChangesPerPass;
    const spend = (c: ClChunk) => {
      if (!candidateIds.has(c.id)) activeChanges += 1;
    };
    const categoryKey = spec.categoryFacet;

    for (const operation of operations) {
      const target = operation.id ? byCode.get(operation.id) : undefined;
      if (target && gone.has(target.id)) continue;
      try {
        switch (operation.op) {
          case 'AGREE': {
            const candidate = operation.candidateId
              ? byCode.get(operation.candidateId)
              : undefined;
            if (
              !candidate ||
              !target ||
              !candidateIds.has(candidate.id) ||
              handled.has(candidate.id) ||
              candidate.id === target.id
            )
              break;
            await this.agree(profile, candidate, target);
            handled.add(candidate.id);
            gone.add(candidate.id);
            applied += 1;
            break;
          }
          case 'EDIT': {
            const text = operation.text?.trim();
            if (
              !target ||
              isProtected(target) ||
              !text ||
              text.length > profile.statementMaxChars ||
              undoneEdits.has(target.id) ||
              !withinBudget(target)
            )
              break;
            const before = {
              status: target.status,
              statement: target.statement,
              body: target.body ?? null,
              facets: target.facets,
            };
            await this.chunkService.snapshot(target, 'curator: edit', null);
            target.statement = text;
            target.facets = this.applyLabels(
              profile,
              target.facets,
              categoryKey ? operation.category : undefined,
              operation.tags,
            );
            target.status = ClChunkStatus.ACTIVE;
            await this.chunkService.saveChanged(target, 'curator: edit', null);
            spend(target);
            if (candidateIds.has(target.id)) handled.add(target.id);
            await this.actions.record({
              collectionId: profile.id,
              loop: ClLoop.CURATOR,
              action: ClLoopActionType.EDIT,
              chunkId: target.id,
              reason: `Reworded ${target.code} to be more precise`,
              before,
              after: { statement: text, facets: target.facets },
            });
            applied += 1;
            break;
          }
          case 'ADD': {
            if (
              !target ||
              !candidateIds.has(target.id) ||
              handled.has(target.id)
            )
              break;
            const text = operation.text?.trim();
            await this.add(
              profile,
              target,
              `Added ${target.code}: new, not something the set already says`,
              text && text.length <= profile.statementMaxChars
                ? text
                : undefined,
              operation.tags,
            );
            handled.add(target.id);
            applied += 1;
            break;
          }
          case 'REMOVE': {
            if (
              !target ||
              isProtected(target) ||
              undoneRemovals.has(target.id) ||
              !withinBudget(target)
            )
              break;
            const before = { status: target.status };
            await this.chunkService.snapshot(target, 'curator: remove', null);
            target.status = ClChunkStatus.ARCHIVED;
            await this.chunkService.saveChanged(
              target,
              'curator: remove',
              null,
            );
            spend(target);
            handled.add(target.id);
            gone.add(target.id);
            await this.actions.record({
              collectionId: profile.id,
              loop: ClLoop.CURATOR,
              action: ClLoopActionType.REMOVE,
              chunkId: target.id,
              reason: `Removed ${target.code}: stale, wrong or said better by another ${profile.noun}`,
              before,
              after: { status: ClChunkStatus.ARCHIVED },
            });
            applied += 1;
            break;
          }
          default:
            break;
        }
      } catch (error) {
        this.logger.warn(
          `Agent curation (${profile.id}) skipped a ${operation.op}: ${(error as Error).message}`,
        );
      }
    }

    // Silence is not a decision: a candidate the model said nothing about is added.
    for (const candidate of candidates) {
      if (handled.has(candidate.id)) continue;
      try {
        await this.add(
          profile,
          candidate,
          fallback
            ? `Added ${candidate.code} uncurated: ${fallback}`
            : `Added ${candidate.code}: the curator said nothing about it, and an unseen ${profile.noun} helps no one`,
        );
      } catch (error) {
        this.logger.warn(
          `Agent curation (${profile.id}) could not add a candidate: ${(error as Error).message}`,
        );
      }
    }
    return applied;
  }

  /** Fold a candidate into the chunk it agrees with; the agreement becomes `sourceCount`. */
  private async agree(
    profile: CollectionProfile,
    candidate: ClChunk,
    target: ClChunk,
  ): Promise<void> {
    const before = {
      status: candidate.status,
      supersededById: candidate.supersededById ?? null,
      keepId: target.id,
      keepSourceCount: target.sourceCount,
      keepFacets: target.facets,
      keepAttributes: target.attributes,
    };
    target.sourceCount += candidate.sourceCount;
    // A person's chunk keeps its own labels; an agent's pools the repos, tags and provenance of
    // everything that agreed with it.
    if (target.origin === ClChunkOrigin.AGENT) {
      const facets = { ...(target.facets ?? {}) };
      for (const key of ['repos', 'tags']) {
        if (!profile.facets[key]) continue;
        const merged = mergeLabels(facets[key], candidate.facets?.[key]);
        if (merged.length) facets[key] = merged;
      }
      target.facets = facets;
      const attributes = { ...(target.attributes ?? {}) };
      for (const key of EVIDENCE_ATTRIBUTES) {
        if (!profile.attributes[key]) continue;
        const pooled = [
          ...new Set([
            ...((attributes[key] as string[]) ?? []),
            ...((candidate.attributes?.[key] as string[]) ?? []),
          ]),
        ].slice(-50);
        if (pooled.length) attributes[key] = pooled;
      }
      target.attributes = attributes;
    }
    await this.chunkService.saveChanged(target, 'curator: agree', null);
    candidate.status = ClChunkStatus.SUPERSEDED;
    candidate.supersededById = target.id;
    await this.chunkService.saveChanged(candidate, 'curator: agree', null);
    await this.actions.record({
      collectionId: profile.id,
      loop: ClLoop.CURATOR,
      action: ClLoopActionType.AGREE,
      chunkId: candidate.id,
      reason: `${candidate.code} says what ${target.code} already says; ${target.code} has now been seen ${target.sourceCount} times`,
      before,
      after: {
        status: ClChunkStatus.SUPERSEDED,
        supersededBy: target.code,
        keepSourceCount: target.sourceCount,
      },
    });
  }

  private async add(
    profile: CollectionProfile,
    candidate: ClChunk,
    reason: string,
    text?: string,
    tags?: string[],
  ): Promise<void> {
    const before = {
      status: candidate.status,
      statement: candidate.statement,
      facets: candidate.facets,
    };
    if (text) candidate.statement = text;
    if (tags) {
      candidate.facets = this.applyLabels(
        profile,
        candidate.facets,
        undefined,
        tags,
      );
    }
    candidate.status = ClChunkStatus.ACTIVE;
    await this.chunkService.saveChanged(candidate, 'curator: add', null);
    await this.actions.record({
      collectionId: profile.id,
      loop: ClLoop.CURATOR,
      action: ClLoopActionType.ADD,
      chunkId: candidate.id,
      reason,
      before,
      after: { status: ClChunkStatus.ACTIVE, statement: candidate.statement },
    });
  }

  private applyLabels(
    profile: CollectionProfile,
    facets: Record<string, string | string[]>,
    category: string | undefined,
    tags: string[] | undefined,
  ): Record<string, string | string[]> {
    const next = { ...(facets ?? {}) };
    const categoryKey = profile.agentCuration?.categoryFacet;
    if (categoryKey && category) {
      const allowed = profile.facets[categoryKey]?.values;
      const value = category.trim().toLowerCase();
      if (!allowed || allowed.includes(value)) next[categoryKey] = value;
    }
    if (tags && profile.facets.tags) {
      const clean = normaliseLabels(tags).slice(0, 8);
      if (clean.length) next.tags = clean;
    }
    return next;
  }

  /** Keep the active set inside the cap, retiring the weakest agent-written chunks first. */
  private async enforceCap(profile: CollectionProfile): Promise<number> {
    const cap = profile.agentCuration!.activeCap;
    const active = await this.chunks.find({
      where: { collectionId: profile.id, status: ClChunkStatus.ACTIVE },
    });
    if (active.length <= cap) return 0;
    const undone = await this.actions.overruled(
      profile.id,
      ClLoopActionType.RETIRE,
    );
    const weakest = active
      .filter((c) => !isProtected(c) && !undone.has(c.id))
      .sort(
        (a, b) =>
          agentEvidenceScore(a) - agentEvidenceScore(b) ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
      .slice(0, active.length - cap);
    for (const chunk of weakest) {
      await this.retire(
        profile,
        chunk,
        `Retired ${chunk.code} to keep ${profile.name} within its ${cap} active ${profile.nounPlural}: it had the least evidence`,
      );
    }
    if (weakest.length)
      this.logger.info(
        `Agent curation (${profile.id}): retired ${weakest.length} to stay inside the cap of ${cap}.`,
      );
    return weakest.length;
  }

  /**
   * Usage-based retirement, nightly: archive agent chunks contradicted more often than applied,
   * or never applied across enough runs that reported what they used. Returns how many retired.
   */
  async retireByUsage(collectionId: string): Promise<number> {
    const profile = COLLECTION_PROFILES[
      collectionId as keyof typeof COLLECTION_PROFILES
    ] as CollectionProfile | undefined;
    if (!profile?.agentCuration) return 0;
    const rows: Array<{
      id: string;
      unused_reports: string;
    }> = await this.chunks.query(
      `SELECT c.id,
              (SELECT count(DISTINCT u.session_id) FROM cl_usage_events u
                WHERE u.chunk_id = c.id AND u.type = 'unused') AS unused_reports
         FROM cl_chunks c
        WHERE c.collection_id = $1 AND c.status = 'active'
          AND c.origin = 'agent' AND NOT c.pinned`,
      [collectionId],
    );
    if (!rows.length) return 0;
    const unused = new Map(rows.map((r) => [r.id, Number(r.unused_reports)]));
    const [chunks, undone] = await Promise.all([
      this.chunks.find({ where: { id: In([...unused.keys()]) } }),
      this.actions.overruled(collectionId, ClLoopActionType.RETIRE),
    ]);
    let retired = 0;
    for (const chunk of chunks) {
      if (undone.has(chunk.id) || chunk.status !== ClChunkStatus.ACTIVE)
        continue;
      const reason = agentRetirementDecision({
        pinned: chunk.pinned,
        sourceCount: chunk.sourceCount,
        timesApplied: chunk.timesApplied,
        timesContradicted: chunk.timesContradicted,
        unusedReports: unused.get(chunk.id) ?? 0,
      });
      if (!reason) continue;
      await this.retire(profile, chunk, `${chunk.code}: ${reason}`, {
        sourceCount: chunk.sourceCount,
        timesApplied: chunk.timesApplied,
        timesContradicted: chunk.timesContradicted,
        unusedReports: unused.get(chunk.id) ?? 0,
      });
      retired += 1;
    }
    return retired;
  }

  private async retire(
    profile: CollectionProfile,
    chunk: ClChunk,
    reason: string,
    evidence?: Record<string, unknown>,
  ): Promise<void> {
    const before = { status: chunk.status };
    await this.chunkService.snapshot(chunk, 'curator: retire', null);
    chunk.status = ClChunkStatus.ARCHIVED;
    await this.chunkService.saveChanged(chunk, 'curator: retire', null);
    await this.actions.record({
      collectionId: profile.id,
      loop: ClLoop.CURATOR,
      action: ClLoopActionType.RETIRE,
      chunkId: chunk.id,
      reason,
      before,
      after: { status: ClChunkStatus.ARCHIVED },
      evidence: evidence ?? {
        sourceCount: chunk.sourceCount,
        timesApplied: chunk.timesApplied,
        timesContradicted: chunk.timesContradicted,
      },
    });
  }
}

/**
 * A pinned chunk is a person outranking the curator, and a written (authored) one is its
 * author's text: the curator may count agreements with either, but never edits, removes or
 * retires them.
 */
export function isProtected(
  chunk: Pick<ClChunk, 'pinned' | 'origin'>,
): boolean {
  return chunk.pinned || chunk.origin !== ClChunkOrigin.AGENT;
}
