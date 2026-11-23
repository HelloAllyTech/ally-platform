import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { BuilderPrdReadiness } from 'src/builder/type/builder-prd.type';
import { PlanCheck } from 'src/product-planning/entity/plan-check.entity';
import {
  requiredChecks,
  successMeasureGaps,
} from 'src/product-planning/util/plan-readiness.util';
import { PlanSession } from './plan-session.store';

export interface PlanReadiness {
  ready: boolean;
  /** Builder's own readiness, unchanged. */
  builderReady: boolean;
  /** Next actions, in the order the lead should take them. */
  blockers: string[];
}

/**
 * "PRD ready" for a plan (rev 5.2 decision 2): Builder's readiness, PLUS a
 * complete success measure, PLUS every check the impact tags require resolved.
 * Builder's own readiness is untouched; this is a stricter view on top of it.
 */
@Injectable()
export class PlanReadinessService {
  constructor(
    @InjectRepository(PlanCheck)
    private readonly checks: Repository<PlanCheck>,
  ) {}

  /**
   * `factsHash` is the current PRD's (checkFactsHash); a check that judged an
   * older PRD no longer counts. Shadow-mode checks never block.
   */
  async assess(
    plan: PlanSession,
    builder: Pick<BuilderPrdReadiness, 'ready' | 'sections'>,
    factsHash?: string,
  ): Promise<PlanReadiness> {
    const blockers: string[] = [];
    if (!builder.ready) {
      for (const section of builder.sections ?? []) {
        if (!section.ok && section.hint) blockers.push(section.hint);
      }
      if (!blockers.length) blockers.push('Finish the PRD.');
    }
    blockers.push(...successMeasureGaps(plan.plan?.successMeasure));

    const tags = (plan.plan?.impactTags ?? []).map((t) => t.id);
    const required = requiredChecks(tags);
    if (required.length) {
      const rows = await this.checks.find({ where: { sessionId: plan.id } });
      for (const kind of required) {
        const row = rows.find((r) => r.kind === kind);
        if (!row || row.status === 'failed') {
          blockers.push(`Run the ${CHECK_LABEL[kind]} check.`);
        } else if (factsHash && row.factsHash !== factsHash) {
          blockers.push(
            `Run the ${CHECK_LABEL[kind]} check again: the PRD changed since it ran.`,
          );
        } else if (row.mode === 'live' && row.status !== 'resolved') {
          blockers.push(`Resolve the ${CHECK_LABEL[kind]} check's findings.`);
        } else if (row.status === 'running') {
          blockers.push(`Wait for the ${CHECK_LABEL[kind]} check to finish.`);
        }
      }
    }
    return {
      ready: blockers.length === 0,
      builderReady: builder.ready,
      blockers,
    };
  }
}

const CHECK_LABEL: Record<string, string> = {
  safety: 'safety',
  privacy: 'privacy',
  ai_quality: 'AI quality',
};
