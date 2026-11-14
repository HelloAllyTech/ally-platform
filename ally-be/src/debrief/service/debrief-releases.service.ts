import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import { AgentReleaseAuditAction } from '../../llm-agent/harness/enum/harness.enum';
import { canonicalHash } from '../../llm-agent/harness/release/canonical-hash.util';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_MODELS,
  DEBRIEF_REGISTRY_AGENTS,
  DEBRIEF_REPLY_DEFAULT,
  DEBRIEF_SEED_BUNDLE,
  providerOfModel,
  DebriefBundle,
  DebriefStep,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import { PINNED_RULE_PROMPTS } from '../util/debrief-console-view.util';
import {
  applyStepEdits,
  BUDGET_SETTING_KEYS,
  bundleDiff,
  changedExcerpt,
  promptLabel,
  stepLabel,
  isFixedStep,
  ladderOf,
  OPTIONAL_STEPS,
  StepEdit,
  withPinnedPrompts,
} from '../util/debrief-releases.util';
import { DebriefRunnerService } from './debrief-runner.service';
import { AgentReleaseAuthorKind } from '../../llm-agent/harness/enum/harness.enum';
import {
  describePath,
  leaves,
  mergeCodeRelease,
} from '../util/debrief-code-merge.util';
import {
  onPromptPublished,
  PromptPublishedEvent,
} from '../../prompt/util/prompt-published.events';
import { DebriefNotifier } from './debrief-notifier.service';

/** The bundle a release really runs: unpinned prompts at the versions recorded for it (plan §8.8). */
const eff = (r: Record<string, any>) =>
  withPinnedPrompts(
    r.bundle as DebriefBundle,
    r.changeSet?.pinnedPrompts as Record<string, number> | undefined,
  );

/** The deploy's tag for a code release (the image's version), when known. */
/** The advisory lock around the deploy's code-defaults check. */
const DEFAULTS_LOCK = 'debrief-code-defaults';

const codeTag = (): string | null =>
  process.env.APP_VERSION ?? process.env.npm_package_version ?? null;

/** A waiting release as the Releases page and the attention item show it. */
export function waitingView(w: {
  id: string;
  version: number;
  title: string;
  source: Record<string, any>;
  conflicts: any[];
  problems: string[];
}) {
  return {
    id: w.id,
    version: w.version,
    title: w.title,
    source: {
      kind: w.source.kind as 'skills_store' | 'code',
      by: w.source.by ?? null,
      tag: w.source.tag ?? null,
      promptCode: w.source.promptCode ?? null,
      from: w.source.from ?? null,
      to: w.source.to ?? null,
      note: w.source.note ?? null,
    },
    // The promoted changes it would undo.
    wouldUndo: w.conflicts.map((c: Record<string, any>) => ({
      path: c.path as string,
      what: c.what as string,
      live: c.live ?? null,
      wouldBecome: c.code ?? null,
      changedBy: c.changedBy ?? null,
    })),
    problems: w.problems,
  };
}

const num = (v: unknown, d = 2) =>
  v == null || !Number.isFinite(Number(v))
    ? null
    : Math.round(Number(v) * 10 ** d) / 10 ** d;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Release settings a person may change through Settings (each makes a proposal). */
export const RELEASE_SETTING_KEYS = [
  'runCeilingUsd',
  'monthlyCapUsd',
  'passScore',
] as const;
export type ReleaseSettingChange = Partial<
  Record<(typeof RELEASE_SETTING_KEYS)[number], number>
>;

/**
 * Providers each place can call in production today (as the Console's model
 * picker): the Anthropic account has no credit yet.
 */
const RUNNABLE_PROVIDERS = ['gemini', 'openai'];

/** Registry agents that are also recipe steps: listed once, as the step. */
const STEP_AGENTS = new Set(['analyst', 'progress_reader', 'guidance_lookup']);
const STEP_ORDER: string[] = [
  DebriefStep.SAFETY_READER,
  DebriefStep.ANALYST,
  DebriefStep.PROGRESS_READER,
  DebriefStep.GUIDANCE_LOOKUP,
  DebriefStep.WRITER,
  DebriefStep.CHECKS,
  DebriefStep.EVALUATOR,
  DebriefStep.REVISER,
];

interface LivePeriod {
  from: string;
  to: string | null;
  via: 'promoted' | 'rolled_back' | 'emergency_rollback';
  fromReleaseId: string | null;
  reason: string | null;
}

/**
 * The redesigned Releases page (like a GitHub Releases page; ideas are the
 * PRs): only releases that have been live, each with where it came from,
 * when it went live and why it was retired, the evidence before going live
 * (the idea's ladder) and while live (compared with the release before it),
 * and what is in it. A change is never made to a live release: a person
 * proposes a change as an idea that carries a draft release, and it climbs
 * the same ladder as the PM agent's ideas.
 */
