import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLogService } from '../../audit/service/audit-log.service';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { DebriefOwnerSettings } from '../entity/debrief-owner-settings.entity';
import {
  AUTONOMY_STEPS,
  AutonomyFacts,
  AutonomyPolicy,
  AutonomyStep,
  CHANGE_KINDS,
  ChangeKind,
  CONFIGURABLE_KINDS,
  changeKindOf,
  effectivePolicy,
  JUDGE_DRIFT_SOURCE,
  kindEligibility,
  matrixChangeRefusal,
  normaliseAutonomy,
  ORG_POLICY_STEPS,
  OrgPolicy,
  OrgPolicyStep,
  RELOCK_WINDOW_DAYS,
  relockReason,
  StepPolicy,
} from '../util/debrief-console-view.util';
import { DebriefSettingsService } from './debrief-settings.service';

/**
 * What the PM agent may do alone (PRD §12; plan §11.7), per kind of change
 * and test step, with per-organisation overrides that only tighten. The
 * owner changes it; "auto" needs an eligible kind (κ gate and a clean track
 * record); a kind re-locks to "ask" on its own after 2 canary reverts in 4
 * weeks, a failed sealed baseline or judge drift, with the reason recorded.
 * `pmAgentEnabled` stays the master switch. Promoting to everyone, Builder
 * hand-offs and bug reports always wait for a person: they are not steps here.
 */
