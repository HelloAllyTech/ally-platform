import { Injectable, NotFoundException } from '@nestjs/common';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import { PlanEventKind } from 'src/product-planning/enum/product-planning.enum';
import { PlanAccessService } from 'src/product-planning/service/plan-access.service';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { PlanCheckService } from './plan-check.service';
import { PlanOutcomeService } from './plan-outcome.service';
import { PlanSessionStore } from './plan-session.store';

/** Bumped whenever the JSON sidecar's shape changes. */
export const PLAN_EXPORT_VERSION = 1;

export interface PlanPackage {
  filename: string;
  markdown: string;
  json: Record<string, unknown>;
}

/**
 * Download plan (rev 5.2 §B.14, P6): a stage-stamped package of everything
 * the plan settled — PRD, success measure, checks and their resolutions,
 * design, launch and outcomes — as Markdown for people and a versioned JSON
 * sidecar for tools. Labelled internal. Available from PRD in progress onward.
 */
@Injectable()
export class PlanExportService {
  constructor(
    private readonly store: PlanSessionStore,
    private readonly builderSessions: BuilderSessionService,
    private readonly checks: PlanCheckService,
    private readonly outcomes: PlanOutcomeService,
    private readonly access: PlanAccessService,
    private readonly events: PlanEventService,
    private readonly settings: PlanSettingsService,
  ) {}

  async package(sessionId: string, userId: number): Promise<PlanPackage> {
    await this.settings.assertEnabled();
    const plan = await this.store.find(sessionId);
    if (
      !plan ||
      !(await this.access.canRead(plan, userId)) ||
      !plan.plan.opportunityId
    ) {
      throw new NotFoundException('Plan not found');
    }
    const detail = await this.builderSessions.getSessionDetail(
      sessionId,
      plan.createdBy,
    );
    const [checks, outcomes] = await Promise.all([
      this.checks.list(sessionId),
      this.outcomes.list(sessionId),
    ]);
    const prd = (detail.prd ?? {}) as Record<string, unknown>;
    const design = (prd.technicalDesign ?? null) as {
      status?: string;
      designMd?: string;
    } | null;
    const measure = plan.plan.successMeasure ?? null;
    const stamp = new Date().toISOString();

    const lines: string[] = [
      `# ${plan.title}`,
      '',
      `> INTERNAL — exported ${stamp} at stage **${plan.planStage ?? 'unknown'}**. Plan ${plan.id}.`,
      '',
      '## Success measure',
      measure
        ? [
            `- Metric: ${measure.metric}`,
            `- Baseline: ${measure.baseline ?? 'none yet'}`,
            `- Target: ${measure.target}`,
            `- Guardrails: ${measure.guardrails.join('; ') || 'none'}`,
            `- Measured by (${measure.method.kind}): ${measure.method.spec}`,
            `- Reviews: ${measure.reviewAfterDays.map((d) => `+${d} days`).join(', ')}${plan.plan.measureFrozenAt ? ' (frozen)' : ''}`,
          ].join('\n')
        : '_Not set yet._',
      '',
      '## Impact tags',
      (plan.plan.impactTags ?? [])
        .map((t) => `- ${t.id} (${t.source}${t.reason ? `: ${t.reason}` : ''})`)
        .join('\n') || '_None._',
      '',
      '## Checks',
      checks.length
        ? checks
            .map((c) =>
              [
                `### ${c.kind} — ${c.status}${c.mode === 'shadow' ? ' (advisory)' : ''}`,
                ...c.findings.map(
                  (f) =>
                    `- **${f.severity}** ${f.title}: ${f.detail}` +
                    (f.resolution
                      ? `\n  - ${f.resolution.kind} by user ${f.resolution.by}: ${f.resolution.reason}`
                      : '\n  - _open_'),
                ),
              ].join('\n'),
            )
            .join('\n\n')
        : '_None required or run._',
      '',
      '## PRD',
      '```json',
      JSON.stringify({ ...prd, technicalDesign: undefined }, null, 2),
      '```',
      '',
      '## Technical design',
      design?.designMd
        ? `Status: ${design.status ?? 'unknown'}\n\n${design.designMd}`
        : '_Not drafted yet._',
      '',
      '## Launch',
      plan.plan.launch?.items?.length
        ? plan.plan.launch.items
            .map((i) => `- [${i.done ? 'x' : ' '}] ${i.kind}: ${i.title}`)
            .join('\n')
        : '_Not started._',
      '',
      '## Outcomes',
      outcomes.length
        ? outcomes
            .map((o) => `- ${o.dueDate}: **${o.verdict}** — ${o.reasons}`)
            .join('\n')
        : '_None yet._',
      '',
    ];

    const json = {
      version: PLAN_EXPORT_VERSION,
      internal: true,
      exportedAt: stamp,
      stage: plan.planStage ?? null,
      plan: {
        id: plan.id,
        title: plan.title,
        opportunityId: plan.plan.opportunityId,
        authorUserId: plan.createdBy,
        leadUserId: plan.leadUserId ?? null,
      },
      successMeasure: measure,
      measureFrozenAt: plan.plan.measureFrozenAt ?? null,
      impactTags: plan.plan.impactTags ?? [],
      checks: checks.map((c) => ({
        kind: c.kind,
        status: c.status,
        mode: c.mode,
        findings: c.findings,
      })),
      prd: { ...prd, technicalDesign: undefined },
      technicalDesign: design,
      launch: plan.plan.launch ?? null,
      outcomes: outcomes.map((o) => ({
        dueDate: o.dueDate,
        verdict: o.verdict,
        reasons: o.reasons,
        nextSteps: o.nextSteps,
      })),
    };

    await this.events.record({
      sessionId,
      kind: PlanEventKind.EXPORTED,
      actorUserId: userId,
      detail: { stage: plan.planStage ?? null },
    });
    const slug =
      plan.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'plan';
    return { filename: `${slug}-plan`, markdown: lines.join('\n'), json };
  }
}
