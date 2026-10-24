import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, Repository } from 'typeorm';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { AgentRelease } from 'src/llm-agent/entity/agent-release.entity';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { isGroundedInLearnerWords } from '../capabilities/guide-tool-executor.service';
import { GUIDE_AI_TASKS } from '../constants/guide-ai-tasks.constants';
import { GuideLearnerPrefs } from '../entity/guide-learner-prefs.entity';
import { GuideMessage } from '../entity/guide-message.entity';
import { GuideThread } from '../entity/guide-thread.entity';
import {
  GuideMemoryKind,
  GuideMessageKind,
  GuideMessageRole,
} from '../enum/guide.enum';
import {
  CuratorConversationLine,
  CuratorNoteLine,
  MEMORY_CURATOR_OUTPUT_SCHEMA,
  MEMORY_CURATOR_SYSTEM_PROMPT,
  buildMemoryCuratorUserMessage,
} from '../prompts/memory-curator.prompt';
import {
  ALLY_GUIDE_AGENT_KEY,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { GuideModelService } from '../runtime/guide-model.service';
import { redactText } from '../safety/redaction';
import {
  CurationOutcome,
  GuideLearnerDataService,
} from './guide-learner-data.service';

/** A session window closes after this long without the learner (plan §7.7). */
export const CURATOR_IDLE_MINUTES = 30;
/** Older threads are left alone: their window closed long ago. */
const CURATOR_LOOKBACK_DAYS = 14;
/** Threads curated per sweep; the rest wait for the next one. */
const CURATOR_SWEEP_LIMIT = 50;
/** At most this many changes from one window. */
export const CURATOR_MAX_OPERATIONS = 5;
/** Notes shown to the curator, so it edits instead of duplicating. */
const CURATOR_NOTES_IN_VIEW = 50;
/** Ally's lines are context; a long reply needs only its start. */
const ALLY_LINE_MAX_CHARS = 400;

type WindowRow = Pick<
  GuideMessage,
  'id' | 'seq' | 'role' | 'kind' | 'content' | 'turnId' | 'flags'
>;

export interface CuratorWindow {
  conversation: CuratorConversationLine[];
  /** ref (m1…) → the learner message it names. */
  learnerByRef: Map<string, { id: string; text: string }>;
}

/** A message the curator may never read: flagged, or a fixed crisis reply. */
const isFlagged = (row: WindowRow) =>
  Boolean(
    row.flags?.realCase ||
    row.flags?.pii ||
    row.flags?.crisis ||
    row.flags?.care,
  );

/**
 * What the curator is shown from one window (plan §7.7): the learner's lines
 * with refs it cites, Ally's for context. A flagged learner message (real
 * case, identifying details, crisis, care) is left out together with Ally's
 * reply to it — the reply may repeat what the message said — and so is the
 * fixed crisis copy. Nothing the curator never saw can end up in a note.
 */
export function buildCuratorWindow(rows: WindowRow[]): CuratorWindow {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const flaggedTurns = new Set(
    ordered
      .filter((row) => isFlagged(row) && row.turnId)
      .map((row) => row.turnId as string),
  );
  const conversation: CuratorConversationLine[] = [];
  const learnerByRef = new Map<string, { id: string; text: string }>();
  for (const row of ordered) {
    const text = row.content?.trim();
    if (!text) continue;
    if (isFlagged(row)) continue;
    if (row.turnId && flaggedTurns.has(row.turnId)) continue;
    if (row.kind === GuideMessageKind.CRISIS_FIXED) continue;
    if (row.role === GuideMessageRole.LEARNER) {
      const ref = `m${learnerByRef.size + 1}`;
      learnerByRef.set(ref, { id: row.id, text });
      conversation.push({ ref, role: 'learner', text });
    } else if (row.role === GuideMessageRole.ALLY) {
      conversation.push({
        ref: null,
        role: 'ally',
        text:
          text.length > ALLY_LINE_MAX_CHARS
            ? `${text.slice(0, ALLY_LINE_MAX_CHARS - 1)}…`
            : text,
      });
    }
  }
  return { conversation, learnerByRef };
}

export type CuratorOperation =
  | {
      op: 'add';
      kind: GuideMemoryKind;
      body: string;
      sourceMessageIds: string[];
    }
  | {
      op: 'edit';
      id: string;
      revision: number;
      kind: GuideMemoryKind;
      body: string;
      sourceMessageIds: string[];
    }
  | { op: 'remove'; id: string; revision: number };

export interface CuratorRejection {
  op: string;
  ref: string;
  reason:
    | 'unknown_op'
    | 'unknown_kind'
    | 'unknown_note'
    | 'revision_mismatch'
    | 'no_learner_source'
    | 'not_grounded'
    | 'contact_details'
    | 'too_long'
    | 'empty'
    | 'over_limit'
    | 'repeat';
}

const KINDS = new Set<string>(Object.values(GuideMemoryKind));

/**
 * The curator's proposals, checked before anything is written. The model
 * proposes; these rules decide:
 *  - ADD and EDIT must cite learner lines from this window, and the note
 *    must be grounded in those lines' words (the same test `remember` uses);
 *  - no contact details (an address, a number, a link);
 *  - EDIT and REMOVE name a note the curator was shown, at the revision it
 *    was shown (the store re-checks it at write time);
 *  - at most five changes, each note touched once.
 */
export function validateCuratorOperations(
  raw: unknown,
  input: {
    notesByRef: Map<string, { id: string; revision: number; kind: string }>;
    learnerByRef: Map<string, { id: string; text: string }>;
    maxChars: number;
  },
): { operations: CuratorOperation[]; rejected: CuratorRejection[] } {
  const list = Array.isArray((raw as { operations?: unknown })?.operations)
    ? ((raw as { operations: unknown[] }).operations as Array<
        Record<string, unknown>
      >)
    : [];
  const operations: CuratorOperation[] = [];
  const rejected: CuratorRejection[] = [];
  const touched = new Set<string>();
  const added = new Set<string>();
  for (const entry of list) {
    const op = String(entry?.op ?? '').toUpperCase();
    const ref = String(entry?.ref ?? '');
    const reject = (reason: CuratorRejection['reason']) =>
      rejected.push({ op, ref, reason });
    if (operations.length >= CURATOR_MAX_OPERATIONS) {
      reject('over_limit');
      continue;
    }
    if (op !== 'ADD' && op !== 'EDIT' && op !== 'REMOVE') {
      reject('unknown_op');
      continue;
    }
    if (op === 'EDIT' || op === 'REMOVE') {
      const note = input.notesByRef.get(ref);
      if (!note) {
        reject('unknown_note');
        continue;
      }
      if (Number(entry.revision) !== note.revision) {
        reject('revision_mismatch');
        continue;
      }
      if (touched.has(note.id)) {
        reject('repeat');
        continue;
      }
      if (op === 'REMOVE') {
        touched.add(note.id);
        operations.push({ op: 'remove', id: note.id, revision: note.revision });
        continue;
      }
    }
    const kind = String(entry?.kind ?? '');
    if (!KINDS.has(kind)) {
      reject('unknown_kind');
      continue;
    }
    const body = String(entry?.note ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!body) {
      reject('empty');
      continue;
    }
    if (body.length > input.maxChars) {
      reject('too_long');
      continue;
    }
    if (redactText(body) !== body) {
      reject('contact_details');
      continue;
    }
    const sources = (Array.isArray(entry?.sources) ? entry.sources : [])
      .map((value) => input.learnerByRef.get(String(value)))
      .filter((line): line is { id: string; text: string } => Boolean(line));
    if (!sources.length) {
      reject('no_learner_source');
      continue;
    }
    if (
      !isGroundedInLearnerWords(
        body,
        sources.map((line) => line.text),
      )
    ) {
      reject('not_grounded');
      continue;
    }
    const sourceMessageIds = [...new Set(sources.map((line) => line.id))];
    if (op === 'ADD') {
      const key = body.toLowerCase();
      if (added.has(key)) {
        reject('repeat');
        continue;
      }
      added.add(key);
      operations.push({
        op: 'add',
        kind: kind as GuideMemoryKind,
        body,
        sourceMessageIds,
      });
    } else {
      const note = input.notesByRef.get(ref)!;
      touched.add(note.id);
      operations.push({
        op: 'edit',
        id: note.id,
        revision: note.revision,
        kind: kind as GuideMemoryKind,
        body,
        sourceMessageIds,
      });
    }
  }
  return { operations, rejected };
}

export interface CurationRun {
  threadId: string;
  status:
    | 'nothing_new'
    | 'claimed_elsewhere'
    | 'no_learner'
    | 'memory_off'
    | 'nothing_to_read'
    | 'failed'
    | 'curated';
  fromSeq?: number;
  toSeq?: number;
  applied?: Array<{ op: CuratorOperation['op']; outcome: CurationOutcome }>;
  rejected?: CuratorRejection[];
}

/**
 * The Memory Curator (plans/ally-guide/plan.md §7.7): after a session
 * window it reads what the learner said and keeps Ally's notes about them
 * current — ADD, EDIT or REMOVE, each checked by `validateCuratorOperations`
 * and written with optimistic revisions, never over a learner's own change
 * and never back over something they forgot.
 *
 * A window ends at an epoch boundary, when the closing ritual is shown, or
 * after 30 minutes of quiet (a five-minute sweep); the first two are run at
 * once and the sweep is the backstop that catches anything a restart lost.
 * Each run claims `guide_threads.memoryCuratedSeq` with a conditional
 * update, so two runs never read the same messages; a provider failure hands
 * the window back for the next sweep.
 */
@Injectable()
export class GuideMemoryCuratorService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    GuideMemoryCuratorService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GuideThread)
    private readonly threads: Repository<GuideThread>,
    @InjectRepository(GuideMessage)
    private readonly messages: Repository<GuideMessage>,
    @InjectRepository(GuideLearnerPrefs)
    private readonly prefs: Repository<GuideLearnerPrefs>,
    private readonly learnerData: GuideLearnerDataService,
    private readonly models: GuideModelService,
    private readonly releases: AgentReleaseService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('5min', 'ally-guide-memory-curator', () =>
      this.runIdle().then(() => undefined),
    );
  }

  /** Curate a thread's window soon, off the caller's path. */
  schedule(threadId: string, upToSeq?: number): void {
    setImmediate(() => {
      this.curate(threadId, { upToSeq }).catch((error) =>
        this.logger.warn(
          `Memory curation for ${threadId} failed: ${String(error)}`,
        ),
      );
    });
  }

  /** Threads quiet for 30 minutes with messages the curator has not read. */
  async runIdle(): Promise<CurationRun[]> {
    const due: GuideThread[] = await this.threads
      .createQueryBuilder('t')
      .where('t."userId" IS NOT NULL')
      .andWhere('t."tenant_id" IS NOT NULL')
      .andWhere('t."lastMessageSeq" > t."memoryCuratedSeq"')
      .andWhere(
        `t."lastLearnerActivityAt" < now() - (:idle || ' minutes')::interval`,
        { idle: String(CURATOR_IDLE_MINUTES) },
      )
      .andWhere(
        `t."lastLearnerActivityAt" > now() - (:days || ' days')::interval`,
        { days: String(CURATOR_LOOKBACK_DAYS) },
      )
      .orderBy('t."lastLearnerActivityAt"', 'ASC')
      .limit(CURATOR_SWEEP_LIMIT)
      .getMany();
    const runs: CurationRun[] = [];
    for (const thread of due) {
      runs.push(
        await this.curate(thread.id).catch((error) => {
          this.logger.warn(
            `Memory curation for ${thread.id} failed: ${String(error)}`,
          );
          return { threadId: thread.id, status: 'failed' as const };
        }),
      );
    }
    return runs;
  }

  /** Read the window after the watermark (up to `upToSeq`) and apply what holds. */
  async curate(
    threadId: string,
    options: { upToSeq?: number } = {},
  ): Promise<CurationRun> {
    const thread = await this.threads.findOne({ where: { id: threadId } });
    if (!thread) return { threadId, status: 'nothing_new' };
    const fromSeq = thread.memoryCuratedSeq ?? 0;
    const toSeq = Math.min(
      options.upToSeq ?? thread.lastMessageSeq,
      thread.lastMessageSeq,
    );
    if (toSeq <= fromSeq) return { threadId, status: 'nothing_new' };
    if (!(await this.claim(threadId, fromSeq, toSeq))) {
      return { threadId, status: 'claimed_elsewhere' };
    }
    const base = { threadId, fromSeq, toSeq };
    // A visitor has no memory: nothing to keep before sign-in (plan §2.3).
    if (!thread.userId || !thread.tenantId) {
      return { ...base, status: 'no_learner' };
    }
    const owner = { id: thread.userId, tenantId: thread.tenantId };
    const prefsRow = await this.prefs.findOne({
      where: { userId: owner.id, tenantId: owner.tenantId },
    });
    // Memory off means nothing from this stretch is kept, even if it is
    // switched on later.
    if (prefsRow?.prefs?.memoryEnabled === false) {
      return { ...base, status: 'memory_off' };
    }
    const rows = await this.messages.find({
      where: { threadId, seq: Between(fromSeq + 1, toSeq) },
      order: { seq: 'ASC' },
    });
    const window = buildCuratorWindow(rows);
    if (!window.learnerByRef.size) {
      return { ...base, status: 'nothing_to_read' };
    }

    const release = await this.releaseFor(thread);
    if (!release) {
      await this.unclaim(threadId, fromSeq, toSeq);
      return { ...base, status: 'failed' };
    }
    const bundle = release.bundle as unknown as GuideReleaseBundle;
    const policy = bundle.policy.memory;
    const notes = await this.learnerData.activeMemories(
      owner,
      CURATOR_NOTES_IN_VIEW,
    );
    const notesByRef = new Map(
      notes.map((note, index) => [
        `n${index + 1}`,
        { id: note.id, revision: note.revision, kind: note.kind },
      ]),
    );
    const noteLines: CuratorNoteLine[] = notes.map((note, index) => ({
      ref: `n${index + 1}`,
      revision: note.revision,
      kind: note.kind,
      body: note.body,
    }));

    let raw: unknown;
    try {
      const { result } = await this.models.complete({
        role: 'memory_curator',
        bundle,
        task: LlmTask.GUIDE_MEMORY_CURATOR,
        aiTaskId: GUIDE_AI_TASKS.MEMORY_CURATOR,
        attribution: {
          threadId,
          userId: owner.id,
          tenantId: owner.tenantId,
          releaseId: release.id,
        },
        request: {
          system: [
            {
              text:
                bundle.prompts.memory_curator?.text ??
                MEMORY_CURATOR_SYSTEM_PROMPT,
              cache: true,
            },
          ],
          messages: [
            {
              role: 'user',
              content: buildMemoryCuratorUserMessage({
                notes: noteLines,
                conversation: window.conversation,
              }),
            },
          ],
          maxTokens: 4_000,
          outputSchema: MEMORY_CURATOR_OUTPUT_SCHEMA as unknown as Record<
            string,
            unknown
          >,
          timeoutMs: 30_000,
        },
      });
      if (result.stopReason !== 'end_turn') {
        // Malformed or cut short: nothing applied, and not retried — the
        // same window would most likely fail the same way.
        this.logger.warn(`Memory curator stopped with ${result.stopReason}`);
        return { ...base, status: 'failed' };
      }
      const text = result.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { text: string }).text)
        .join('');
      raw = JSON.parse(text);
    } catch (error) {
      // The provider failed: the window goes back for the next sweep.
      await this.unclaim(threadId, fromSeq, toSeq);
      this.logger.warn(`Memory curator call failed: ${String(error)}`);
      return { ...base, status: 'failed' };
    }

    const { operations, rejected } = validateCuratorOperations(raw, {
      notesByRef,
      learnerByRef: window.learnerByRef,
      maxChars: policy.noteMaxChars,
    });
    const applied: CurationRun['applied'] = [];
    for (const operation of operations) {
      applied.push({
        op: operation.op,
        outcome: await this.apply(operation, owner, threadId, policy),
      });
    }
    if (applied.length || rejected.length) {
      this.logger.info(
        `Memory curator on ${threadId} (${fromSeq + 1}..${toSeq}): ` +
          `${applied.map((a) => `${a.op}:${a.outcome}`).join(', ') || 'no changes'}` +
          (rejected.length
            ? `; refused ${rejected.map((r) => `${r.op}:${r.reason}`).join(', ')}`
            : ''),
      );
    }
    return { ...base, status: 'curated', applied, rejected };
  }

  private async apply(
    operation: CuratorOperation,
    owner: { id: number; tenantId: string },
    threadId: string,
    policy: GuideReleaseBundle['policy']['memory'],
  ): Promise<CurationOutcome> {
    switch (operation.op) {
      case 'add': {
        const result = await this.learnerData.remember({
          owner,
          kind: operation.kind,
          body: operation.body,
          threadId,
          expiryDays: policy.expiryDays,
          maxChars: policy.noteMaxChars,
          sourceMessageIds: operation.sourceMessageIds,
        });
        return result.stored ? 'applied' : result.reason;
      }
      case 'edit':
        return this.learnerData.editMemory({
          owner,
          id: operation.id,
          expectedRevision: operation.revision,
          body: operation.body,
          kind: operation.kind,
          expiryDays: policy.expiryDays,
          maxChars: policy.noteMaxChars,
          sourceMessageIds: operation.sourceMessageIds,
        });
      case 'remove':
        return this.learnerData.retireMemory({
          owner,
          id: operation.id,
          expectedRevision: operation.revision,
        });
    }
  }

  /** The thread's release (its prompt and model), or GA if it has none. */
  private async releaseFor(thread: GuideThread): Promise<AgentRelease | null> {
    if (thread.releaseId) {
      const pinned = await this.releases
        .getById(thread.releaseId)
        .catch(() => null);
      if (pinned) return pinned;
    }
    return this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
  }

  /** Move the watermark from → to, only if nobody else has. */
  private async claim(
    threadId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<boolean> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(GuideThread)
      .set({ memoryCuratedSeq: toSeq })
      .where('id = :threadId AND "memoryCuratedSeq" = :fromSeq', {
        threadId,
        fromSeq,
      })
      .execute();
    return Boolean(result.affected);
  }

  /** Hand a window back after a failure, unless a later run moved on. */
  private async unclaim(
    threadId: string,
    fromSeq: number,
    toSeq: number,
  ): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update(GuideThread)
      .set({ memoryCuratedSeq: fromSeq })
      .where('id = :threadId AND "memoryCuratedSeq" = :toSeq', {
        threadId,
        toSeq,
      })
      .execute();
  }
}
