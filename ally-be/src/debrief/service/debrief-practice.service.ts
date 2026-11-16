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
  /**
   * The session is part of a course (named here, for the Writer): the only
   * option is this same roleplay, practised again.
   */
  course?: string;
  /** In a course: this is the roleplay the learner just did. */
  this_roleplay?: boolean;
  /** In a course: the course item the apps open in the course player. */
  trackItemId?: string;
}

/** The roleplay of a course session: the course item it was played for. */
export interface CourseRoleplay {
  id: number;
  title: string;
  /** The course item it is (the apps open it inside the course player). */
  trackItemId: string;
}

/** The session's course and its roleplay, the only one a learner is sent to. */
export interface SessionCourse {
  title: string;
  /** The course could not be read: offer nothing rather than a wrong item. */
  unreadable?: boolean;
  roleplay: CourseRoleplay | null;
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

  /**
   * The learner's roleplays with the skills each practises, for the Writer.
   * A session played inside a course is offered only this same roleplay, as
   * its course item: "Practise this again" (clinical review 2026-11-16: no
   * other roleplay is suggested inside a course). Outside a course, the
   * learner's own list.
   */
  async optionsFor(
    userId: number | null,
    tenantId: string | null,
    sessionId?: string | null,
  ): Promise<PracticeOption[]> {
    const course = sessionId ? await this.course(sessionId) : null;
    if (course) {
      const r = course.roleplay;
      if (!r) return [];
      const skills = await this.skillsOf([r.id]);
      return [
        {
          id: r.id,
          title: r.title,
          skills: skills.get(r.id) ?? [],
          course: course.title,
          this_roleplay: true,
          trackItemId: r.trackItemId,
        },
      ];
    }
    const listed = await this.listed(userId, tenantId);
    if (!listed.length) return [];
    const skills = await this.skillsOf(listed.map((s) => s.id));
    return listed
      .map((s) => ({ ...s, skills: skills.get(s.id) ?? [] }))
      .sort((a, b) => b.skills.length - a.skills.length)
      .slice(0, MAX_OPTIONS);
  }

  /**
   * The course a session was played in (`scenario_sessions.trackItemProgressId`
   * → its item → its course) and this session's roleplay as that course
   * item. Null for a session outside a course; no roleplay when the course
   * cannot be read.
   */
  async course(sessionId: string): Promise<SessionCourse | null> {
    try {
      const rows: Array<{
        id: number;
        title: string | null;
        course: string | null;
        track_item_id: string;
      }> = await this.dataSource.query(
        `SELECT sc.id, sc.title, t.title AS course, ti.id AS track_item_id
           FROM scenario_sessions s
           JOIN track_item_progress tip ON tip.id = s."trackItemProgressId"
           JOIN track_items ti ON ti.id = tip."trackItemId"
           JOIN tracks t ON t.id = ti."trackId"
           JOIN scenarios sc ON sc.id = COALESCE(s."scenarioId", ti."scenarioId")
          WHERE s.id = $1`,
        [sessionId],
      );
      const r = rows?.[0];
      if (!r) {
        // A course session whose item cannot be read still never gets the
        // library's roleplays.
        const [own] = await this.dataSource.query(
          `SELECT "trackItemProgressId" AS tip FROM scenario_sessions WHERE id = $1`,
          [sessionId],
        );
        return own?.tip
          ? { title: '', roleplay: null, unreadable: true }
          : null;
      }
      return {
        title: r.course ?? '',
        roleplay: {
          id: Number(r.id),
          title: r.title ?? '',
          trackItemId: String(r.track_item_id),
        },
      };
    } catch (e) {
      // Unreadable: offer nothing rather than risk the wrong roleplay.
      this.logger.warn(
        `[debrief] course practice options unavailable: ${(e as Error).message}`,
      );
      return { title: '', roleplay: null, unreadable: true };
    }
  }

  private async skillsOf(ids: number[]): Promise<Map<number, string[]>> {
    if (!ids.length) return new Map();
    const rows: Array<{ id: number; skills: string[] | null }> =
      await this.dataSource.query(
        `SELECT s.id,
                ARRAY(SELECT c.name FROM competencies c
                       WHERE c.id::text IN (
                         SELECT jsonb_array_elements_text(COALESCE(s."competencyIds", '[]'::jsonb)))
                       ORDER BY c.name) AS skills
           FROM scenarios s WHERE s.id = ANY($1::int[])`,
        [ids],
      );
    return new Map(rows.map((r) => [Number(r.id), r.skills ?? []]));
  }

  /**
   * Of these roleplays, the ones the learner can still open, with their
   * current titles. A button whose roleplay has gone is hidden, not broken.
   * Inside a course, only this same roleplay, with its course item.
   */
  async available(
    userId: number,
    tenantId: string,
    ids: number[],
    sessionId?: string | null,
  ): Promise<Array<{ id: number; title: string; trackItemId?: string }>> {
    if (!ids.length) return [];
    const wanted = new Set(ids);
    const course = sessionId ? await this.course(sessionId) : null;
    if (course) {
      const r = course.roleplay;
      return r && wanted.has(r.id)
        ? [{ id: r.id, title: r.title, trackItemId: r.trackItemId }]
        : [];
    }
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
      return (data ?? []).map((s) => ({
        id: Number(s.id),
        title: s.title ?? '',
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