@Injectable()
export class DebriefAutonomyService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefAutonomyService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefOwnerSettings)
    private readonly rows: Repository<DebriefOwnerSettings>,
    private readonly settings: DebriefSettingsService,
    private readonly audit: AuditLogService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('daily', 'debrief-autonomy-relock', () =>
      this.refreshRelocks().then(() => undefined),
    );
  }

  private async row(): Promise<DebriefOwnerSettings> {
    const found = await this.rows.findOne({ where: { id: 1 } });
    if (found) return found;
    return this.rows.save(this.rows.create({ id: 1, values: {} }));
  }

  async policy(): Promise<AutonomyPolicy> {
    const row = await this.row();
    const s = await this.settings.get();
    return normaliseAutonomy(
      row.autonomy as Partial<AutonomyPolicy> | null,
      s.pmAgentStartsQuickTests,
    );
  }

  private async save(policy: AutonomyPolicy): Promise<void> {
    await this.rows.update(1, {
      autonomy: policy as unknown as Record<string, any>,
    });
  }

  /** The policy for this kind, step and organisation, as the PM agent's services apply it. */
  async effective(
    kind: ChangeKind | null,
    step: AutonomyStep,
    orgId?: string | null,
  ): Promise<StepPolicy> {
    if (!kind) return 'ask';
    const [policy, s] = await Promise.all([this.policy(), this.settings.get()]);
    return effectivePolicy(policy, s.pmAgentEnabled, kind, step, orgId);
  }

  /** The policy for an idea (by its change), or 'ask' for anything without a kind. */
  async forIdea(
    idea: { change?: Record<string, any> | null },
    step: AutonomyStep,
    orgId?: string | null,
  ): Promise<StepPolicy> {
    return this.effective(changeKindOf(idea.change), step, orgId);
  }

  /**
   * May a running trial or canary reach this organisation's learners? Not
   * when the organisation's override makes the step stricter than the global
   * one (it tightened it), or turns it off. A step a person started under a
   * global "ask" counts as their go-ahead everywhere the organisation agrees.
   */
  async orgAllows(
    idea: { change?: Record<string, any> | null },
    step: 'paired_trial' | 'canary',
    orgId: string | null | undefined,
  ): Promise<boolean> {
    if (!orgId) return true;
    const global = await this.forIdea(idea, step, null);
    const org = await this.forIdea(idea, step, orgId);
    return org !== 'off' && org === global;
  }

  // --- The facts eligibility and re-locks read ---------------------------------

  async facts(): Promise<AutonomyFacts> {
    const [gate, reverts, baseline] = await Promise.all([
      this.gate(),
      this.reverts(),
      this.failedBaseline(),
    ]);
    // No judge-drift signal exists yet; reported as not measured.
    return { gate, reverts, failedBaseline: baseline, judgeDrift: null };
  }

  /** The calibration gate (κ ≥ 0.6), from the agreement Analytics › Debriefs shows. */
  private async gate(): Promise<AutonomyFacts['gate']> {
    try {
      const { DebriefCalibrationService } =
        await import('../../analytics/service/debrief-calibration.service');
      const calibration = this.moduleRef.get(DebriefCalibrationService, {
        strict: false,
      });
      const a = await calibration.getAgreement();
      return {
        met: a.gate.met,
        failing: a.gate.checks
          .filter((c) => !c.passes)
          .map((c) => ({ measure: c.measure, kappa: c.kappa })),
      };
    } catch (e) {
      this.logger.warn(
        `[debrief] autonomy: could not read the κ gate: ${(e as Error).message}`,
      );
      return { met: false, failing: [] };
    }
  }

  /** Canary reverts in the last 4 weeks, by kind of change. */
  private async reverts(): Promise<Partial<Record<ChangeKind, number>>> {
    const rows: Array<{ change: Record<string, any> }> =
      await this.dataSource.query(
        `SELECT change FROM agent_lessons
          WHERE "agentKey" = 'debrief' AND evidence->'canary'->>'status' = 'reverted'
            AND COALESCE((evidence->'canary'->>'checkedAt')::timestamptz, "updatedAt")
                >= now() - make_interval(days => $1)`,
        [RELOCK_WINDOW_DAYS],
      );
    const out: Partial<Record<ChangeKind, number>> = {};
    for (const r of rows) {
      const k = changeKindOf(r.change);
      if (k) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  /** The latest monthly sealed run against the one before: a lower median or more hard fails. */
  private async failedBaseline(): Promise<AutonomyFacts['failedBaseline']> {
    const rows: Array<{ detail: Record<string, any> }> =
      await this.dataSource.query(
        `SELECT detail FROM agent_lesson_audit
          WHERE "agentKey" = 'debrief' AND action = 'pipeline_step'
            AND detail->>'step' = 'sealed_run' AND detail ? 'median'
          ORDER BY "createdAt" DESC LIMIT 2`,
      );
    if (rows.length < 2) return { failed: false, detail: null };
    const [now, before] = rows.map((r) => r.detail);
    const m1 = Number(now.median);
    const m0 = Number(before.median);
    if (Number.isFinite(m1) && Number.isFinite(m0) && m1 < m0 - 0.5) {
      return {
        failed: true,
        detail: `median ${m1.toFixed(1)}, was ${m0.toFixed(1)}`,
      };
    }
    if (Number(now.hardFails ?? 0) > Number(before.hardFails ?? 0)) {
      return {
        failed: true,
        detail: `${now.hardFails} hard fails, was ${before.hardFails}`,
      };
    }
    return { failed: false, detail: null };
  }

  /**
   * Re-lock on its own: a kind whose track record broke drops every "auto"
   * cell to "ask", and the reason is recorded. Going back takes the owner.
   */
  async refreshRelocks(facts?: AutonomyFacts): Promise<AutonomyPolicy> {
    const f = facts ?? (await this.facts());
    const policy = await this.policy();
    let changed = false;
    for (const kind of CONFIGURABLE_KINDS) {
      const reason = relockReason(kind, f);
      if (!reason) continue;
      const auto = AUTONOMY_STEPS.filter(
        (s) => policy.matrix[kind][s] === 'auto',
      );
      if (!auto.length) continue;
      for (const s of auto) policy.matrix[kind][s] = 'ask';
      policy.relocks.push({ kind, at: new Date().toISOString(), reason });
      changed = true;
      this.logger.warn(`[debrief] autonomy: ${kind} re-locked: ${reason}`);
    }
    if (changed) await this.save(policy);
    return policy;
  }

  // --- The owner's changes ----------------------------------------------------------

  /** Change matrix cells; all-or-nothing, "auto" only for an eligible kind. Audited. */
  async setMatrix(
    changes: Array<{ kind: string; step: string; value: string }>,
    userId: number,
  ): Promise<AutonomyPolicy> {
    if (!changes?.length)
      throw new BadRequestException('change at least one cell');
    const f = await this.facts();
    const problems = changes
      .map((c) => matrixChangeRefusal(c.kind, c.step, c.value, f))
      .filter((p): p is string => !!p);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    const policy = await this.policy();
    const before = JSON.parse(JSON.stringify(policy.matrix));
    for (const c of changes) {
      policy.matrix[c.kind as ChangeKind][c.step as AutonomyStep] =
        c.value as StepPolicy;
    }
    await this.save(policy);
    await this.audit.log({
      eventType: 'DEBRIEF_SETTINGS_CHANGED',
      userId,
      details: { source: 'autonomy_matrix', changes, before },
    });
    return policy;
  }

  /** An organisation's overrides: default (use the global), ask or never. They only tighten. */
  async setOrg(
    tenantId: string,
    changes: Partial<Record<string, string>>,
    userId: number,
  ): Promise<AutonomyPolicy> {
    const entries = Object.entries(changes ?? {});
    if (!entries.length) throw new BadRequestException('change at least one');
    const bad = entries.filter(
      ([k, v]) =>
        !(ORG_POLICY_STEPS as readonly string[]).includes(k) ||
        !['default', 'ask', 'never'].includes(String(v)),
    );
    if (bad.length) {
      throw new BadRequestException(
        `${bad.map(([k]) => k).join(', ')}: use paired_trial or canary with default, ask or never`,
      );
    }
    const policy = await this.policy();
    const o = { ...(policy.orgs[tenantId] ?? {}) };
    for (const [k, v] of entries) {
      if (v === 'default') delete o[k as OrgPolicyStep];
      else o[k as OrgPolicyStep] = v as OrgPolicy;
    }
    if (Object.keys(o).length) policy.orgs[tenantId] = o;
    else delete policy.orgs[tenantId];
    await this.save(policy);
    await this.audit.log({
      eventType: 'DEBRIEF_SETTINGS_CHANGED',
      userId,
      details: { source: 'autonomy_org', tenantId, changes },
    });
    return policy;
  }

  /**
   * The old `pmAgentStartsQuickTests` switch, changed through the settings
   * page: mirrored into the quick-test column. Turning it on is held to the
   * same rule as the matrix: only eligible kinds go to "auto".
   */
  async mirrorLegacyQuickTestSwitch(on: boolean): Promise<void> {
    const f = on ? await this.facts() : null;
    const policy = await this.policy();
    for (const kind of CONFIGURABLE_KINDS) {
      if (!on) {
        if (policy.matrix[kind].quick_test === 'auto') {
          policy.matrix[kind].quick_test = 'ask';
        }
      } else if (
        policy.matrix[kind].quick_test === 'ask' &&
        kindEligibility(kind, f!).eligible
      ) {
        policy.matrix[kind].quick_test = 'auto';
      }
    }
    await this.save(policy);
  }

  /** Settings › "What the PM agent may do alone": the matrix, eligibility, overrides, re-locks. */
  async view(): Promise<{
    enabled: boolean;
    steps: readonly AutonomyStep[];
    promote: 'person';
    kinds: Array<{
      kind: ChangeKind;
      configurable: boolean;
      cells: Record<AutonomyStep, StepPolicy>;
      eligible: boolean;
      reason: string;
      relockedAt: string | null;
      relockReason: string | null;
    }>;
    orgs: Array<{
      tenantId: string;
      tenantName: string;
      live: boolean;
      overrides: Record<OrgPolicyStep, OrgPolicy>;
    }>;
    facts: AutonomyFacts;
    judgeDrift: typeof JUDGE_DRIFT_SOURCE;
    relocks: AutonomyPolicy['relocks'];
  }> {
    const f = await this.facts();
    const policy = await this.refreshRelocks(f);
    const s = await this.settings.get();
    const tenants: Array<{ id: string; name: string }> =
      await this.dataSource.query(
        `SELECT t.id::text AS id, t.name FROM tenants t WHERE t."deletedAt" IS NULL ORDER BY t.name`,
      );
    const live = new Set(
      (
        (await this.dataSource.query(
          `SELECT "scopeId" FROM agent_config_overrides
            WHERE "agentKey" = 'debrief' AND layer = 'org' AND ("values"->>'live')::boolean`,
        )) as Array<{ scopeId: string }>
      ).map((r) => r.scopeId),
    );
    return {
      enabled: s.pmAgentEnabled,
      steps: AUTONOMY_STEPS,
      promote: 'person',
      kinds: CHANGE_KINDS.map((kind) => {
        const e = kindEligibility(kind, f);
        const last = [...policy.relocks].reverse().find((r) => r.kind === kind);
        return {
          kind,
          configurable: kind !== 'pinned_rules',
          cells: policy.matrix[kind],
          eligible: e.eligible,
          reason: e.reason,
          relockedAt: last?.at ?? null,
          relockReason: last?.reason ?? null,
        };
      }),
      orgs: tenants.map((t) => {
        const o = policy.orgs[t.id] ?? {};
        return {
          tenantId: t.id,
          tenantName: t.name,
          live: live.has(t.id),
          overrides: {
            paired_trial: o.paired_trial ?? 'default',
            canary: o.canary ?? 'default',
          },
        };
      }),
      facts: f,
      judgeDrift: JUDGE_DRIFT_SOURCE,
      relocks: policy.relocks,
    };
  }
}