@Injectable()
export class DebriefReleasesService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly releases: AgentReleaseService,
    private readonly runner: DebriefRunnerService,
    @Optional() private readonly notifier?: DebriefNotifier,
  ) {}

  // --- Live history --------------------------------------------------------------------

  /** Every time a release went live, and what replaced it, from the release audit. */
  private async periods(): Promise<Map<string, LivePeriod[]>> {
    const rows: Array<{
      releaseId: string;
      action: string;
      detail: Record<string, any> | null;
      createdAt: Date;
    }> = await this.dataSource.query(
      `SELECT "releaseId", action, detail, "createdAt" FROM agent_release_audit
        WHERE "agentKey" = $1 AND action IN ('promoted','rolled_back','emergency_rollback')
        ORDER BY "createdAt" ASC`,
      [DEBRIEF_AGENT_KEY],
    );
    const out = new Map<string, LivePeriod[]>();
    let current: LivePeriod | null = null;
    for (const r of rows) {
      if (current && !current.to)
        current.to = new Date(r.createdAt).toISOString();
      const p: LivePeriod = {
        from: new Date(r.createdAt).toISOString(),
        to: null,
        via: r.action as LivePeriod['via'],
        fromReleaseId: (r.detail?.fromReleaseId as string) ?? null,
        reason: (r.detail?.reason as string) ?? null,
      };
      out.set(r.releaseId, [...(out.get(r.releaseId) ?? []), p]);
      current = p;
    }
    return out;
  }

  /** The idea a release came from: the one whose draft or canary it was. */
  private async ideasByRelease(): Promise<Map<string, Record<string, any>>> {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT id, text, status, change, evidence, "createdAt", "releaseId" FROM agent_lessons
        WHERE "agentKey" = $1
          AND ("releaseId" IS NOT NULL OR change ? 'releaseId' OR evidence->'canary' ? 'releaseId')`,
      [DEBRIEF_AGENT_KEY],
    );
    const out = new Map<string, Record<string, any>>();
    for (const i of rows) {
      for (const id of [
        i.releaseId,
        i.change?.releaseId,
        i.evidence?.canary?.releaseId,
      ]) {
        if (id && !out.has(id)) out.set(id, i);
      }
    }
    return out;
  }

  private cameFrom(
    r: Record<string, any>,
    idea: Record<string, any> | null,
    lastLive: LivePeriod | null,
    versions: Map<string, number>,
  ) {
    if (lastLive && lastLive.via !== 'promoted') {
      return {
        kind: 'roll_back' as const,
        fromVersion: lastLive.fromReleaseId
          ? (versions.get(lastLive.fromReleaseId) ?? null)
          : null,
        reason: lastLive.reason,
      };
    }
    if (idea) {
      return {
        kind: 'idea' as const,
        ideaId: idea.id as string,
        title: idea.text as string,
        proposedBy: idea.change?.ideaKind === 'release' ? 'person' : 'pm_agent',
      };
    }
    const src = r.changeSet?.source as Record<string, any> | undefined;
    if (src?.kind === 'skills_store') {
      return {
        kind: 'skills_store' as const,
        by: src.by
          ? { id: Number(src.by), name: r.createdByName ?? null }
          : null,
        promptCode: src.promptCode as string,
        from: (src.from as number | null) ?? null,
        to: src.to as number,
        note: (src.note as string | null) ?? null,
      };
    }
    if (src?.kind === 'code' || r.authorKind === 'seed') {
      return {
        kind: 'code' as const,
        tag: (src?.tag as string | null) ?? null,
        promptCode: (src?.promptCode as string | null) ?? null,
        note: r.notes ?? null,
      };
    }
    return {
      kind: 'settings_change' as const,
      by: r.createdBy
        ? { id: Number(r.createdBy), name: r.createdByName ?? null }
        : null,
      note: r.notes ?? null,
    };
  }

  /**
   * Releases that have been live, newest first: Live and Retired. Drafts,
   * tests and canaries belong to their idea and are not listed here.
   */
  async list() {
    const [rows, periods, ideas] = await Promise.all([
      this.dataSource.query(
        `SELECT r.id, r.version, r.status, r."authorKind", r."createdBy", u.name AS "createdByName",
                r.notes, r."changeSet", r."createdAt", r."promotedAt", r."retiredAt", r."parentReleaseId"
           FROM agent_releases r LEFT JOIN users u ON u.id = r."createdBy"
          WHERE r."agentKey" = $1 AND r."promotedAt" IS NOT NULL
          ORDER BY r.version DESC LIMIT 200`,
        [DEBRIEF_AGENT_KEY],
      ) as Promise<Array<Record<string, any>>>,
      this.periods(),
      this.ideasByRelease(),
    ]);
    const versions = new Map(
      rows.map((r) => [r.id as string, Number(r.version)]),
    );
    return {
      items: rows.map((r) => this.summary(r, periods, ideas, versions)),
      // Releases from the Skills Store or code that wait because they would
      // undo a promoted change: Promote (accept the overwrite) or Dismiss.
      waiting: (await this.waitingReleases()).map((w) => waitingView(w)),
    };
  }

  private summary(
    r: Record<string, any>,
    periods: Map<string, LivePeriod[]>,
    ideas: Map<string, Record<string, any>>,
    versions: Map<string, number>,
  ) {
    const mine = periods.get(r.id) ?? [];
    const last = mine[mine.length - 1] ?? null;
    // Who replaced it: the next live start whose `fromReleaseId` is this one.
    let retired: {
      at: string;
      reason: 'replaced' | 'rolled_back';
      byVersion: number | null;
      why: string | null;
    } | null = null;
    if (r.status !== 'ga' && last?.to) {
      let next: { id: string; p: LivePeriod } | null = null;
      for (const [id, ps] of periods) {
        for (const p of ps) {
          if (p.fromReleaseId === r.id && p.from === last.to) next = { id, p };
        }
      }
      retired = {
        at: last.to,
        reason: next && next.p.via !== 'promoted' ? 'rolled_back' : 'replaced',
        byVersion: next ? (versions.get(next.id) ?? null) : null,
        why: next?.p.reason ?? null,
      };
    } else if (r.status !== 'ga' && r.retiredAt) {
      retired = {
        at: iso(r.retiredAt)!,
        reason: 'replaced',
        byVersion: null,
        why: null,
      };
    }
    const idea = ideas.get(r.id) ?? null;
    return {
      id: r.id as string,
      version: Number(r.version),
      status: r.status === 'ga' ? ('live' as const) : ('retired' as const),
      title: (idea?.text as string) ?? r.notes ?? `Release v${r.version}`,
      summary:
        (r.changeSet?.source?.note as string | undefined) ??
        (idea?.evidence?.hypothesis as string | undefined) ??
        (idea?.evidence?.why as string | undefined) ??
        null,
      cameFrom: this.cameFrom(r, idea, last, versions),
      wentLiveAt: last?.from ?? iso(r.promotedAt),
      liveTimes: mine.length,
      retired,
    };
  }

  /** One release: where it came from, evidence before and while live, and what is in it. */
  async detail(id: string) {
    const [r] = await this.dataSource.query(
      `SELECT r.*, u.name AS "createdByName" FROM agent_releases r
         LEFT JOIN users u ON u.id = r."createdBy"
        WHERE r.id = $1 AND r."agentKey" = $2`,
      [id, DEBRIEF_AGENT_KEY],
    );
    if (!r) throw new NotFoundException('Release not found');
    const [periods, ideas] = await Promise.all([
      this.periods(),
      this.ideasByRelease(),
    ]);
    const all: Array<{ id: string; version: number }> =
      await this.dataSource.query(
        `SELECT id, version FROM agent_releases WHERE "agentKey" = $1`,
        [DEBRIEF_AGENT_KEY],
      );
    const versions = new Map(all.map((x) => [x.id, Number(x.version)]));
    const summary = this.summary(r, periods, ideas, versions);
    const idea = ideas.get(r.id) ?? null;
    const mine = periods.get(r.id) ?? [];
    const last = mine[mine.length - 1] ?? null;
    // The release before it: the one it replaced when it last went live.
    const previousId = last?.fromReleaseId ?? r.parentReleaseId ?? null;
    const previous = previousId
      ? await this.releases.getById(previousId).catch(() => null)
      : null;
    const prevPeriods = previous ? (periods.get(previous.id) ?? []) : [];
    const prevLast = prevPeriods[prevPeriods.length - 1] ?? null;
    const whileLive = last
      ? await this.liveMetrics(r.id, last.from, last.to)
      : null;
    const prevLive =
      previous && prevLast
        ? await this.liveMetrics(previous.id, prevLast.from, prevLast.to)
        : null;
    return {
      ...summary,
      previous: previous
        ? { id: previous.id, version: previous.version }
        : null,
      evidence: {
        beforeLive: {
          ladder: ladderOf(
            idea,
            r.changeSet?.source?.kind === 'skills_store'
              ? 'skipped (Skills Store edit)'
              : r.changeSet?.source?.kind === 'code' || r.authorKind === 'seed'
                ? 'skipped (code release)'
                : 'made before releases went through the ladder',
          ),
          ideaId: idea?.id ?? null,
        },
        whileLive: whileLive
          ? {
              ...whileLive,
              previous: prevLive,
              period: { from: last!.from, to: last!.to },
            }
          : null,
      },
      notes: await this.releaseNotes(r, previous ? eff(previous) : null, idea),
      // The full inventory: secondary to the notes.
      contents: await this.contents(
        eff(r),
        previous ? eff(previous) : null,
        r.id,
      ),
      compareWith: previous ? previous.id : null,
    };
  }

  /**
   * Release notes: one plain sentence, and each change against the release
   * before it. Prompt, setting, step and model changes come from the version
   * diff; what and why come from the idea (the PM agent's or a person's
   * proposal). A code release has only the notes a person wrote for it
   * (`changeSet.notes`), else `written: false` ("No notes written").
   */
  async releaseNotes(
    r: Record<string, any>,
    previous: DebriefBundle | null,
    idea: Record<string, any> | null,
  ) {
    const bundle = eff(r);
    const diff = bundleDiff(previous, bundle);
    let why: string | null = null;
    let what: string | null = null;
    let proposer: string | null = null;
    if (idea) {
      what = idea.text ?? null;
      const ev = idea.evidence ?? {};
      if (idea.change?.ideaKind === 'release') {
        const [u] = ev.proposedBy
          ? await this.dataSource.query(
              `SELECT name FROM users WHERE id = $1`,
              [Number(ev.proposedBy)],
            )
          : [];
        proposer = u?.name ?? 'a person';
        why = `${ev.why ? `${ev.why} ` : ''}(proposed by ${proposer}; idea ${idea.id})`;
      } else {
        const problem =
          ev.problem?.summary ?? ev.hypothesis ?? ev.evidence ?? null;
        why = `${problem ? `${problem} ` : ''}(idea ${idea.id})`;
      }
    } else if (r.changeSet?.source) {
      const src = r.changeSet.source as Record<string, any>;
      what = src.promptCode
        ? `${promptLabel(src.promptCode)} prompt v${src.from ?? '?'} → v${src.to}`
        : `Code defaults${src.tag ? ` · ${src.tag}` : ''}`;
      why = src.note ?? 'No note written';
    } else if (r.authorKind !== 'seed' && r.notes) {
      what = r.notes;
      why = r.createdByName ? `Changed by ${r.createdByName}` : null;
    }
    const text = async (code: string, version: number | null) => {
      const [row] = await this.dataSource.query(
        `SELECT pv.version, pv.prompt FROM prompts p
           JOIN prompts_versions pv ON pv."promptId" = p.id
          WHERE p."promptCode" = $1 AND pv.version = COALESCE($2::int, p."currentVersion")`,
        [code, version],
      );
      return row
        ? { version: Number(row.version), text: String(row.prompt) }
        : null;
    };
    const changes: Array<{
      area: string;
      what: string | null;
      why: string | null;
      before: string | null;
      after: string | null;
      source: 'diff';
    }> = [];
    for (const p of diff.prompts) {
      const [b, a] = await Promise.all([
        text(p.code, p.before),
        text(p.code, p.after),
      ]);
      const ex = changedExcerpt(b?.text ?? null, a?.text ?? null);
      changes.push({
        area: `${promptLabel(p.code)} prompt v${b?.version ?? p.before ?? '?'} → v${a?.version ?? p.after ?? '?'}`,
        what,
        why,
        before: ex.before,
        after: ex.after,
        source: 'diff',
      });
    }
    for (const st of diff.settings) {
      changes.push({
        area: 'Settings',
        what: what ?? `${st.key} changed`,
        why,
        before: `${st.key}: ${JSON.stringify(st.before ?? null)}`,
        after: `${st.key}: ${JSON.stringify(st.after ?? null)}`,
        source: 'diff',
      });
    }
    for (const st of diff.steps) {
      changes.push({
        area: st.field === 'enabled' ? 'Step' : 'Model',
        what:
          what ??
          (st.field === 'enabled'
            ? `${stepLabel(st.step)} turned ${st.after ? 'on' : 'off'}`
            : `${stepLabel(st.step)} ${st.field === 'model' ? 'model' : 'fallback model'} changed`),
        why,
        before:
          st.field === 'enabled'
            ? st.before
              ? 'On'
              : 'Off'
            : String(st.before ?? 'none'),
        after:
          st.field === 'enabled'
            ? st.after
              ? 'On'
              : 'Off'
            : String(st.after ?? 'none'),
        source: 'diff',
      });
    }
    if (diff.reply) {
      changes.push({
        area: 'Model',
        what: what ?? 'Ask Ally model changed',
        why,
        before: (diff.reply.before as any)?.model ?? null,
        after: (diff.reply.after as any)?.model ?? null,
        source: 'diff',
      });
    }
    for (const rc of diff.recipes) {
      changes.push({
        area: `Recipe: ${rc.recipe}`,
        what: what ?? 'Recipe changed',
        why,
        before: JSON.stringify(rc.before),
        after: JSON.stringify(rc.after),
        source: 'diff',
      });
    }
    if (diff.orchestrator) {
      changes.push({
        area: 'Orchestrator',
        what: what ?? 'Orchestrator settings changed',
        why,
        before: JSON.stringify(diff.orchestrator.before),
        after: JSON.stringify(diff.orchestrator.after),
        source: 'diff',
      });
    }
    if (r.changeSet?.pinSource === 'migration') {
      const fallbacks = (r.changeSet?.pinFallbacks ?? []) as string[];
      changes.push({
        area: 'Prompt versions',
        what: 'Prompt versions recorded after the fact',
        why:
          `This release did not name exact versions for ${fallbacks.length ? fallbacks.map(promptLabel).join(', ') : 'some prompts'}; ` +
          'the versions live when the record was made (migration 1981900750000) are what it restores.',
        before: null,
        after: null,
        source: 'diff',
      });
    }
    const merge = r.changeSet?.merge as Record<string, any> | undefined;
    for (const c of (merge?.conflicts ?? []) as Array<Record<string, any>>) {
      changes.push({
        area: 'Would undo a change put live for everyone',
        what: `${c.changedBy?.label ?? 'A change put live for everyone'} on ${c.what}`,
        why: 'A Skills Store or code release never overwrites a change a person put live without asking',
        before: JSON.stringify(c.live ?? null),
        after: JSON.stringify(c.code ?? null),
        source: 'diff',
      });
    }
    if (merge?.keptFromLive?.length) {
      changes.push({
        area: 'Carried forward',
        what: `Kept ${merge.keptFromLive.length} change(s) put live for everyone: ${(merge.keptFromLive as string[]).map(describePath).join(', ')}`,
        why: 'Changes put live for everyone that this release does not touch stay as they are',
        before: null,
        after: null,
        source: 'diff',
      });
    }
    const src = r.changeSet?.source as Record<string, any> | undefined;
    const summary = idea
      ? (idea.evidence?.hypothesis ?? idea.evidence?.why ?? idea.text ?? null)
      : src
        ? `${what}${src.note ? `: ${src.note}` : ''}`
        : r.authorKind !== 'seed'
          ? (r.notes ?? null)
          : null;
    return {
      summary,
      changes,
      // Notes are derived from the idea, the proposer or the Skills Store
      // note; with none, `why` says "No note written".
      written: !!(idea || src?.note || (r.authorKind !== 'seed' && r.notes)),
    };
  }

  /** Debriefs written, judge median, hard fails, cost and time over a live period. */
  private async liveMetrics(
    releaseId: string,
    from: string,
    to: string | null,
  ) {
    const [m] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status <> 'skipped')::int AS debriefs,
              count(*) FILTER (WHERE workspace ? 'judge')::int AS judged,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY (workspace->'judge'->>'overall')::float)
                FILTER (WHERE workspace ? 'judge') AS judge_median,
              count(*) FILTER (WHERE jsonb_array_length(coalesce(workspace->'judge'->'hardFails','[]'::jsonb)) > 0)::int AS hard_fails,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE("actualCostUsd","estimatedCostUsd")::float)
                FILTER (WHERE status <> 'skipped') AS cost_p50,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM "finishedAt" - "startedAt"))
                FILTER (WHERE status <> 'skipped' AND "finishedAt" IS NOT NULL) AS secs_p50
         FROM debrief_runs
        WHERE mode IN ('shadow','live') AND "releaseId" = $1
          AND "createdAt" >= $2 AND ($3::timestamp IS NULL OR "createdAt" < $3::timestamp)`,
      [releaseId, from, to],
    );
    return {
      debriefs: Number(m?.debriefs ?? 0),
      judged: Number(m?.judged ?? 0),
      judgeMedian: num(m?.judge_median),
      hardFails: Number(m?.hard_fails ?? 0),
      costPerDebriefUsd: num(m?.cost_p50, 4),
      secondsToDebrief: num(m?.secs_p50, 0),
    };
  }

  /**
   * What is in a bundle: prompts and recipes with their Skills Store
   * versions, changed against `previous`, and whether each is pinned; steps
   * and models with On / Off / Fixed, who made them, how often they ran and
   * what they cost on this release; the settings it carries; pinned rules.
   */
  async contents(
    bundle: DebriefBundle,
    previous: DebriefBundle | null,
    releaseId: string | null,
  ) {
    const diff = bundleDiff(previous, bundle);
    const changedPrompts = new Set(diff.prompts.map((p) => p.code));
    const codes = Object.keys(bundle.prompts ?? {});
    const current: Array<{ code: string; id: string; currentVersion: number }> =
      codes.length
        ? await this.dataSource.query(
            `SELECT "promptCode" AS code, id, "currentVersion" FROM prompts WHERE "promptCode" = ANY($1)`,
            [codes],
          )
        : [];
    const byCode = new Map(current.map((c) => [c.code, c]));
    const pinnedCodes = new Set(PINNED_RULE_PROMPTS.map((p) => p.code));
    const prompts = codes.map((code) => {
      const pinnedVersion = bundle.prompts[code];
      return {
        code,
        promptId: byCode.get(code)?.id ?? null,
        version: pinnedVersion ?? byCode.get(code)?.currentVersion ?? null,
        // null in the bundle: the release runs the Skills Store's current version.
        followsCurrent: pinnedVersion == null,
        changed: changedPrompts.has(code),
        lock: pinnedCodes.has(code)
          ? ('pinned' as const)
          : ('release_only' as const),
      };
    });
    const recipes = Object.values(bundle.recipes)
      .filter(Boolean)
      .map((rc) => ({
        key: rc!.key,
        steps: rc!.steps.map((s) => s.step),
        maxRevisionRounds: rc!.maxRevisionRounds,
        shortForm: rc!.shortForm,
        changed: diff.recipes.some((d) => d.recipe === rc!.key),
      }));
    const usage = releaseId ? await this.stepUsage(releaseId) : new Map();
    const present = new Map<
      string,
      { model: string | null; backupModel: string | null }
    >();
    for (const rc of Object.values(bundle.recipes)) {
      for (const s of rc?.steps ?? []) {
        if (!present.has(s.step)) {
          present.set(s.step, {
            model: s.model ?? null,
            backupModel: s.backupModel ?? null,
          });
        }
      }
    }
    const stepRows: Array<Record<string, unknown>> = [];
    for (const step of STEP_ORDER) {
      const p = present.get(step);
      if (!p && !(OPTIONAL_STEPS as readonly string[]).includes(step)) continue;
      const u = usage.get(step);
      stepRows.push({
        step,
        model: p?.model ?? null,
        backupModel: p?.backupModel ?? null,
        status: isFixedStep(step) ? 'fixed' : p ? 'on' : 'off',
        createdBy: 'code',
        usedPct: u?.usedPct ?? null,
        costPerRunUsd: u?.costPerRunUsd ?? null,
        // Win rates need step-level trials (model trials are Release 2).
        winRate: null,
        changed: diff.steps.some((d) => d.step === step),
      });
    }
    const agents = new Map(
      (bundle.orchestrator?.agents ?? []).map((a) => [a.id as string, a]),
    );
    for (const id of Object.keys(DEBRIEF_REGISTRY_AGENTS)) {
      if (STEP_AGENTS.has(id)) continue;
      const a = agents.get(id);
      const key = `agent:${id}`;
      const u = usage.get(id);
      stepRows.push({
        step: key,
        model: a?.model ?? null,
        backupModel: a?.backupModel ?? null,
        status: bundle.orchestrator?.enabled && a ? 'on' : 'off',
        createdBy: 'code',
        usedPct: u?.usedPct ?? null,
        costPerRunUsd: u?.costPerRunUsd ?? null,
        winRate: null,
        changed: diff.steps.some((d) => d.step === key),
      });
    }
    stepRows.push({
      step: 'judge',
      model: DEBRIEF_MODELS.judge,
      backupModel: null,
      status: 'fixed',
      createdBy: 'code',
      usedPct: null,
      costPerRunUsd: null,
      winRate: null,
      changed: false,
    });
    const s = bundle.settings as unknown as Record<string, unknown>;
    const settings = [
      ...Object.keys(s).map((k) => ({
        key: k,
        value: s[k],
        budget: (BUDGET_SETTING_KEYS as readonly string[]).includes(k),
        changed: diff.settings.some((d) => d.key === k),
      })),
      {
        key: 'maxRevisionRounds',
        value: bundle.recipes.standard?.maxRevisionRounds ?? null,
        budget: false,
        changed: diff.recipes.some(
          (d) =>
            d.recipe === 'standard' &&
            (d.before as any)?.maxRevisionRounds !==
              (d.after as any)?.maxRevisionRounds,
        ),
      },
    ];
    const pinned = await Promise.all(
      PINNED_RULE_PROMPTS.map(async (p) => {
        const inBundle = p.code in (bundle.prompts ?? {});
        const [row] = await this.dataSource.query(
          `SELECT "currentVersion" FROM prompts WHERE "promptCode" = $1`,
          [p.code],
        );
        return {
          code: p.code,
          label: p.label,
          version: inBundle
            ? (bundle.prompts[p.code] ?? row?.currentVersion ?? null)
            : (row?.currentVersion ?? null),
          inRelease: inBundle,
        };
      }),
    );
    return {
      prompts,
      recipes,
      steps: stepRows,
      reply: bundle.reply ?? null,
      orchestrator: bundle.orchestrator
        ? { ...bundle.orchestrator, agents: undefined }
        : null,
      settings,
      pinned,
      changedVsPrevious: diff,
    };
  }

  /** On this release's production runs: how often each step ran, and its cost per run. */
  private async stepUsage(releaseId: string) {
    const rows: Array<{
      step: string;
      runs: number;
      done: number;
      usd: number;
    }> = await this.dataSource.query(
      `WITH r AS (
           SELECT id, steps FROM debrief_runs
            WHERE "releaseId" = $1 AND mode IN ('shadow','live') AND status <> 'skipped')
         SELECT s->>'step' AS step, (SELECT count(*) FROM r)::int AS runs,
                count(DISTINCT r.id) FILTER (WHERE s->>'status' = 'done')::int AS done,
                COALESCE(sum((s->>'estimatedUsd')::float), 0)::float AS usd
           FROM r, jsonb_array_elements(COALESCE(r.steps, '[]'::jsonb)) s
          GROUP BY 1`,
      [releaseId],
    );
    return new Map(
      rows.map((x) => [
        x.step,
        {
          usedPct: x.runs ? Math.round((x.done / x.runs) * 100) : null,
          costPerRunUsd: x.done ? num(x.usd / x.done, 4) : null,
        },
      ]),
    );
  }

  /**
   * Compare two releases (`withId` defaults to the one before): the changes,
   * and for each changed prompt both texts with their Skills Store versions,
   * for the Skills Store's own diff view.
   */
  async compare(id: string, withId?: string) {
    const a = await this.releases.getById(id);
    let b = withId ? await this.releases.getById(withId) : null;
    if (!b) {
      const periods = await this.periods();
      const mine = periods.get(id) ?? [];
      const from =
        mine[mine.length - 1]?.fromReleaseId ?? a.parentReleaseId ?? null;
      b = from ? await this.releases.getById(from).catch(() => null) : null;
    }
    const diff = bundleDiff(b ? eff(b) : null, eff(a));
    const text = async (code: string, version: number | null) => {
      const [row] = await this.dataSource.query(
        `SELECT p.id, pv.version, pv.prompt FROM prompts p
           JOIN prompts_versions pv ON pv."promptId" = p.id
          WHERE p."promptCode" = $1 AND pv.version = COALESCE($2::int, p."currentVersion")`,
        [code, version],
      );
      return row
        ? { promptId: row.id, version: Number(row.version), text: row.prompt }
        : null;
    };
    const prompts = await Promise.all(
      diff.prompts.map(async (p) => ({
        code: p.code,
        pinned: p.pinned,
        before: await text(p.code, p.before),
        after: await text(p.code, p.after),
      })),
    );
    return {
      release: { id: a.id, version: a.version },
      against: b ? { id: b.id, version: b.version } : null,
      ...diff,
      prompts,
    };
  }

  // --- Releases from the Skills Store and from code ---------------------------------

  /** One at a time in this process: each change starts from the release live after the last. */
  private sourceQueue: Promise<unknown> = Promise.resolve();
  /** The code defaults this process already compared with (rule: a deploy that changes nothing makes nothing). */
  private checkedDefaultsHash: string | null = null;

  onModuleInit(): void {
    // A debrief prompt published in the Skills Store becomes a release.
    onPromptPublished(async (e) => {
      await this.fromPublish(e);
    });
  }

  /**
   * A debrief prompt published in the Skills Store (dashboard, `prompts` CLI,
   * revert, experiment) becomes a release with that version: live at once,
   * unless it would undo a promoted PM-agent or person-proposed change.
   * Pinned rules are not affected (their own sign-off route), nor prompts the
   * live release does not use.
   */
  async fromPublish(e: PromptPublishedEvent) {
    if (PINNED_RULE_PROMPTS.some((p) => p.code === e.promptCode)) return null;
    const run = () => this.fromPublishNow(e);
    const next = this.sourceQueue.then(run, run);
    this.sourceQueue = next.catch(() => undefined);
    return next;
  }

  private async fromPublishNow(e: PromptPublishedEvent) {
    const ga = await this.releases.getGa(DEBRIEF_AGENT_KEY);
    if (!ga) return null;
    const live = eff(ga);
    if (!(e.promptCode in (live.prompts ?? {}))) return null;
    if (live.prompts[e.promptCode] === e.version) return null;
    const base = JSON.parse(JSON.stringify(live)) as DebriefBundle;
    base.prompts[e.promptCode] = e.previousVersion;
    const next = JSON.parse(JSON.stringify(live)) as DebriefBundle;
    next.prompts[e.promptCode] = e.version;
    const kind = e.source === 'sync' ? 'code' : 'skills_store';
    return this.releaseFromSource(base, live, next, ga, {
      kind,
      by: e.createdBy || null,
      promptCode: e.promptCode,
      from: e.previousVersion,
      to: e.version,
      note: e.note?.trim() || null,
      tag: kind === 'code' ? codeTag() : null,
    });
  }

  /**
   * A deploy whose default models, settings or recipes changed: one release
   * with the code's changes on top of what people promoted, by the same rule.
   * A deploy that changes no release contents makes no release. Default
   * prompt texts reach learners through the Skills Store sync, as a publish.
   */
  async fromCodeDefaults(defaults: DebriefBundle = DEBRIEF_SEED_BUNDLE) {
    const hash = canonicalHash(defaults);
    if (this.checkedDefaultsHash === hash) return null;
    const run = () =>
      this.withDefaultsLock(() => this.defaultsOnce(defaults, hash));
    const next = this.sourceQueue.then(run, run);
    this.sourceQueue = next.catch(() => undefined);
    return next;
  }

  /**
   * One instance at a time across the deployment (several start together on
   * a deploy): a Postgres session advisory lock on its own connection. An
   * instance that does not get it skips; the holder makes the release, and
   * the next check sees it recorded and does nothing.
   */
  private async withDefaultsLock<T>(work: () => Promise<T>): Promise<T | null> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      const [row] = await qr.query(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
        [DEFAULTS_LOCK],
      );
      if (!row?.locked) return null;
      try {
        return await work();
      } finally {
        await qr.query(`SELECT pg_advisory_unlock(hashtext($1))`, [
          DEFAULTS_LOCK,
        ]);
      }
    } finally {
      await qr.release();
    }
  }

  private async defaultsOnce(defaults: DebriefBundle, hash: string) {
    const ga = await this.releases.getGa(DEBRIEF_AGENT_KEY);
    if (!ga) return null;
    const [last] = await this.dataSource.query(
      `SELECT bundle, "changeSet", "authorKind" FROM agent_releases
        WHERE "agentKey" = $1
          AND ("authorKind" = 'seed' OR "changeSet" ? 'codeDefaults')
        ORDER BY version DESC LIMIT 1`,
      [DEBRIEF_AGENT_KEY],
    );
    const base = ((last?.changeSet?.codeDefaults as
      | DebriefBundle
      | undefined) ??
      (last?.bundle as DebriefBundle | undefined) ??
      null) as DebriefBundle | null;
    if (base && canonicalHash(base) === hash) {
      this.checkedDefaultsHash = hash;
      return null;
    }
    const out = await this.releaseFromSource(base, eff(ga), defaults, ga, {
      kind: 'code',
      by: null,
      tag: codeTag(),
      codeDefaults: defaults,
    });
    this.checkedDefaultsHash = hash;
    return out;
  }

  /**
   * The one rule for a change from the Skills Store or from code. Three-way
   * merge (base = what the source said before, live = the release in force,
   * next = what the source says now): the source's changes on top of what
   * people promoted. Nothing moves: no release. No conflict: a new release,
   * live now (the owner is told). A conflict — it would undo a promoted
   * PM-agent or person-proposed change — : the release waits as a draft (all
   * of it; parts are not shipped separately), the owner and the Ally team are
   * told, Debriefs home and the PM agent show a red item, and a person
   * promotes it (accepting the overwrite) or dismisses it.
   */
  async releaseFromSource(
    base: DebriefBundle | null,
    live: DebriefBundle,
    next: DebriefBundle,
    ga: { id: string; version: number },
    source: {
      kind: 'skills_store' | 'code';
      by: number | null;
      tag: string | null;
      promptCode?: string;
      from?: number | null;
      to?: number;
      note?: string | null;
      codeDefaults?: DebriefBundle;
    },
  ): Promise<{
    releaseId: string;
    version: number;
    live: boolean;
    conflicts: number;
  } | null> {
    const m = mergeCodeRelease(base, live, next);
    // Only promoted PM-agent or person-proposed changes count as conflicts;
    // a value the store or code itself set earlier is just carried along.
    const blame = m.conflicts.length
      ? await this.whoChanged(m.conflicts.map((c) => c.path))
      : new Map();
    const conflicts = m.conflicts
      .filter((c) => blame.has(c.path))
      .map((c) => ({
        ...c,
        what: describePath(c.path),
        changedBy: blame.get(c.path)!,
      }));
    if (!m.fromCode.length && !m.conflicts.length) return null;
    const problems = validateDebriefBundle(
      m.merged,
      await this.runner.modelCatalog(),
    );
    const title =
      source.promptCode != null
        ? `${promptLabel(source.promptCode)} prompt v${source.from ?? '?'} → v${source.to}`
        : `Code defaults${source.tag ? ` · ${source.tag}` : ''}`;
    const draft = await this.releases.createDraft(
      DEBRIEF_AGENT_KEY,
      m.merged as unknown as Record<string, unknown>,
      source.by ?? 0,
      title,
    );
    await this.dataSource.query(
      `UPDATE agent_releases
          SET "authorKind" = $2, "createdBy" = $3,
              "changeSet" = coalesce("changeSet", '{}'::jsonb) || $4::jsonb
        WHERE id = $1`,
      [
        draft.id,
        source.kind === 'code' ? 'system' : 'human',
        source.by,
        JSON.stringify({
          source: {
            kind: source.kind,
            by: source.by,
            tag: source.tag,
            promptCode: source.promptCode ?? null,
            from: source.from ?? null,
            to: source.to ?? null,
            note: source.note ?? null,
          },
          ...(source.codeDefaults ? { codeDefaults: source.codeDefaults } : {}),
          merge: {
            baseReleaseId: ga.id,
            fromSource: m.fromCode,
            keptFromLive: m.keptFromLive,
            conflicts,
            problems,
          },
        }),
      ],
    );
    await this.runner.pinPrompts({ ...draft, changeSet: null } as any);
    if (!conflicts.length && !problems.length) {
      const promoted = await this.releases.makeGa(
        draft.id,
        null,
        AgentReleaseAuditAction.PROMOTED,
        `${source.kind === 'code' ? 'code' : 'Skills Store'}: ${title}`,
        AgentReleaseAuthorKind.SYSTEM,
      );
      await this.notifier?.owner({
        title: `Debriefs: v${promoted.version} is live (${title})`,
        body:
          source.note ??
          (source.kind === 'code'
            ? 'Code defaults changed on deploy.'
            : 'Published in the Skills Store.'),
        data: { releaseId: draft.id },
        excludeUserId: source.by,
      });
      return {
        releaseId: draft.id,
        version: draft.version,
        live: true,
        conflicts: 0,
      };
    }
    const first = conflicts[0];
    const alert = {
      title: `Debriefs: v${draft.version} (${title}) is waiting`,
      body: first
        ? `It would undo ${first.changedBy.label} on ${first.what}${conflicts.length > 1 ? ` and ${conflicts.length - 1} more` : ''}. Put it live for everyone to accept the overwrite, or dismiss it.`
        : `It does not pass the release checks: ${problems.join('; ')}`,
      data: { releaseId: draft.id },
    };
    await this.notifier?.owner(alert);
    await this.notifier?.team(alert);
    return {
      releaseId: draft.id,
      version: draft.version,
      live: false,
      conflicts: conflicts.length,
    };
  }

  /**
   * Which promoted PM-agent or person-proposed release last set each path,
   * for "it would undo <change> on <what>". Releases from the Skills Store or
   * from code, and seed releases, never count.
   */
  private async whoChanged(paths: string[]) {
    const out = new Map<
      string,
      { version: number; ideaId: string | null; label: string }
    >();
    const [periods, ideas] = await Promise.all([
      this.periods(),
      this.ideasByRelease(),
    ]);
    const starts: Array<{ id: string; p: LivePeriod }> = [];
    for (const [id, ps] of periods) {
      for (const p of ps) if (p.via === 'promoted') starts.push({ id, p });
    }
    starts.sort((a, b) => a.p.from.localeCompare(b.p.from));
    for (const { id, p } of starts) {
      const r = await this.releases.getById(id).catch(() => null);
      if (!r || r.authorKind === 'seed') continue;
      const before = p.fromReleaseId
        ? await this.releases.getById(p.fromReleaseId).catch(() => null)
        : null;
      const a = leaves(before ? eff(before) : null);
      const b = leaves(eff(r));
      const fromSource = !!(r.changeSet as Record<string, any> | null)?.source;
      const idea = ideas.get(id) ?? null;
      for (const path of paths) {
        if (
          JSON.stringify(a.get(path) ?? null) !==
          JSON.stringify(b.get(path) ?? null)
        ) {
          if (fromSource) {
            // The store or code set it later: no longer a person's change.
            out.delete(path);
            continue;
          }
          out.set(path, {
            version: r.version,
            ideaId: idea?.id ?? null,
            label: idea
              ? `“${idea.text}” (idea, v${r.version})`
              : `v${r.version}${r.notes ? ` (“${r.notes}”)` : ''}`,
          });
        }
      }
    }
    return out;
  }

  /** Releases from the Skills Store or code waiting because they would undo a promoted change. */
  async waitingReleases(): Promise<
    Array<{
      id: string;
      version: number;
      title: string;
      source: Record<string, any>;
      conflicts: any[];
      problems: string[];
    }>
  > {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT id, version, notes, "changeSet" FROM agent_releases
        WHERE "agentKey" = $1 AND status = 'draft' AND "changeSet" ? 'source'
          AND NOT ("changeSet" ? 'dismissed')
        ORDER BY version DESC`,
      [DEBRIEF_AGENT_KEY],
    );
    return rows.map((r) => ({
      id: r.id,
      version: Number(r.version),
      title: r.notes ?? `Release v${r.version}`,
      source: r.changeSet?.source ?? {},
      conflicts: (r.changeSet?.merge?.conflicts ?? []) as any[],
      problems: (r.changeSet?.merge?.problems ?? []) as string[],
    }));
  }

  /** Promote a waiting release: accept the overwrite. */
  async promoteWaiting(id: string, userId: number, note?: string) {
    const r = await this.waitingOne(id);
    const live = await this.releases.makeGa(
      r.id,
      userId,
      AgentReleaseAuditAction.PROMOTED,
      note ?? 'accepted the overwrite',
    );
    await this.notifier?.owner({
      title: `Debriefs: v${live.version} is live (${r.notes ?? 'waiting release'})`,
      body: note ?? 'A person accepted the overwrite.',
      data: { releaseId: r.id },
      excludeUserId: userId,
    });
    return { id: live.id, version: live.version };
  }

  /** Dismiss a waiting release: it never goes live. */
  async dismissWaiting(id: string, userId: number, reason?: string) {
    const r = await this.waitingOne(id);
    await this.dataSource.query(
      `UPDATE agent_releases SET status = 'retired', "retiredAt" = now(),
              "changeSet" = coalesce("changeSet", '{}'::jsonb)
                || jsonb_build_object('dismissed', jsonb_build_object('by', $2::int, 'at', now()::text, 'reason', $3::text))
        WHERE id = $1 AND status = 'draft'`,
      [r.id, userId, reason ?? null],
    );
    const alert = {
      title: `Debriefs: v${r.version} (${r.notes ?? 'waiting release'}) was dismissed`,
      body: reason ? `Dismissed: ${reason}` : 'Dismissed; it will not go live.',
      data: { releaseId: r.id },
      excludeUserId: userId,
    };
    await this.notifier?.owner(alert);
    await this.notifier?.team(alert);
    return { id: r.id, dismissed: true, by: userId, reason: reason ?? null };
  }

  private async waitingOne(id: string) {
    const r = await this.releases.getById(id);
    const cs = r.changeSet as Record<string, any> | null;
    if (
      r.agentKey !== DEBRIEF_AGENT_KEY ||
      r.status !== 'draft' ||
      !cs?.source ||
      cs?.dismissed
    ) {
      throw new ConflictException(
        'only a release from the Skills Store or code that is waiting',
      );
    }
    return r;
  }

  // --- Changes: always a draft carried by an idea ----------------------------------------

  /**
   * "Propose a change" (Ideas): a person's idea that carries a draft release
   * copied from the live one, with steps turned on or off, models swapped and
   * release settings changed. It climbs the same ladder as the PM agent's
   * ideas. A change that touches only budget settings does not alter what
   * learners read: it skips the ladder and waits for the owner to put it live.
   */
  async proposeChange(
    input: {
      title: string;
      why?: string | null;
      steps?: StepEdit[];
      settings?: ReleaseSettingChange;
      /** Ask Ally's model. */
      reply?: string | null;
      /** Skills Store versions to ship, by prompt code. */
      prompts?: Record<string, number> | null;
    },
    userId: number,
  ): Promise<{
    ideaId: string;
    releaseId: string;
    version: number;
    budgetOnly: boolean;
    diff: ReturnType<typeof bundleDiff>;
  }> {
    const { release: live, bundle } = await this.runner.resolveRelease();
    const next = await this.applyChanges(
      bundle,
      input.steps,
      input.settings,
      input.reply,
      input.prompts,
    );
    const diff = bundleDiff(bundle, next);
    if (
      !diff.prompts.length &&
      !diff.settings.length &&
      !diff.recipes.length &&
      !diff.steps.length &&
      !diff.reply &&
      !diff.orchestrator
    ) {
      throw new BadRequestException('Nothing changed from the live release');
    }
    const title = (input.title ?? '').trim();
    if (!title) throw new BadRequestException('Give the change a title');
    const draft = await this.releases.createDraft(
      DEBRIEF_AGENT_KEY,
      next as unknown as Record<string, unknown>,
      userId,
      title.slice(0, 300),
    );
    // Plan §8.8: the exact prompt versions it runs, recorded now.
    await this.runner.pinPrompts(draft);
    const change = {
      ideaKind: 'release',
      route: 'A',
      releaseId: draft.id,
      baseReleaseId: live?.id ?? null,
      budgetOnly: diff.budgetOnly,
      learnerVisible: diff.learnerVisible,
    };
    const [row] = await this.dataSource.query(
      `INSERT INTO agent_lessons
         ("agentKey", kind, scope, status, text, change, evidence, "contentHash", "authorKind")
       VALUES ($1, 'policy', 'platform', 'proposed', $2, $3::jsonb, $4::jsonb, $5, 'human')
       RETURNING id`,
      [
        DEBRIEF_AGENT_KEY,
        title.slice(0, 300),
        JSON.stringify(change),
        JSON.stringify({
          why: input.why?.trim() || null,
          proposedBy: userId,
          diff: { ...diff, budgetOnly: diff.budgetOnly },
        }),
        createHash('sha256').update(`release:${draft.id}`).digest('hex'),
      ],
    );
    await this.dataSource.query(
      `INSERT INTO agent_lesson_audit ("agentKey", "lessonId", action, "actorKind", "actorUserId", detail)
       VALUES ($1, $2, 'proposed', 'human', $3, $4)`,
      [
        DEBRIEF_AGENT_KEY,
        row.id,
        userId,
        JSON.stringify({ kind: 'release', releaseId: draft.id }),
      ],
    );
    return {
      ideaId: row.id,
      releaseId: draft.id,
      version: draft.version,
      budgetOnly: diff.budgetOnly,
      diff,
    };
  }

  /**
   * An existing draft (the orchestrator challenger) becomes a person's
   * proposed change, so it shows on Ideas and climbs the ladder there.
   */
  async adoptDraft(
    releaseId: string,
    title: string,
    why: string | null,
    userId: number,
  ): Promise<{ ideaId: string; releaseId: string }> {
    const draft = await this.releases.getById(releaseId);
    const { release: live, bundle } = await this.runner.resolveRelease();
    const diff = bundleDiff(bundle, eff(draft));
    const [row] = await this.dataSource.query(
      `INSERT INTO agent_lessons
         ("agentKey", kind, scope, status, text, change, evidence, "contentHash", "authorKind")
       VALUES ($1, 'policy', 'platform', 'proposed', $2, $3::jsonb, $4::jsonb, $5, 'human')
       RETURNING id`,
      [
        DEBRIEF_AGENT_KEY,
        title.slice(0, 300),
        JSON.stringify({
          ideaKind: 'release',
          route: 'A',
          releaseId,
          baseReleaseId: live?.id ?? null,
          budgetOnly: diff.budgetOnly,
        }),
        JSON.stringify({ why, proposedBy: userId, diff }),
        createHash('sha256').update(`release:${releaseId}`).digest('hex'),
      ],
    );
    return { ideaId: row.id, releaseId };
  }

  private async applyChanges(
    bundle: DebriefBundle,
    steps?: StepEdit[],
    settings?: ReleaseSettingChange,
    reply?: string | null,
    prompts?: Record<string, number> | null,
  ): Promise<DebriefBundle> {
    let next = JSON.parse(JSON.stringify(bundle)) as DebriefBundle;
    // A Skills Store version reaches learners only through a release (§8.8).
    for (const [code, version] of Object.entries(prompts ?? {})) {
      if (!(code in (next.prompts ?? {}))) {
        throw new BadRequestException(
          `${code} is not a prompt of this release`,
        );
      }
      if (PINNED_RULE_PROMPTS.some((p) => p.code === code)) {
        throw new BadRequestException(
          `${code} is a pinned rule: propose it as a pinned-rule change`,
        );
      }
      const [row] = await this.dataSource.query(
        `SELECT 1 FROM prompts p JOIN prompts_versions pv ON pv."promptId" = p.id
          WHERE p."promptCode" = $1 AND pv.version = $2`,
        [code, version],
      );
      if (!row)
        throw new BadRequestException(`${code} has no version ${version}`);
      next.prompts[code] = version;
    }
    for (const e of steps ?? []) {
      for (const m of [e.model, e.backupModel]) {
        if (m && !RUNNABLE_PROVIDERS.includes(providerOfModel(m) as string)) {
          throw new BadRequestException(
            `${m}: debrief steps can't run on this provider yet`,
          );
        }
      }
    }
    if (reply) {
      const provider = providerOfModel(reply);
      if (!provider || !RUNNABLE_PROVIDERS.includes(provider)) {
        throw new BadRequestException(
          `${reply}: Ask Ally can't run on this provider`,
        );
      }
      next.reply = {
        ...(next.reply ?? DEBRIEF_REPLY_DEFAULT),
        provider: provider as 'gemini' | 'openai',
        model: reply,
      };
    }
    if (steps?.length) {
      const out = applyStepEdits(next, steps);
      if ('problem' in out) throw new BadRequestException(out.problem);
      next = out.bundle;
    }
    for (const [k, v] of Object.entries(settings ?? {})) {
      if (!(RELEASE_SETTING_KEYS as readonly string[]).includes(k)) {
        throw new BadRequestException(`${k} is not a release setting`);
      }
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        throw new BadRequestException(`${k} must be a positive number`);
      }
      if (k === 'passScore' && (v < 5 || v > 10)) {
        throw new BadRequestException('passScore must be 5 to 10');
      }
      if (k === 'runCeilingUsd' && v > 10) {
        throw new BadRequestException('runCeilingUsd must be at most $10');
      }
      (next.settings as unknown as Record<string, number>)[k] = v;
    }
    const problems = validateDebriefBundle(
      next,
      await this.runner.modelCatalog(),
    );
    if (problems.length) throw new BadRequestException(problems.join('; '));
    return next;
  }

  /** Change a proposal's draft before its ladder starts; afterwards, propose again. */
  async editDraft(
    ideaId: string,
    input: {
      steps?: StepEdit[];
      settings?: ReleaseSettingChange;
      reply?: string | null;
      prompts?: Record<string, number> | null;
    },
  ) {
    const [idea] = await this.dataSource.query(
      `SELECT * FROM agent_lessons WHERE id = $1 AND "agentKey" = $2`,
      [ideaId, DEBRIEF_AGENT_KEY],
    );
    if (!idea || idea.change?.ideaKind !== 'release') {
      throw new NotFoundException('No proposed change with a draft release');
    }
    if (idea.status !== 'proposed') {
      throw new ConflictException(`this idea is ${idea.status}`);
    }
    if (idea.evidence?.screen || idea.evidence?.gate || idea.evidence?.trial) {
      throw new ConflictException(
        'its tests have started; propose a new change instead',
      );
    }
    const draft = await this.releases.getById(idea.change.releaseId);
    if (draft.status !== 'draft') {
      throw new ConflictException(`its release is ${draft.status}`);
    }
    const next = await this.applyChanges(
      eff(draft),
      input.steps,
      input.settings,
      input.reply,
      input.prompts,
    );
    const { bundle: live } = await this.runner.resolveRelease();
    const diff = bundleDiff(live, next);
    await this.dataSource.query(
      `UPDATE agent_releases SET bundle = $2::jsonb, "contentHash" = $3, "updatedAt" = now()
        WHERE id = $1 AND status = 'draft'`,
      [draft.id, JSON.stringify(next), canonicalHash(next)],
    );
    await this.dataSource.query(
      `UPDATE agent_lessons
          SET change = change || jsonb_build_object('budgetOnly', $2::boolean),
              evidence = evidence || jsonb_build_object('diff', $3::jsonb),
              "updatedAt" = now()
        WHERE id = $1`,
      [ideaId, diff.budgetOnly, JSON.stringify(diff)],
    );
    return { ideaId, releaseId: draft.id, version: draft.version, diff };
  }

  /** An idea's draft release as its card shows it: version, what changed against live, compare. */
  async draftFor(idea: Record<string, any>) {
    const id =
      idea.change?.releaseId ??
      idea.evidence?.canary?.releaseId ??
      idea.releaseId ??
      null;
    if (!id) return null;
    const r = await this.releases.getById(id).catch(() => null);
    if (!r) return null;
    const { bundle: live } = await this.runner.resolveRelease();
    return {
      id: r.id,
      version: r.version,
      status: r.status,
      changedVsLive: bundleDiff(live, eff(r)),
      compare: { releaseId: r.id },
    };
  }

  /**
   * Roll back to a release that has been live: everything it named comes
   * back together (prompt versions, recipes, models, settings). Only to a
   * release that was live before; never to an untested draft.
   */
  async rollback(id: string, userId: number, reason?: string) {
    const target = await this.releases.getById(id);
    if (target.agentKey !== DEBRIEF_AGENT_KEY) {
      throw new NotFoundException('Release not found');
    }
    if (!target.promotedAt) {
      throw new ConflictException(
        'only a release that has been live can be rolled back to',
      );
    }
    if (target.status === 'ga') {
      throw new ConflictException('this release is already live');
    }
    const r = await this.releases.makeGa(
      id,
      userId,
      AgentReleaseAuditAction.ROLLED_BACK,
      reason,
    );
    await this.notifier?.owner({
      title: `Debriefs rolled back to v${r.version}`,
      body: reason
        ? `A person rolled the Debrief agent back to v${r.version}: ${reason}`
        : `A person rolled the Debrief agent back to v${r.version}.`,
      data: { screen: 'DebriefReleases', releaseId: r.id },
      excludeUserId: userId,
    });
    return { id: r.id, version: r.version };
  }
}
