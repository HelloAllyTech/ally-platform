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
   * The session is part of a course (named here, for the Writer). Set on
   * every option of a course session.
   */
  course?: string;
  /** In a course: this is the roleplay the learner just did. */
  this_roleplay?: boolean;
  /**
   * In a course: a roleplay from the learner's own list outside the course.
   * It does not count towards the course.
   */
  outside_course?: boolean;
}

/** A roleplay of the session's course the learner has reached. */
export interface CourseRoleplay {
  id: number;
  title: string;
  /** The learner completed its course item. */
  done: boolean;
  /** The roleplay of this session. */
  current: boolean;
  /** The course item it is (the apps open it inside the course player). */
  trackItemId: string;
}

/** The session's course and the roleplays in it the learner may be sent to. */
export interface SessionCourse {
  title: string;
  /** The course could not be read: offer nothing rather than risk a spoiler. */
  unreadable?: boolean;
  roleplays: CourseRoleplay[];
  /**
   * Every roleplay in the course, reached or not: never offered from the
   * learner's own list, so a later item is never spoiled (review 2026-11-16).
   */
  allIds: number[];
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
   * A session played inside a course is offered that course's roleplays the
   * learner has already reached first (see `course`), then roleplays from
   * the learner's own list that are not in the course at all (marked
   * `outside_course`). A course roleplay they have not reached is never
   * offered, from either list (review 2026-11-16: the middle option).
   */
  async optionsFor(
    userId: number | null,
    tenantId: string | null,
    sessionId?: string | null,
  ): Promise<PracticeOption[]> {
    const course = sessionId ? await this.course(sessionId) : null;
    if (course) {
      const outside = course.unreadable
        ? []
        : (await this.listed(userId, tenantId)).filter(
            (s) => !course.allIds.includes(s.id),
          );
      const skills = await this.skillsOf([
        ...course.roleplays.map((r) => r.id),
        ...outside.map((s) => s.id),
      ]);
      const inCourse: PracticeOption[] = course.roleplays.map((r) => ({
        id: r.id,
        title: r.title,
        skills: skills.get(r.id) ?? [],
        course: course.title,
        ...(r.current ? { this_roleplay: true } : {}),
      }));
      const fromList: PracticeOption[] = outside
        .map((s) => ({
          id: s.id,
          title: s.title,
          skills: skills.get(s.id) ?? [],
          course: course.title,
          outside_course: true,
        }))
        .sort((a, b) => b.skills.length - a.skills.length);
      return [...inCourse, ...fromList].slice(0, MAX_OPTIONS);
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
   * → its item → its course), with the roleplays of that course the learner
   * has reached: items at or before this one in course order, or ones they
   * completed. Never a later item they have not reached (it would spoil the
   * course), never one outside it. Ordered: reached but not done first, then
   * this roleplay, then the done ones; this roleplay is always there. Null
   * for a session outside a course; no roleplays when the course cannot be
   * read.
   */
  async course(sessionId: string): Promise<SessionCourse | null> {
    try {
      const rows: Array<{
        id: number;
        title: string | null;
        course: string | null;
        done: boolean;
        current: boolean;
        track_item_id: string;
      }> = await this.dataSource.query(
        `WITH cur AS (
           SELECT s."scenarioId" AS scenario_id, ti."trackId" AS track_id,
                  ti.id AS item_id, ts."order" AS s_order, ti."order" AS i_order,
                  tip."trackEnrollmentId" AS enrollment_id
             FROM scenario_sessions s
             JOIN track_item_progress tip ON tip.id = s."trackItemProgressId"
             JOIN track_items ti ON ti.id = tip."trackItemId"
             JOIN track_sections ts ON ts.id = ti."trackSectionId"
            WHERE s.id = $1)
         SELECT sc.id, sc.title, t.title AS course, ti.id AS track_item_id,
                COALESCE(p.status = 'COMPLETED', false) AS done,
                (ti.id = cur.item_id OR sc.id = cur.scenario_id) AS current
           FROM cur
           JOIN tracks t ON t.id = cur.track_id
           JOIN track_items ti ON ti."trackId" = cur.track_id
                              AND ti."deletedAt" IS NULL
                              AND ti."scenarioId" IS NOT NULL
           JOIN track_sections ts ON ts.id = ti."trackSectionId" AND ts."deletedAt" IS NULL
           JOIN scenarios sc ON sc.id = ti."scenarioId"
           LEFT JOIN track_item_progress p ON p."trackItemId" = ti.id
                                          AND p."trackEnrollmentId" = cur.enrollment_id
                                          AND p."deletedAt" IS NULL
          WHERE (ts."order", ti."order") <= (cur.s_order, cur.i_order)
             OR p.status = 'COMPLETED'
             OR ti.id = cur.item_id
          ORDER BY ts."order", ti."order"`,
        [sessionId],
      );
      if (!rows?.length) {
        // A course session whose course lists no roleplay it can offer still
        // never gets the library's.
        const [own] = await this.dataSource.query(
          `SELECT "trackItemProgressId" AS tip FROM scenario_sessions WHERE id = $1`,
          [sessionId],
        );
        return own?.tip
          ? { title: '', roleplays: [], allIds: [], unreadable: true }
          : null;
      }
      const seen = new Map<number, CourseRoleplay>();
      for (const r of rows) {
        const id = Number(r.id);
        const prev = seen.get(id);
        const current = (prev?.current ?? false) || r.current === true;
        seen.set(id, {
          id,
          title: r.title ?? '',
          // The item this session was played for, else the first one.
          trackItemId:
            r.current === true || !prev
              ? String(r.track_item_id)
              : prev.trackItemId,
          done: (prev?.done ?? false) || r.done === true,
          current,
        });
      }
      const rank = (r: CourseRoleplay) => (r.current ? 1 : r.done ? 2 : 0);
      const roleplays = [...seen.values()].sort((a, b) => rank(a) - rank(b));
      const all: Array<{ id: number }> = await this.dataSource.query(
        `SELECT DISTINCT ti."scenarioId" AS id
           FROM scenario_sessions s
           JOIN track_item_progress tip ON tip.id = s."trackItemProgressId"
           JOIN track_items cur ON cur.id = tip."trackItemId"
           JOIN track_items ti ON ti."trackId" = cur."trackId"
          WHERE s.id = $1 AND ti."scenarioId" IS NOT NULL`,
        [sessionId],
      );
      return {
        title: rows[0].course ?? '',
        roleplays,
        allIds: (all ?? []).map((r) => Number(r.id)),
      };
    } catch (e) {
      // Unreadable: offer nothing rather than risk the wrong roleplays.
      this.logger.warn(
        `[debrief] course practice options unavailable: ${(e as Error).message}`,
      );
      return { title: '', roleplays: [], allIds: [], unreadable: true };
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
   */
  async available(
    userId: number,
    tenantId: string,
    ids: number[],
    sessionId?: string | null,
  ): Promise<
    Array<{
      id: number;
      title: string;
      trackItemId?: string;
      outsideCourse?: boolean;
    }>
  > {
    if (!ids.length) return [];
    const wanted = new Set(ids);
    // Inside a course: the course's roleplays the learner has reached, and
    // their own roleplays outside the course; never a course item not reached.
    const course = sessionId ? await this.course(sessionId) : null;
    if (course) {
      const reached = course.roleplays
        .filter((r) => wanted.has(r.id))
        .map(({ id, title, trackItemId }) => ({ id, title, trackItemId }));
      if (course.unreadable) return reached;
      const outside = (await this.listed(userId, tenantId)).filter(
        (s) => wanted.has(s.id) && !course.allIds.includes(s.id),
      );
      return [
        ...reached,
        ...outside.map((s) => ({ ...s, outsideCourse: true })),
      ];
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
