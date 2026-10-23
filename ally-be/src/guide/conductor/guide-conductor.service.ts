import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Track } from 'src/track/entity/track.entity';
import { TrackEnrollmentService } from 'src/track/service/track-enrollment.service';
import { TrackItemType } from 'src/track/type/track.type';
import { TrackGuideNotes } from 'src/track/type/track-guide-notes.type';
import { CourseContext } from '../context/guide-context';
import { LearnerTrackView, buildCourseSpine } from './course-spine';

/**
 * Trigger warnings per item: a roleplay's own scenario, or every scenario in
 * a case. The landing page's equivalent groups by chapter; the Conductor
 * needs them per item for tension and atmosphere.
 */
const TRIGGER_WARNINGS_BY_ITEM_SQL = `
  WITH item_scenarios AS (
    SELECT ti."id" AS "itemId", ti."scenarioId" AS "scenarioId"
    FROM "track_items" ti
    WHERE ti."trackId" = $1::uuid
      AND ti."deletedAt" IS NULL
      AND ti."type" = '${TrackItemType.ROLEPLAY}'
      AND ti."scenarioId" IS NOT NULL
    UNION ALL
    SELECT ti."id", ci."scenarioId"
    FROM "track_items" ti
    JOIN "case_items" ci
      ON ci."caseId" = ti."caseId" AND ci."deletedAt" IS NULL
    WHERE ti."trackId" = $1::uuid
      AND ti."deletedAt" IS NULL
      AND ti."type" = '${TrackItemType.CASE}'
  )
  SELECT DISTINCT s."itemId" AS "itemId", tw."name" AS "name"
  FROM item_scenarios s
  JOIN "scenario_trigger_warnings" stw ON stw."scenarioId" = s."scenarioId"
  JOIN "trigger_warnings" tw ON tw."id" = stw."triggerWarningId"
`;

/**
 * The Conductor's view of a course for one learner (plans/ally-guide/plan.md
 * §7.7). Reads the SAME learner detail classic renders — through
 * TrackEnrollmentService, inside the learner's execution context — so the
 * guide can never show an item as open that classic shows as locked.
 */
@Injectable()
export class GuideConductorService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trackEnrollment: TrackEnrollmentService,
  ) {}

  /** Must run inside ExecutionManager context for the learner. */
  async loadCourse(trackId: string): Promise<CourseContext> {
    const [detail, track, warnings] = await Promise.all([
      this.trackEnrollment.getTrackDetailForLearner(trackId),
      this.dataSource.getRepository(Track).findOne({
        where: { id: trackId },
        select: { id: true, guideNotes: true },
      }),
      this.triggerWarnings(trackId),
    ]);
    const guideNotes = (track?.guideNotes ?? null) as TrackGuideNotes | null;
    const spine = buildCourseSpine(detail as unknown as LearnerTrackView, {
      guideNotes,
      triggerWarningsByItem: warnings,
    });
    return {
      title: detail.title ?? '',
      description: detail.description ?? null,
      languageCode: detail.languageCode ?? 'en',
      trainerNotes: guideNotes?.notes ?? null,
      spine,
    };
  }

  private async triggerWarnings(
    trackId: string,
  ): Promise<Map<string, string[]>> {
    const rows: Array<{ itemId: string; name: string }> =
      await this.dataSource.query(TRIGGER_WARNINGS_BY_ITEM_SQL, [trackId]);
    const byItem = new Map<string, string[]>();
    for (const row of rows) {
      const list = byItem.get(row.itemId) ?? [];
      list.push(row.name);
      byItem.set(row.itemId, list);
    }
    return byItem;
  }
}
