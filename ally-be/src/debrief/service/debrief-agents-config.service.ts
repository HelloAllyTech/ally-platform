import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentRelease } from '../../llm-agent/entity/agent-release.entity';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_REGISTRY_AGENTS,
  DebriefBundle,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';
import {
  AGENTS_CONFIG_LIMITS,
  AgentsConfigChange,
  applyAgentsConfigChanges,
  changeSource,
  diffSummary,
  guidanceToolsView,
  ReleaseAuthor,
  releaseAuthor,
  STEP_PROMPT_CODES,
  recipeUsedWhen,
} from '../util/debrief-agents-config.util';
import { alwaysAsk } from '../util/debrief-always-ask.util';
import {
  OPTIONAL_STEPS,
  bundleDiff,
  withPinnedPrompts,
} from '../util/debrief-releases.util';
import { DebriefConsoleService } from './debrief-console.service';
import { DebriefPmAgentService } from './debrief-pm-agent.service';
import { DebriefReleasesService } from './debrief-releases.service';
import { DebriefRunnerService } from './debrief-runner.service';
import { DebriefSettingsService } from './debrief-settings.service';

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/**
 * Settings › Agents. Reads the CURRENT live release at request time (never a
 * cached one) and turns a person's changes into a DRAFT release through the
 * same path as every person's proposed change (`proposeBundle`), so the PM
 * agent's and a person's changes are checked the same way, climb the same
 * ladder and show in the same history.
 */
