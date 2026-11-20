import {
  ConflictException,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentReleaseAuditAction } from '../../llm-agent/harness/enum/harness.enum';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { DEBRIEF_AGENT_KEY } from '../../common/constants/debrief-agent.constants';
import {
  CHANGE_STATES,
  ChangeContext,
  ChangeState,
  DebriefChange,
  IdeaRow,
  isChange,
  toDebriefChange,
} from '../util/debrief-changes.util';
import {
  sliceScore,
  undoDecision,
  WatchSlice,
} from '../util/debrief-score.util';
import { actorOf, DebriefPmAgentService } from './debrief-pm-agent.service';
import { DebriefNotifier } from './debrief-notifier.service';
import { DebriefScoreService, ScoredRun } from './debrief-score.service';
import { DebriefSettingsService } from './debrief-settings.service';
import { DebriefSlackService } from './debrief-slack.service';

const DAY_MS = 86_400_000;
/** The most ideas the Changes page reads (newest activity first). */
const CHANGES_LIMIT = 300;

/** `GET home` (canvas F1). */
export interface DebriefHomeV2 {
  headline: {
    score: number | null;
    lastWeekScore: number | null;
    debriefs: number;
    needsYou: number;
  };
  needsYou: Array<{ changeId: string; title: string; why: string }>;
  thisWeek: {
    score: number | null;
    wentLive: number;
    undone: number;
    changes: Array<{
      id: string;
      title: string;
      state: ChangeState;
      result: string;
    }>;
  };
}

/**
 * Debrief v2 Changes (A3, A5, K2; the API contract in V2_AUTONOMY.md): the
 * PM agent's changes in the owner's words, the two instant buttons (Undo now
 * for a live change, Stop now for one being tried or tested), and the
 * `debrief-change-watch` job that moves the ladder on, watches each change
 * after it went live and undoes it when it hurts. The weekly Slack summary is
 * here too (`debrief-weekly-summary`).
 */
