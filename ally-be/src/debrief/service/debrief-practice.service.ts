import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { LoggerService } from '../../logger/logger.service';
import { ScenarioService } from '../../learn/service/scenario.service';

/** A roleplay the Writer may point "Practise this next" to. */
export interface PracticeOption {
  id: number;
  title: string;
  skills: string[];
}

/** The most options the Writer is shown; enough to choose, cheap to read. */
const MAX_OPTIONS = 30;

/**
 * "Practise this next" (v9 FR-32, `find_next_practice`): the roleplays this
 * learner can open, read exactly as their Simulations list reads them — the
 * same tenant assignment, cohort visibility and published-version rules —
 * by running `ScenarioService.getScenariosV2` as the learner. Standalone
 * roleplays have no locks; anything inside a path, case or course is not in
 * that list, so it is never offered.
 */
@Injectable()
export class DebriefPracticeService {
  private readonly logger = LoggerService.getInstance(
    DebriefPracticeService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly scenarios: ScenarioService,
  ) {}

  /** The learner's roleplays with the skills each practises, for the Writer. */
  async optionsFor(
    userId: number | null,
    tenantId: string | null,
  ): Promise<PracticeOption[]> {
    const listed = await this.listed(userId, tenantId);
    if (!listed.length) return [];
    const rows: Array<{ id: number; skills: string[] | null }> =
      await this.dataSource.query(
        `SELECT s.id,
                ARRAY(SELECT c.name FROM competencies c
                       WHERE c.id::text IN (
                         SELECT jsonb_array_elements_text(COALESCE(s."competencyIds", '[]'::jsonb)))
                       ORDER BY c.name) AS skills
           FROM scenarios s WHERE s.id = ANY($1::int[])`,
        [listed.map((s) => s.id)],
      );
    const skills = new Map(rows.map((r) => [Number(r.id), r.skills ?? []]));
    return listed
      .map((s) => ({ ...s, skills: skills.get(s.id) ?? [] }))
      .sort((a, b) => b.skills.length - a.skills.length)
      .slice(0, MAX_OPTIONS);
  }

  /**
   * Of these roleplays, the ones the learner can still open, with their
   * current titles. A button whose roleplay has gone is hidden, not broken.
   */
  async available(
    userId: number,
    tenantId: string,
    ids: number[],
  ): Promise<Array<{ id: number; title: string }>> {
    if (!ids.length) return [];
    const wanted = new Set(ids);
    return (await this.listed(userId, tenantId)).filter((s) =>
      wanted.has(s.id),
    );
  }

  private async listed(
    userId: number | null,
    tenantId: string | null,
  ): Promise<Array<{ id: number; title: string }>> {
    if (!userId || !tenantId) return [];
    try {
      const { data } = await ExecutionManager.runWithContext(
        async () => {
          ExecutionManager.setAuthContext(String(userId), tenantId);
          return this.scenarios.getScenariosV2();
        },
        { path: 'debrief-practice' },
      );
      return (data ?? []).map((s: { id: number; title: string }) => ({
        id: Number(s.id),
        title: s.title,
      }));
    } catch (e) {
      // No practice suggestion never stops a debrief.
      this.logger.warn(
        `[debrief] practice options unavailable: ${(e as Error).message}`,
      );
      return [];
    }
  }
}
