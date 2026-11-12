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
  stepEligibility,
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
import type { AgreementView } from './debrief-agreement.service';

/**
 * What the PM agent may do alone (PRD §12; plan §11.7). Quick checks, pass
 * tests and side-by-side trials always run on their own (learners never see
 * them); the owner sets only the learner try-out (canary) per kind of change.
 * Per-organisation overrides only tighten. "auto" on the try-out needs an
 * eligible kind (κ gate and a clean track record); it re-locks to "ask" on
 * its own after 2 try-out reverts in 4 weeks, a failed sealed baseline,
 * judge drift or agreement below 0.6, with the reason recorded.
 * `pmAgentEnabled` stays the master switch. Live for everyone, Builder
 * hand-offs and bug reports always wait for a person: they are not steps here.
 */
/** The kinds and steps in the owner's words (Settings › What the PM agent may do alone). */
const KIND_WORDS: Record<ChangeKind, string> = {
  settings: 'Settings (not budgets)',
  prompts: 'Prompts, agents and default plans',
  pinned_rules: 'Pinned rules',
};
const STEP_WORDS: Record<AutonomyStep, string> = {
  quick_test: 'Quick check',
  gate_test: 'Pass test',
  paired_trial: 'Side-by-side trial',
  canary: 'Try on learners',
};

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
    // When this runs is set in Debrief › Settings › Schedules (debrief_schedules).
    scheduledTaskRegistry.registerConfigurable('debrief-autonomy-relock', () =>
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
    return normaliseAutonomy(row.autonomy as Partial<AutonomyPolicy> | null);
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

  /**
   * The canary's κ gate: Cohen's κ between the clinical advisor's yes/no
   * answers under their verdicts and the judge's findings on the same
   * debriefs, κ ≥ 0.6 on every measure from 50+ reviews each
   * (DebriefAgreementService). Replaces the old hand-scored calibration set.
   */
  private async gate(): Promise<AutonomyFacts['gate']> {
    try {
      const g = await (await this.agreementService()).gate();
      return { met: g.met, failing: g.failing };
    } catch (e) {
      this.logger.warn(
        `[debrief] autonomy: could not read the κ gate: ${(e as Error).message}`,
      );
      return { met: false, failing: [] };
    }
  }

  private async agreementService() {
    const { DebriefAgreementService } =
      await import('./debrief-agreement.service');
    return this.moduleRef.get(DebriefAgreementService, { strict: false });
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
   * Re-lock on its own: a kind whose track record broke (2 try-out reverts in
   * 4 weeks, a failed baseline, judge drift) or whose agreement fell below
   * 0.6 drops its canary (learner try-out) from "auto" to "ask"; the steps
   * learners never see always stay on their own. Each re-lock records the
   * cell, the reason and that the system set it, and tells the owner. Going
   * back takes the owner.
   *
   * It also tells the owner, once, when a kind's canary becomes able to run on
   * its own (κ ≥ 0.6, clean record): an invitation, never switched on here.
   */
  async refreshRelocks(facts?: AutonomyFacts): Promise<AutonomyPolicy> {
    const f = facts ?? (await this.facts());
    const policy = await this.policy();
    let changed = false;
    const relocked: Array<{
      kind: ChangeKind;
      steps: AutonomyStep[];
      reason: string;
    }> = [];
    const nowEligible: ChangeKind[] = [];
    for (const kind of CONFIGURABLE_KINDS) {
      const record = relockReason(kind, f);
      // The κ re-lock leaves an owner's override be (they chose it knowingly);
      // reverts, a failed baseline and drift re-lock everything regardless.
      const relock =
        policy.matrix[kind].canary === 'auto' &&
        (!!record || (!f.gate.met && !policy.overrides?.[kind]));
      const steps: AutonomyStep[] = relock ? ['canary'] : [];
      const reason = record ?? 'agreement fell below 0.6';
      if (steps.length) {
        for (const s of steps) policy.matrix[kind][s] = 'ask';
        if (steps.includes('canary') && policy.overrides?.[kind]) {
          policy.overrides = { ...policy.overrides };
          delete policy.overrides[kind];
        }
        policy.relocks.push({
          kind,
          at: new Date().toISOString(),
          reason,
          steps,
          by: 'system',
        });
        relocked.push({ kind, steps, reason });
        changed = true;
        this.logger.warn(`[debrief] autonomy: ${kind} re-locked: ${reason}`);
      }
      const eligible = kindEligibility(kind, f, 'canary').eligible;
      const before = policy.canaryEligible?.[kind];
      if (before !== eligible) {
        policy.canaryEligible = {
          ...(policy.canaryEligible ?? {}),
          [kind]: eligible,
        };
        changed = true;
        // Told only on a change to eligible (not on the first check after deploy).
        if (
          eligible &&
          before === false &&
          policy.matrix[kind].canary !== 'auto'
        ) {
          nowEligible.push(kind);
        }
      }
    }
    if (changed) await this.save(policy);
    for (const r of relocked) {
      await this.notifyOwner({
        title: `${KIND_WORDS[r.kind]}: back to asks first`,
        body: `The system set ${r.steps.map((s) => `"${STEP_WORDS[s]}"`).join(', ')} back to "Asks first": ${r.reason}. Switching it back on is up to you in Debrief settings.`,
        data: { settings: 'autonomy', kind: r.kind },
      });
    }
    for (const kind of nowEligible) {
      await this.notifyOwner({
        title: `Learner try-outs can now run on their own for ${KIND_WORDS[kind].toLowerCase()}`,
        body: `The independent check now agrees with the clinical advisor, so "Try on learners" can run on its own for ${KIND_WORDS[kind].toLowerCase()}. Switch it on? It stays "Asks first" until you change it in Debrief settings.`,
        data: { settings: 'autonomy', kind },
      });
    }
    return policy;
  }

  private async notifyOwner(alert: {
    title: string;
    body: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    try {
      const { DebriefNotifier } = await import('./debrief-notifier.service');
      const notifier = this.moduleRef.get(DebriefNotifier, {
        strict: false,
      });
      await notifier.owner(alert);
    } catch (e) {
      this.logger.warn(
        `[debrief] autonomy: owner notification failed: ${(e as Error).message}`,
      );
    }
  }

  // --- The owner's changes ----------------------------------------------------------

  /** Change matrix cells; all-or-nothing, "auto" only for an eligible kind. Audited. */
  async setMatrix(
    changes: Array<{ kind: string; step: string; value: string }>,
    userId: number,
    override = false,
  ): Promise<AutonomyPolicy> {
    if (!changes?.length)
      throw new BadRequestException('change at least one cell');
    const f = await this.facts();
    const problems = changes
      .map((c) => matrixChangeRefusal(c.kind, c.step, c.value, f, override))
      .filter((p): p is string => !!p);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    const policy = await this.policy();
    const before = JSON.parse(JSON.stringify(policy.matrix));
    // A canary set "on its own" before the κ gate is met is the owner's override.
    const overridden = changes.filter(
      (c) =>
        c.step === 'canary' &&
        c.value === 'auto' &&
        !kindEligibility(c.kind as ChangeKind, f, 'canary').eligible,
    );
    const name = overridden.length ? await this.userName(userId) : null;
    const at = new Date().toISOString();
    policy.overrides = { ...(policy.overrides ?? {}) };
    for (const c of changes) {
      const kind = c.kind as ChangeKind;
      policy.matrix[kind][c.step as AutonomyStep] = c.value as StepPolicy;
      if (c.step === 'canary') {
        if (overridden.includes(c)) {
          policy.overrides[kind] = { at, by: userId, name };
        } else {
          delete policy.overrides[kind];
        }
      }
    }
    await this.save(policy);
    await this.audit.log({
      eventType: 'DEBRIEF_SETTINGS_CHANGED',
      userId,
      details: {
        source: 'autonomy_matrix',
        changes,
        before,
        ...(overridden.length
          ? {
              override: overridden.map((c) => c.kind),
              reason:
                'learner try-outs on their own before agreement reached 0.6',
            }
          : {}),
      },
    });
    return policy;
  }

  private async userName(userId: number): Promise<string | null> {
    try {
      const [u] = await this.dataSource.query(
        `SELECT COALESCE(NULLIF(TRIM(name), ''), email) AS name FROM users WHERE id = $1`,
        [userId],
      );
      return u?.name ?? null;
    } catch {
      return null;
    }
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
        !['default', 'ask', 'never'].includes(String(v)) ||
        // Side-by-side trials run on their own: "Allowed" or "Not on its sessions".
        (k === 'paired_trial' && v === 'ask'),
    );
    if (bad.length) {
      throw new BadRequestException(
        `${bad.map(([k]) => k).join(', ')}: use paired_trial (default or never) or canary (default, ask or never)`,
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

  /** Settings › "What the PM agent may do alone": the matrix, eligibility, overrides, re-locks. */
  async view(): Promise<{
    enabled: boolean;
    steps: readonly AutonomyStep[];
    promote: 'person';
    kinds: Array<{
      kind: ChangeKind;
      configurable: boolean;
      cells: Record<AutonomyStep, StepPolicy>;
      /** The canary (the step the κ gate applies to); kept for older clients. */
      eligible: boolean;
      reason: string;
      /** Per step: tests learners never see need only a clean record; the canary also κ ≥ 0.6. */
      eligibility: Record<AutonomyStep, { eligible: boolean; reason: string }>;
      relockedAt: string | null;
      relockReason: string | null;
      /** The owner set the canary on its own before the κ gate was met. */
      override: { at: string; by: number; name: string | null } | null;
      /** The latest re-lock by the system whose cells still ask first (shown in the row). */
      relock: {
        at: string;
        reason: string;
        steps: AutonomyStep[];
        by: 'system';
      } | null;
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
    /** "Judge agreement with the clinical advisor": κ, n and recall per measure; the sample. */
    agreement: AgreementView | null;
  }> {
    const f = await this.facts();
    const agreement = await this.agreementService()
      .then((a) => a.view())
      .catch(() => null);
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
        const e = kindEligibility(kind, f, 'canary');
        const last = [...policy.relocks].reverse().find((r) => r.kind === kind);
        return {
          kind,
          configurable: kind !== 'pinned_rules',
          cells: policy.matrix[kind],
          eligible: e.eligible,
          reason: e.reason,
          eligibility: stepEligibility(kind, f),
          override: policy.overrides?.[kind] ?? null,
          relockedAt: last?.at ?? null,
          relockReason: last?.reason ?? null,
          relock: (() => {
            if (!last) return null;
            const steps = (last.steps ?? AUTONOMY_STEPS.slice()).filter(
              (st) => policy.matrix[kind][st] === 'ask',
            );
            return steps.length
              ? {
                  at: last.at,
                  reason: last.reason,
                  steps,
                  by: 'system' as const,
                }
              : null;
          })(),
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
      agreement,
    };
  }
}