@Injectable()
export class DebriefChangesService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefChangesService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly pmAgent: DebriefPmAgentService,
    private readonly releases: AgentReleaseService,
    private readonly score: DebriefScoreService,
    private readonly settings: DebriefSettingsService,
    @Optional() private readonly slack?: DebriefSlackService,
    @Optional() private readonly notifier?: DebriefNotifier,
  ) {}

  onModuleInit(): void {
    // When these run is set in Debrief › Settings › Schedules (debrief_schedules).
    scheduledTaskRegistry.registerConfigurable(
      'debrief-change-watch',
      async () => {
        const r = await this.watch();
        return `${r.moved} moved on, ${r.watched} watched, ${r.undone} undone${r.safety ? `, ${r.safety} safety post${r.safety === 1 ? '' : 's'}` : ''}`;
      },
    );
    scheduledTaskRegistry.registerConfigurable(
      'debrief-weekly-summary',
      async () => ((await this.weeklySummary()) ? 'posted' : 'not posted'),
    );
  }

  // --- Reading ------------------------------------------------------------------

  private async ideas(): Promise<IdeaRow[]> {
    const rows: IdeaRow[] = await this.dataSource.query(
      // Every open or live change, however old (one that waits for a person
      // must never drop off), plus the most recent closed ones.
      `SELECT id, status, text, change, evidence, "createdAt", "updatedAt", "releaseId"
         FROM agent_lessons
        WHERE "agentKey" = $1
          AND (status IN ('proposed', 'approved', 'active')
               OR id IN (SELECT id FROM agent_lessons
                          WHERE "agentKey" = $1
                            AND status NOT IN ('proposed', 'approved', 'active')
                          ORDER BY "updatedAt" DESC
                          LIMIT $2))
        ORDER BY "updatedAt" DESC`,
      [DEBRIEF_AGENT_KEY, CHANGES_LIMIT],
    );
    return rows.filter(isChange);
  }

  private async context(): Promise<ChangeContext> {
    const [s, ga] = await Promise.all([
      this.settings.get(),
      this.releases.getGa(DEBRIEF_AGENT_KEY).catch(() => null),
    ]);
    return {
      gaReleaseId: ga?.id ?? null,
      canaryMinRuns: s.canaryMinRuns,
      canaryMinDays: s.canaryMinDays,
      pairedMinComparisons: s.pairedMinComparisons,
    };
  }

  /** `GET changes?state=`: every change, newest activity first. */
  async list(state?: string): Promise<{ changes: DebriefChange[] }> {
    const ctx = await this.context();
    const all = (await this.ideas()).map((i) => toDebriefChange(i, ctx));
    const wanted = (CHANGE_STATES as readonly string[]).includes(state ?? '')
      ? all.filter((c) => c.state === state)
      : all;
    return { changes: wanted };
  }

  /** `GET changes/:id`. */
  async get(id: string): Promise<DebriefChange> {
    const idea = (await this.pmAgent.getIdea(id)) as IdeaRow;
    const change = toDebriefChange(idea, await this.context());
    return change;
  }

  /** `GET home` (F1): the headline, what needs a person, this week. */
  async home(
    now = new Date(),
    opts: {
      /** What this viewer may decide: only those changes are "Needs you". */
      can?: { budgets: boolean; changes: boolean };
    } = {},
  ): Promise<DebriefHomeV2> {
    const [score, ideas, ctx] = await Promise.all([
      this.score.view(14, now),
      this.ideas(),
      this.context(),
    ]);
    const changes = ideas.map((i) => ({ idea: i, c: toDebriefChange(i, ctx) }));
    // Only always-ask changes need a person (A1); a hand-off is not one.
    const needsYou = changes.filter(
      ({ idea, c }) =>
        c.state === 'waits' &&
        !['needs_code', 'defect'].includes(idea.change?.ideaKind) &&
        (!opts.can ||
          (c.kindKey === 'budget' ? opts.can.budgets : opts.can.changes)),
    );
    const weekAgo = now.getTime() - 7 * DAY_MS;
    const within = (v: unknown) =>
      !!v && new Date(v as string).getTime() >= weekAgo;
    const thisWeek = changes.filter(
      ({ idea }) => within(idea.updatedAt) || within(idea.createdAt),
    );
    return {
      headline: {
        score: score.current,
        lastWeekScore: score.previous,
        debriefs: score.debriefs,
        needsYou: needsYou.length,
      },
      needsYou: needsYou.map(({ c }) => ({
        changeId: c.id,
        title: c.title,
        why: c.waitsBecause ?? c.why,
      })),
      thisWeek: {
        score: score.current,
        wentLive: changes.filter(({ idea }) =>
          within(idea.evidence?.watch?.liveAt),
        ).length,
        undone: changes.filter(({ idea }) => within(idea.evidence?.undo?.at))
          .length,
        changes: thisWeek.map(({ c }) => ({
          id: c.id,
          title: c.title,
          state: c.state,
          result: c.result,
        })),
      },
    };
  }

  // --- Undo now / Stop now ----------------------------------------------------------

  /**
   * Undo a live change (Undo now, or the watch on its own with `userId`
   * null): the release before comes back for everyone, everything it named
   * with it; a test-settings change gets its old values back. Recorded as
   * `evidence.undo`; the owner's channel hears about it.
   */
  async undo(
    id: string,
    userId: number | null,
    reason?: string | null,
  ): Promise<DebriefChange> {
    const idea = (await this.pmAgent.getIdea(id)) as IdeaRow;
    const ctx = await this.context();
    const before = toDebriefChange(idea, ctx);
    if (before.state !== 'live') {
      throw new ConflictException('only a change that is live can be undone');
    }
    if (!before.canUndo) {
      throw new ConflictException(
        'a later change is live now; undo that one first',
      );
    }
    const why =
      reason?.trim() ||
      (userId == null ? 'it did worse' : 'undone by a person');
    const e = idea.evidence ?? {};
    let toReleaseId: string | null = null;
    if (idea.change?.ideaKind === 'test_settings') {
      // `before: null` was the default: null puts the default back.
      const back: Record<string, number | boolean | string | null> = {};
      for (const [k, v] of Object.entries(
        (idea.change?.settings ?? {}) as Record<string, { before: unknown }>,
      )) {
        back[k] = (v.before ?? null) as number | boolean | string | null;
      }
      if (Object.keys(back).length) {
        await this.settings.update(back, userId, {
          source: 'undo',
          why,
          changeId: id,
        });
      }
    } else {
      const releaseId = idea.releaseId ?? e.watch?.releaseId;
      toReleaseId =
        e.watch?.previousReleaseId ??
        (await this.releases.rollbackTarget(DEBRIEF_AGENT_KEY))?.releaseId ??
        null;
      if (!toReleaseId || toReleaseId === releaseId) {
        throw new ConflictException(
          'there is no earlier release to go back to',
        );
      }
      await this.releases.makeGa(
        toReleaseId,
        userId,
        AgentReleaseAuditAction.ROLLED_BACK,
        `Undo: ${idea.text ?? ''} (${why})`.slice(0, 300),
        actorOf(userId),
      );
    }
    const at = new Date().toISOString();
    await this.pmAgent.writeEvidence(id, 'undo', {
      at,
      by: userId,
      reason: why,
      toReleaseId,
    });
    if (e.watch) {
      await this.pmAgent.writeEvidence(id, 'watch', {
        ...e.watch,
        status: 'undone',
        endedAt: at,
      });
    }
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'retired', "updatedAt" = now() WHERE id = $1`,
      [id],
    );
    await this.pmAgent.audit('pipeline_step', id, userId, {
      step: 'undone',
      reason: why,
      toReleaseId,
    });
    await this.notifier?.owner({
      title: 'Debriefs: a change was undone',
      body: `${idea.text}: ${why}.`,
      data: { ideaId: id, releaseId: toReleaseId },
      excludeUserId: userId,
    });
    await this.slack?.post(
      `A change was undone${userId == null ? ' on its own' : ' by a person'}: ${idea.text}. Why: ${why}. The version before is live for everyone again.`,
    );
    return this.get(id);
  }

  /**
   * Stop a change being tried on learners or tested (Stop now): its
   * try-out ends (every learner back on the live release), its trial stops
   * taking sessions, and the ladder goes no further. A quick check or pass
   * test already running finishes, but nothing starts after it.
   */
  async stop(
    id: string,
    userId: number,
    reason?: string | null,
  ): Promise<DebriefChange> {
    const idea = (await this.pmAgent.getIdea(id)) as IdeaRow;
    const before = toDebriefChange(idea, await this.context());
    if (!before.canStop) {
      throw new ConflictException(
        'only a change being tried or tested can be stopped',
      );
    }
    const e = idea.evidence ?? {};
    const why = reason?.trim() || 'stopped by a person';
    if (e.canary && ['running', 'passed'].includes(e.canary.status)) {
      const canary = await this.releases.getCanary(DEBRIEF_AGENT_KEY);
      if (canary && canary.id === e.canary.releaseId) {
        await this.releases.stopCanary(DEBRIEF_AGENT_KEY, userId, false, why, {
          action: AgentReleaseAuditAction.CANARY_STOPPED,
          detail: { ideaId: id },
        });
      }
      await this.pmAgent.writeEvidence(id, 'canary', {
        ...e.canary,
        status: 'stopped',
        stoppedAt: new Date().toISOString(),
      });
    }
    if (e.trial?.status === 'running') {
      await this.pmAgent.writeEvidence(id, 'trial', {
        ...e.trial,
        status: 'stopped',
      });
    }
    await this.pmAgent.writeEvidence(id, 'stopped', {
      at: new Date().toISOString(),
      by: userId,
      reason: why,
    });
    await this.dataSource.query(
      `UPDATE agent_lessons SET status = 'retired', "updatedAt" = now() WHERE id = $1`,
      [id],
    );
    await this.pmAgent.audit('pipeline_step', id, userId, {
      step: 'stopped',
      reason: why,
    });
    return this.get(id);
  }

  // --- The watch job ------------------------------------------------------------------

  /**
   * `debrief-change-watch`: safety posts nobody made, changes whose last
   * rung passed moved on (A3), and every live change in its watch period
   * compared with the release before (A5).
   */
  async watch(now = new Date()): Promise<{
    moved: number;
    watched: number;
    undone: number;
    safety: number;
  }> {
    const safety = (await this.slack?.sweepSafety().catch(() => 0)) ?? 0;
    let moved = 0;
    // Autonomy by default: nothing sits untested waiting for a person.
    // Hand-offs proposed before they started on their own start now.
    const handoffs: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM agent_lessons
        WHERE "agentKey" = $1 AND status = 'proposed'
          AND change->>'ideaKind' IN ('needs_code','defect')
          AND NOT (evidence ? 'handoff') AND NOT (evidence ? 'stopped')`,
      [DEBRIEF_AGENT_KEY],
    );
    for (const r of handoffs) {
      const res = await this.pmAgent
        .autoStartHandoff(r.id)
        .catch(() => ({ started: false }));
      if (res.started) moved++;
    }
    // One untested drafted change starts its first test each run (the
    // learning budget pays; the quick check refuses when it is spent).
    const [untested]: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM agent_lessons
        WHERE "agentKey" = $1 AND status = 'proposed'
          AND change->>'ideaKind' IN ('prompt_edit','setting','registry_agent','default_plan')
          AND NOT (evidence ? 'screen') AND NOT (evidence ? 'gate')
          AND NOT (evidence ? 'trial') AND NOT (evidence ? 'stopped')
        ORDER BY "createdAt" ASC LIMIT 1`,
      [DEBRIEF_AGENT_KEY],
    );
    if (untested) {
      const started = await this.pmAgent
        .screen(untested.id)
        .then(() => true)
        .catch(() => false);
      if (started) moved++;
    }
    const ready: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM agent_lessons
        WHERE "agentKey" = $1 AND status IN ('proposed','approved')
          AND NOT (evidence ? 'stopped')
          AND (evidence->'canary'->>'status' = 'passed'
               OR (NOT (evidence ? 'canary') AND evidence->'trial'->>'status' = 'passed'))`,
      [DEBRIEF_AGENT_KEY],
    );
    for (const r of ready) {
      const step = await this.pmAgent.advance(r.id).catch(() => 'nothing');
      if (step === 'started_canary' || step === 'promoted') moved++;
    }
    const watching: IdeaRow[] = await this.dataSource.query(
      `SELECT id, status, text, change, evidence, "createdAt", "updatedAt", "releaseId"
         FROM agent_lessons
        WHERE "agentKey" = $1 AND status = 'active'
          AND evidence->'watch'->>'status' = 'watching'`,
      [DEBRIEF_AGENT_KEY],
    );
    let undone = 0;
    for (const idea of watching) {
      try {
        if (await this.watchOne(idea, now)) undone++;
      } catch (e) {
        this.logger.warn(
          `[debrief] watching change ${idea.id} failed: ${(e as Error).message}`,
        );
      }
    }
    return { moved, watched: watching.length, undone, safety };
  }

  /** One live change against the release before; true when it was undone. */
  async watchOne(idea: IdeaRow, now = new Date()): Promise<boolean> {
    const w = idea.evidence?.watch;
    if (!w) return false;
    if (now.getTime() > new Date(w.until).getTime()) {
      await this.pmAgent.writeEvidence(idea.id, 'watch', {
        ...w,
        status: 'kept',
        endedAt: now.toISOString(),
      });
      return false;
    }
    const ga = await this.releases.getGa(DEBRIEF_AGENT_KEY);
    if (!ga || ga.id !== w.releaseId) {
      // A later change (or a person's roll back) is live now: this one can
      // no longer be compared on its own.
      await this.pmAgent.writeEvidence(idea.id, 'watch', {
        ...w,
        status: 'superseded',
        endedAt: now.toISOString(),
      });
      return false;
    }
    const s = await this.settings.get();
    const liveAt = new Date(w.liveAt);
    const after = await this.score.runs(liveAt, null, w.releaseId);
    const before = w.previousReleaseId
      ? await this.score.runs(
          new Date(liveAt.getTime() - s.watchDays * DAY_MS),
          liveAt,
          w.previousReleaseId,
        )
      : [];
    const weights = await this.score.weights();
    const gates = await this.score.gates(after, before.length ? before : null);
    const decision = undoDecision(
      slicesOf(after, before),
      gates,
      weights,
      s.undoMargin,
    );
    await this.pmAgent.writeEvidence(idea.id, 'watch', {
      ...w,
      last: {
        checkedAt: now.toISOString(),
        after: sliceScore(after, weights),
        before: sliceScore(before, weights),
        n: after.length,
        reason: decision.reason,
      },
    });
    if (!decision.undo) return false;
    await this.undo(idea.id, null, decision.reason);
    return true;
  }

  // --- Weekly summary (K2) ----------------------------------------------------------

  /** What changed this week, posted to the owner's Slack channel. */
  async weeklySummary(now = new Date()): Promise<boolean> {
    const [score, ideas] = await Promise.all([
      this.score.view(14, now),
      this.ideas(),
    ]);
    const weekAgo = now.getTime() - 7 * DAY_MS;
    const within = (v: unknown) =>
      !!v && new Date(v as string).getTime() >= weekAgo;
    const live = ideas.filter((i) => within(i.evidence?.watch?.liveAt));
    const undone = ideas.filter((i) => within(i.evidence?.undo?.at));
    const stopped = ideas.filter(
      (i) =>
        within(i.evidence?.stopped?.at) ||
        (i.evidence?.canary?.status === 'reverted' &&
          within(i.evidence?.canary?.checkedAt)),
    );
    const ctx = await this.context();
    const waits = ideas.filter(
      (i) => toDebriefChange(i, ctx).state === 'waits',
    ).length;
    const fmt = (v: number | null) =>
      v == null ? 'no score yet' : (Math.round(v * 10) / 10).toFixed(1);
    const lines = [
      `*Debriefs this week.* Score ${fmt(score.current)} (last week ${fmt(score.previous)}) over ${score.debriefs} debriefs.`,
      `${live.length} change${live.length === 1 ? '' : 's'} went live, ${undone.length} ${undone.length === 1 ? 'was' : 'were'} undone, ${stopped.length} stopped or taken back.`,
      ...live.map((i) => `• Live: ${i.text}`),
      ...undone.map(
        (i) => `• Undone: ${i.text} (${i.evidence?.undo?.reason ?? ''})`,
      ),
      ...(waits
        ? [
            `${waits} change${waits === 1 ? ' waits' : 's wait'} for a person in the Debrief console.`,
          ]
        : []),
    ];
    return (await this.slack?.post(lines.join('\n'))) ?? false;
  }
}

/** Runs by language and recipe, after against before (never across them). */
export function slicesOf(
  after: ScoredRun[],
  before: ScoredRun[],
): WatchSlice[] {
  const map = new Map<string, WatchSlice>();
  const slice = (r: ScoredRun) => {
    const k = `${r.language}|${r.recipe}`;
    let s = map.get(k);
    if (!s) {
      s = { language: r.language, recipe: r.recipe, after: [], before: [] };
      map.set(k, s);
    }
    return s;
  };
  for (const r of after) slice(r).after.push(r);
  for (const r of before) slice(r).before.push(r);
  return [...map.values()];
}
