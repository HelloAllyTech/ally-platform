import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { redactText } from 'src/guide/safety/redaction';
import { excludeTestTenants } from '../util/test-tenant.util';
import {
  DEBRIEF_QUALITY_DIMENSIONS,
  debriefOverallSql,
} from '../constants/debrief-quality.constants';
import { selectQuarterSample } from 'src/foundational-skills/util/human-rating.util';
import {
  DEBRIEF_CALIBRATION_SEED,
  DEBRIEF_CALIBRATION_TARGET,
  DEBRIEF_HARD_FAIL_CODES,
  DebriefHardFailAgreement,
  DebriefScoreAgreement,
  autonomyGate,
  hardFailAgreement,
  scoreAgreement,
  validateDebriefRating,
} from '../util/debrief-calibration.util';
import { RatedPair } from '../util/rater-agreement.util';
import { DebriefQualityRepository } from '../repository/debrief-quality.repository';

/** The judge series the calibration set is checked against. */
const JUDGE_PAIR = { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v1' };
const RUBRIC_VERSION = 'v1';

export interface DebriefRatingInput {
  scores: Record<string, number>;
  hardFails: string[];
  note?: string | null;
}

/**
 * The debrief calibration set: a stratified sample of scored debriefs that
 * people rate blind on the judge's rubric, and the agreement that gates the
 * debrief Improver's autonomy.
 *
 * Same shape as the foundational-skills human rating programme (its sampler is
 * reused): a seeded, stratified sample nobody can steer by choosing what to
 * open, ratings keyed by debrief so a rating counts wherever the sample moves,
 * and κ withheld below 20 rated debriefs.
 */
@Injectable()
export class DebriefCalibrationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly debriefs: DebriefQualityRepository,
  ) {}

  /** Scored debriefs eligible for the sample, with the judge's overall. */
  private async candidates(): Promise<
    Array<{ cutId: string; compositeScore: number; language: string }>
  > {
    const rows = await this.dataSource.query(
      `SELECT j."scenarioSessionId" AS id,
              COALESCE(j."language", 'unknown') AS language,
              ${debriefOverallSql('j')} AS overall
         FROM debrief_quality_judgment j
        WHERE j."judgeModel" = $1 AND j."judgePromptVersion" = $2
          AND ${excludeTestTenants('j."tenant_id"')}`,
      [JUDGE_PAIR.judgeModel, JUDGE_PAIR.judgePromptVersion],
    );
    return rows.map((r: { id: string; language: string; overall: string }) => ({
      cutId: r.id,
      compositeScore: Number(r.overall),
      language: r.language,
    }));
  }

  /** The sample, with how many people have rated each debrief and whether the caller has. */
  async getSample(raterId: number) {
    const sample = selectQuarterSample(
      await this.candidates(),
      DEBRIEF_CALIBRATION_SEED,
      DEBRIEF_CALIBRATION_TARGET,
    );
    const ids = sample.items.map((i) => i.candidate.cutId);
    const counts: Array<{ id: string; raters: number; mine: boolean }> =
      ids.length === 0
        ? []
        : await this.dataSource.query(
            `SELECT "scenarioSessionId" AS id,
                    count(*)::int AS raters,
                    bool_or("raterId" = $2) AS mine
               FROM debrief_human_ratings
              WHERE "scenarioSessionId" = ANY($1::uuid[]) AND "rubricVersion" = $3
              GROUP BY 1`,
            [ids, raterId, RUBRIC_VERSION],
          );
    const byId = new Map(counts.map((c) => [c.id, c]));
    return {
      population: sample.population,
      target: sample.target,
      items: sample.items.map((i) => ({
        scenarioSessionId: i.candidate.cutId,
        language: i.candidate.language,
        tercile: i.tercile,
        raters: Number(byId.get(i.candidate.cutId)?.raters ?? 0),
        ratedByMe: !!byId.get(i.candidate.cutId)?.mine,
      })),
    };
  }

  private async assertRateable(raterId: number, sessionId: string) {
    const [row] = await this.dataSource.query(
      `SELECT s."counselorId" AS counselor_id, j."debriefText" AS debrief_text,
              COALESCE(j."language", 'en') AS language, j."tenant_id" AS tenant_id
         FROM debrief_quality_judgment j
         JOIN scenario_sessions s ON s.id = j."scenarioSessionId"
        WHERE j."scenarioSessionId" = $1
          AND j."judgeModel" = $2 AND j."judgePromptVersion" = $3`,
      [sessionId, JUDGE_PAIR.judgeModel, JUDGE_PAIR.judgePromptVersion],
    );
    if (!row) {
      throw new NotFoundException(
        'This debrief has not been scored by the judge, so it cannot be calibrated.',
      );
    }
    if (Number(row.counselor_id) === raterId) {
      throw new ForbiddenException(
        'You cannot rate a debrief of your own practice.',
      );
    }
    return row as {
      debrief_text: string | null;
      language: string;
      tenant_id: string;
    };
  }

  /** One debrief to rate: redacted transcript and debrief, never the judge's scores. */
  async getItem(raterId: number, sessionId: string) {
    const row = await this.assertRateable(raterId, sessionId);
    // The judge's numbering, so the debrief's "(turn N)" points at the same turn.
    const { turns } = await this.debriefs.buildTranscript(sessionId);
    const transcript = turns.map((t) => ({
      turnIndex: t.turn_index,
      speaker: t.role === 'client' ? 'client' : 'learner',
      text: redactText(t.text),
    }));
    const [mine] = await this.dataSource.query(
      `SELECT * FROM debrief_human_ratings
        WHERE "scenarioSessionId" = $1 AND "raterId" = $2 AND "rubricVersion" = $3`,
      [sessionId, raterId, RUBRIC_VERSION],
    );
    return {
      scenarioSessionId: sessionId,
      language: row.language,
      transcript,
      debrief: redactText(row.debrief_text ?? ''),
      myRating: mine
        ? {
            scores: Object.fromEntries(
              DEBRIEF_QUALITY_DIMENSIONS.map((d) => [
                d.dimension,
                Number(mine[d.column]),
              ]),
            ),
            hardFails: mine.hardFails ?? [],
            note: mine.note ?? null,
          }
        : null,
    };
  }

  /** Submit or replace the caller's rating of one debrief. */
  async submit(raterId: number, sessionId: string, input: DebriefRatingInput) {
    const problems = validateDebriefRating(input);
    if (problems.length) throw new BadRequestException(problems);
    const row = await this.assertRateable(raterId, sessionId);
    const columns = DEBRIEF_QUALITY_DIMENSIONS.map((d) => `"${d.column}"`);
    const scores = DEBRIEF_QUALITY_DIMENSIONS.map(
      (d) => input.scores[d.dimension],
    );
    const values = [
      row.tenant_id,
      sessionId,
      raterId,
      RUBRIC_VERSION,
      ...scores,
      JSON.stringify([...new Set(input.hardFails)]),
      input.note?.trim() || null,
    ];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const [saved] = await this.dataSource.query(
      `INSERT INTO debrief_human_ratings
         ("tenant_id", "scenarioSessionId", "raterId", "rubricVersion",
          ${columns.join(', ')}, "hardFails", "note")
       VALUES (${placeholders})
       ON CONFLICT ("scenarioSessionId", "raterId", "rubricVersion")
       DO UPDATE SET ${columns.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
         "hardFails" = EXCLUDED."hardFails", "note" = EXCLUDED."note",
         "updatedAt" = now()
       RETURNING (xmax = 0) AS created`,
      values,
    );
    return { created: !!saved?.created };
  }

  /**
   * Judge vs human (one pair per rating) and human vs human (every pair of
   * raters of the same debrief), per dimension and per hard fail, plus the
   * standing gate on the Improver's autonomy.
   */
  async getAgreement() {
    const cols = DEBRIEF_QUALITY_DIMENSIONS.map(
      (d) =>
        `h."${d.column}" AS "h_${d.column}", j."${d.column}" AS "j_${d.column}"`,
    ).join(', ');
    const judged: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT h."scenarioSessionId" AS id, ${cols},
              h."hardFails" AS h_fails, j."hardFails" AS j_fails
         FROM debrief_human_ratings h
         JOIN debrief_quality_judgment j
           ON j."scenarioSessionId" = h."scenarioSessionId"
          AND j."judgeModel" = $1 AND j."judgePromptVersion" = $2
        WHERE h."rubricVersion" = $3`,
      [JUDGE_PAIR.judgeModel, JUDGE_PAIR.judgePromptVersion, RUBRIC_VERSION],
    );
    const hcols = DEBRIEF_QUALITY_DIMENSIONS.map(
      (d) =>
        `a."${d.column}" AS "a_${d.column}", b."${d.column}" AS "b_${d.column}"`,
    ).join(', ');
    const humans: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT a."scenarioSessionId" AS id, ${hcols},
              a."hardFails" AS a_fails, b."hardFails" AS b_fails
         FROM debrief_human_ratings a
         JOIN debrief_human_ratings b
           ON b."scenarioSessionId" = a."scenarioSessionId"
          AND b."rubricVersion" = a."rubricVersion"
          AND b."raterId" > a."raterId"
        WHERE a."rubricVersion" = $1`,
      [RUBRIC_VERSION],
    );
    const [coverage] = await this.dataSource.query(
      `SELECT count(DISTINCT "scenarioSessionId")::int AS debriefs,
              count(*)::int AS ratings,
              count(DISTINCT "raterId")::int AS raters
         FROM debrief_human_ratings WHERE "rubricVersion" = $1`,
      [RUBRIC_VERSION],
    );

    const codesOf = (v: unknown): Set<string> =>
      new Set(
        (Array.isArray(v) ? v : []).map((x) =>
          typeof x === 'string' ? x : String((x as { code?: string })?.code),
        ),
      );
    const summarise = (
      rows: Array<Record<string, unknown>>,
      a: string,
      b: string,
    ) => {
      const dimensions: Record<string, DebriefScoreAgreement> = {};
      for (const d of DEBRIEF_QUALITY_DIMENSIONS) {
        const pairs: RatedPair[] = rows.map((r) => ({
          cutId: String(r.id),
          a: Number(r[`${a}_${d.column}`]),
          b: Number(r[`${b}_${d.column}`]),
        }));
        dimensions[d.dimension] = scoreAgreement(pairs);
      }
      const hardFails: Record<string, DebriefHardFailAgreement> = {};
      for (const code of DEBRIEF_HARD_FAIL_CODES) {
        const pairs: RatedPair[] = rows.map((r) => ({
          cutId: String(r.id),
          a: codesOf(r[`${a}_fails`]).has(code) ? 1 : 0,
          b: codesOf(r[`${b}_fails`]).has(code) ? 1 : 0,
        }));
        hardFails[code] = hardFailAgreement(pairs);
      }
      return { dimensions, hardFails };
    };

    const judgeVsHuman = summarise(judged, 'j', 'h');
    return {
      rubricVersion: RUBRIC_VERSION,
      judge: JUDGE_PAIR,
      target: DEBRIEF_CALIBRATION_TARGET,
      coverage: {
        debriefs: Number(coverage?.debriefs ?? 0),
        ratings: Number(coverage?.ratings ?? 0),
        raters: Number(coverage?.raters ?? 0),
      },
      judgeVsHuman,
      humanVsHuman: summarise(humans, 'a', 'b'),
      gate: autonomyGate(judgeVsHuman.dimensions, judgeVsHuman.hardFails),
    };
  }
}