@Injectable()
export class DebriefAgentsConfigService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly runner: DebriefRunnerService,
    private readonly console: DebriefConsoleService,
    private readonly releases: DebriefReleasesService,
    private readonly pm: DebriefPmAgentService,
    private readonly ownerSettings: DebriefSettingsService,
  ) {}

  /** The approved models the picker offers (active, approved provider, pinned, priced). */
  async models() {
    const m = await this.console.models();
    return m.choices.steps.map((c) => ({
      id: c.model,
      provider: c.provider as string,
      label: c.label,
    }));
  }

  private async author(
    r: Record<string, any>,
    idea: any,
  ): Promise<ReleaseAuthor> {
    return releaseAuthor(r, idea);
  }

  /** Ideas keyed by the release they carry (a person's proposal or the PM agent's). */
  private async ideas(releaseIds: string[]): Promise<Map<string, any>> {
    const out = new Map<string, any>();
    if (!releaseIds.length) return out;
    const rows: any[] = await this.dataSource.query(
      `SELECT id, change, "releaseId" FROM agent_lessons
        WHERE "agentKey" = $1
          AND ("releaseId" = ANY($2::uuid[]) OR change->>'releaseId' = ANY($2::text[])
               OR evidence->'canary'->>'releaseId' = ANY($2::text[]))`,
      [DEBRIEF_AGENT_KEY, releaseIds],
    );
    for (const i of rows) {
      for (const id of [i.releaseId, i.change?.releaseId]) {
        if (id && !out.has(id)) out.set(id, i);
      }
    }
    return out;
  }

  /** A draft as the page shows it: id, version, status, note and who made it. */
  async draftView(id: string) {
    const [r] = await this.dataSource.query(
      `SELECT r.id, r.version, r.status, r.notes, r."authorKind", u.name AS "createdByName"
         FROM agent_releases r LEFT JOIN users u ON u.id = r."createdBy"
        WHERE r.id = $1`,
      [id],
    );
    return r ? await this.draftRow(r) : null;
  }

  private async draftRow(r: Record<string, any>) {
    const idea = (await this.ideas([r.id])).get(r.id) ?? null;
    return {
      id: r.id as string,
      version: Number(r.version),
      status: r.status as string,
      note: (r.notes as string | null) ?? null,
      author: await this.author(r, idea),
    };
  }

  async view(userId: number | null, canEdit: boolean) {
    const repo = this.dataSource.getRepository(AgentRelease);
    // Fresh reads: never the runner's cached GA or canary.
    const [ga, canary] = await Promise.all([
      repo.findOne({
        where: { agentKey: DEBRIEF_AGENT_KEY, status: 'ga' as any },
      }),
      repo.findOne({
        where: { agentKey: DEBRIEF_AGENT_KEY, status: 'canary' as any },
      }),
    ]);
    const { bundle } = await this.runner.resolveRelease(ga);
    const [draft] = await this.dataSource.query(
      `SELECT r.id, r.version, r.status, r.notes, r."authorKind", u.name AS "createdByName"
         FROM agent_releases r LEFT JOIN users u ON u.id = r."createdBy"
        WHERE r."agentKey" = $1 AND r.status = 'draft'
        ORDER BY r.version DESC LIMIT 1`,
      [DEBRIEF_AGENT_KEY],
    );
    const s = bundle.settings;
    const inBundle = new Map(
      (bundle.orchestrator?.agents ?? []).map((a) => [a.id as string, a]),
    );
    return {
      release: {
        id: ga?.id ?? null,
        version: ga?.version ?? null,
        status: ga ? 'ga' : 'seed',
      },
      canEdit,
      canary: canary
        ? {
            id: canary.id,
            version: canary.version,
            share: Number((canary as any).rolloutPercent ?? 0),
          }
        : null,
      recipes: Object.values(bundle.recipes)
        .filter(Boolean)
        .map((rc) => ({
          key: rc!.key,
          shortForm: rc!.shortForm,
          maxRevisionRounds: rc!.maxRevisionRounds,
          usedWhen: recipeUsedWhen(rc!.key, s.standardMinLearnerTurns ?? 6),
          steps: rc!.steps.map((st) => ({
            step: st.step,
            label: st.label,
            model: st.model ?? null,
            backupModel: st.backupModel ?? null,
            promptCode: STEP_PROMPT_CODES[st.step] ?? null,
            optional: (OPTIONAL_STEPS as readonly string[]).includes(st.step),
          })),
        })),
      settings: {
        guidanceAgentMaxCalls: s.guidanceAgentMaxCalls ?? 3,
        guidanceTools: guidanceToolsView(s.guidanceTools),
      },
      limits: AGENTS_CONFIG_LIMITS,
      orchestratorAgents: Object.entries(DEBRIEF_REGISTRY_AGENTS).map(
        ([id, { version }]) => ({
          id,
          version: inBundle.get(id)?.version ?? version,
          enabled: !!bundle.orchestrator?.enabled && inBundle.has(id),
        }),
      ),
      models: await this.models(),
      pendingDraft: draft ? await this.draftRow(draft) : null,
      recentChanges: await this.recentChanges(),
    };
  }

  /** The last 10 releases of the Debrief agent, newest first, each against its parent. */
  async recentChanges() {
    const rows: any[] = await this.dataSource.query(
      `SELECT r.id, r.version, r.status, r."authorKind", r."createdAt", r.notes,
              u.name AS "createdByName", r.bundle, r."changeSet",
              p.bundle AS "parentBundle", p."changeSet" AS "parentChangeSet"
         FROM agent_releases r
         LEFT JOIN users u ON u.id = r."createdBy"
         LEFT JOIN agent_releases p ON p.id = r."parentReleaseId"
        WHERE r."agentKey" = $1
        ORDER BY r.version DESC LIMIT 10`,
      [DEBRIEF_AGENT_KEY],
    );
    const ideas = await this.ideas(rows.map((r) => r.id));
    return rows.map((r) => {
      const author = releaseAuthor(r, ideas.get(r.id) ?? null);
      const eff = (b: any, cs: any) =>
        withPinnedPrompts(b as DebriefBundle, cs?.pinnedPrompts);
      const diff = bundleDiff(
        r.parentBundle ? eff(r.parentBundle, r.parentChangeSet) : null,
        eff(r.bundle, r.changeSet),
      );
      return {
        releaseId: r.id as string,
        version: Number(r.version),
        status: r.status as string,
        author,
        at: iso(r.createdAt),
        summary: diffSummary(diff),
        source: changeSource(author),
      };
    });
  }

  /** Check, then make the draft; nothing is created when any change is refused. */
  async propose(changes: AgentsConfigChange[], note: string, userId: number) {
    const { bundle } = await this.runner.resolveRelease(
      await this.dataSource.getRepository(AgentRelease).findOne({
        where: { agentKey: DEBRIEF_AGENT_KEY, status: 'ga' as any },
      }),
    );
    const approved = new Set((await this.models()).map((m) => m.id));
    const out = applyAgentsConfigChanges(bundle, changes, approved);
    if ('refusals' in out) {
      throw new BadRequestException({
        message: out.refusals.map((r) => r.reason).join('; '),
        refusals: out.refusals,
      });
    }
    const text = (note ?? '').trim().slice(0, 500);
    const next = out.bundle;
    // The same validation every release gets (models in the catalog, shapes).
    const problems = validateDebriefBundle(
      next,
      await this.runner.modelCatalog(),
    );
    if (problems.length) {
      throw new BadRequestException({
        message: problems.join('; '),
        refusals: [{ index: 0, reason: problems.join('; ') }],
      });
    }
    const title =
      text || `Agents: ${diffSummary(bundleDiff(bundle, next)).join(', ')}`;
    const made = await this.releases.proposeBundle(
      next,
      title,
      text || null,
      userId,
    );
    const [s, live] = await Promise.all([
      this.ownerSettings.get(),
      this.pm.liveModels(),
    ]);
    const ask = alwaysAsk(
      { change: { ideaKind: 'release' }, evidence: { diff: made.diff } },
      s,
      live,
    );
    return {
      draft: (await this.draftView(made.releaseId)) ?? {
        id: made.releaseId,
        version: made.version,
        status: 'draft',
        note: text || null,
        author: { kind: 'person' as const, name: null as string | null },
      },
      waitsForPerson: !!ask,
      reason: ask?.waitsBecause ?? null,
    };
  }
}
