import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { excludeTestTenants } from '../../analytics/util/test-tenant.util';
import { DebriefAgreementMeasure } from '../enum/debrief-review.enum';
import {
  AGREEMENT_KAPPA,
  AGREEMENT_MEASURES,
  AGREEMENT_MIN_REVIEWS,
  AGREEMENT_SAMPLE_BACKLOG,
  AGREEMENT_SAMPLE_SIZE,
  AGREEMENT_SAMPLE_WINDOW_DAYS,
  AgreementGate,
  AgreementPair,
  agreementGate,
  judgeFinding,
  measureAgreement,
  MeasureAgreement,
  pickAgreementSample,
  StoredJudge,
} from '../util/debrief-agreement.util';

/** A judged Debrief agent run, as the sample and κ read it. */
const JUDGED = `
  r.mode IN ('live','shadow') AND r.cards IS NOT NULL
  AND r.status IN ('published','below_bar')
  AND r.workspace->'judge'->>'overall' IS NOT NULL`;

export interface AgreementView {
  measures: MeasureAgreement[];
  gate: AgreementGate;
  minReviews: number;
  kappa: number;
  sample: {
    size: number;
    /** Sampled in the last 7 days. */
    thisWeek: number;
    /** Sampled and still without a verdict. */
    waiting: number;
  };
}

/**
 * Judge agreement from the clinical advisor's reviews (debrief-agreement.util.ts):
 * per measure, Cohen's κ between the advisor's yes/no under their latest
 * verdict on a debrief and the independent judge's finding on it. This is
 * the canary's κ gate (DebriefAutonomyService.facts). Also runs the weekly
 * "Agreement sample" job: no model spend.
 */
@Injectable()
export class DebriefAgreementService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefAgreementService.name,
  );

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    // When this runs is set in Debrief › Settings › Schedules (debrief_schedules).
    scheduledTaskRegistry.registerConfigurable(
      'debrief-agreement-sample',
      async () => {
        const added = await this.sampleNow();
        return `${added} debrief${added === 1 ? '' : 's'} added`;
      },
    );
  }

  /**
   * One pair per debrief and measure: the advisor's answer under the latest
   * verdict that carries answers (any reviewer), and the judge's finding on
   * the same run. Ordinary reviews and sampled ones both count.
   */
  async pairs(): Promise<Record<DebriefAgreementMeasure, AgreementPair[]>> {
    const rows: Array<{
      runId: string;
      measure: DebriefAgreementMeasure;
      answer: boolean;
      judge: StoredJudge | null;
    }> = await this.dataSource.query(
      `WITH latest AS (
         SELECT DISTINCT ON (v."runId") v.id, v."runId"
           FROM debrief_reviews v
          WHERE EXISTS (SELECT 1 FROM debrief_review_answers a WHERE a."reviewId" = v.id)
          ORDER BY v."runId", v."updatedAt" DESC
       )
       SELECT l."runId" AS "runId", a.measure, a.answer, r.workspace->'judge' AS judge
         FROM latest l
         JOIN debrief_review_answers a ON a."reviewId" = l.id
         JOIN debrief_runs r ON r.id = l."runId"
        WHERE r.workspace ? 'judge'`,
    );
    const out = Object.fromEntries(
      AGREEMENT_MEASURES.map((m) => [m, [] as AgreementPair[]]),
    ) as Record<DebriefAgreementMeasure, AgreementPair[]>;
    for (const r of rows) {
      if (!out[r.measure]) continue;
      const judge = judgeFinding(r.judge, r.measure);
      if (judge === null) continue;
      out[r.measure].push({ runId: r.runId, advisor: !!r.answer, judge });
    }
    return out;
  }

  async measures(): Promise<MeasureAgreement[]> {
    const pairs = await this.pairs();
    return AGREEMENT_MEASURES.map((m) => measureAgreement(m, pairs[m]));
  }

  /** The canary's gate: κ ≥ 0.6 on every measure, each from 50+ reviews. */
  async gate(): Promise<AgreementGate> {
    return agreementGate(await this.measures());
  }

  /** Settings › Autonomy's "Judge agreement with the clinical advisor" panel. */
  async view(): Promise<AgreementView> {
    const measures = await this.measures();
    const [s] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE s."sampledAt" >= now() - interval '7 days')::int AS week,
              count(*) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM debrief_reviews v WHERE v."runId" = s."runId"))::int AS waiting
         FROM debrief_agreement_samples s`,
    );
    return {
      measures,
      gate: agreementGate(measures),
      minReviews: AGREEMENT_MIN_REVIEWS,
      kappa: AGREEMENT_KAPPA,
      sample: {
        size: AGREEMENT_SAMPLE_SIZE,
        thisWeek: Number(s?.week ?? 0),
        waiting: Number(s?.waiting ?? 0),
      },
    };
  }

  /** Run ids in the sample still waiting for a verdict (the advisor's queue category). */
  async waitingRunIds(): Promise<string[]> {
    const rows: Array<{ runId: string }> = await this.dataSource.query(
      `SELECT s."runId" FROM debrief_agreement_samples s
        WHERE NOT EXISTS (SELECT 1 FROM debrief_reviews v WHERE v."runId" = s."runId")`,
    );
    return rows.map((r) => r.runId);
  }

  async inSample(runId: string): Promise<boolean> {
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM debrief_agreement_samples WHERE "runId" = $1`,
      [runId],
    );
    return !!row;
  }

  /**
   * The weekly job: a random sample of judged debriefs from the last 4 weeks
   * that nobody has reviewed or sampled, put in the advisor's queue. Adds up
   * to AGREEMENT_SAMPLE_SIZE, never past AGREEMENT_SAMPLE_BACKLOG waiting.
   * Test organisations are left out. Returns how many it added.
   */
  async sampleNow(random: () => number = Math.random): Promise<number> {
    const [w] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM debrief_agreement_samples s
        WHERE NOT EXISTS (SELECT 1 FROM debrief_reviews v WHERE v."runId" = s."runId")`,
    );
    const candidates: Array<{ id: string; tenant_id: string | null }> =
      await this.dataSource.query(
        `SELECT r.id, r.tenant_id FROM debrief_runs r
          WHERE ${JUDGED}
            AND r."createdAt" >= now() - make_interval(days => $1)
            AND NOT EXISTS (SELECT 1 FROM debrief_reviews v WHERE v."runId" = r.id)
            AND NOT EXISTS (SELECT 1 FROM debrief_agreement_samples s WHERE s."runId" = r.id)
            AND ${excludeTestTenants('r.tenant_id')}`,
        [AGREEMENT_SAMPLE_WINDOW_DAYS],
      );
    const picked = pickAgreementSample(candidates, {
      size: AGREEMENT_SAMPLE_SIZE,
      waiting: Number(w?.n ?? 0),
      backlog: AGREEMENT_SAMPLE_BACKLOG,
      random,
    });
    for (const p of picked) {
      await this.dataSource.query(
        `INSERT INTO debrief_agreement_samples ("runId", tenant_id)
         VALUES ($1, $2) ON CONFLICT ("runId") DO NOTHING`,
        [p.id, p.tenant_id ?? null],
      );
    }
    if (picked.length) {
      this.logger.info(
        `[debrief] agreement sample: ${picked.length} of ${candidates.length} judged debriefs added`,
      );
    }
    return picked.length;
  }
}
