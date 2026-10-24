import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SessionItemStatus } from 'src/common/type/common.type';
import { Track } from 'src/track/entity/track.entity';
import { TrackEnrollmentService } from 'src/track/service/track-enrollment.service';
import { TrackSharedService } from 'src/track/service/track-shared.service';
import { TRACK_TRIGGER_WARNINGS_BY_ITEM_SQL } from 'src/track/constants/track-trigger-warnings.constant';
import { TrackGuideNotes } from 'src/track/type/track-guide-notes.type';
import { CourseContext } from '../context/guide-context';
import { LearnerTrackView, buildCourseSpine } from './course-spine';

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
    private readonly shared: TrackSharedService,
  ) {}

  /**
   * A course as an imagined learner `completed` items in would see it — for
   * the Ally Console's Playground (plan §10.5), which has no learner. Built
   * from the course's own structure, in its own order: the first
   * `completed` items done, the next one open, the rest locked.
   */
  async loadPreviewCourse(
    trackId: string,
    completed: number,
  ): Promise<CourseContext> {
    const [structure, track, warnings] = await Promise.all([
      this.shared.getTrackWithStructure(trackId),
      this.dataSource.getRepository(Track).findOne({
        where: { id: trackId },
        select: { id: true, guideNotes: true },
      }),
      this.triggerWarnings(trackId),
    ]);
    const guideNotes = (track?.guideNotes ?? null) as TrackGuideNotes | null;
    let index = 0;
    const view: LearnerTrackView = {
      id: structure.id,
      title: structure.title ?? null,
      enrolled: true,
      sections: structure.sections.map((section) => ({
        id: section.id,
        title: section.title ?? null,
        order: section.order,
        items: section.items.map((item: any) => {
          const position = index++;
          return {
            id: item.id,
            type: item.type,
            order: item.order,
            title: item.title ?? null,
            description: item.description ?? null,
            status:
              position < completed
                ? SessionItemStatus.COMPLETED
                : position === completed
                  ? SessionItemStatus.UNLOCKED
                  : SessionItemStatus.LOCKED,
            completionCriteria: item.completionCriteria ?? null,
          };
        }),
      })),
    };
    return {
      title: structure.title ?? '',
      description: structure.description ?? null,
      languageCode: (structure as any).languageCode ?? 'en',
      trainerNotes: guideNotes?.notes ?? null,
      spine: buildCourseSpine(view, {
        guideNotes,
        triggerWarningsByItem: warnings,
      }),
    };
  }

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

  /**
   * The course as an anonymous visitor sees it (plan §2.3): the public
   * outline only — titles, descriptions, types and answer-free counts — and
   * no progress, so nothing can be presented. 404 unless the course is
   * published with its share link on, exactly as the public page.
   */
  async loadPublicCourse(trackId: string): Promise<CourseContext> {
    const [outline, track, warnings] = await Promise.all([
      this.trackEnrollment.getPublicTrackOutline(trackId),
      this.dataSource.getRepository(Track).findOne({
        where: { id: trackId },
        select: { id: true, guideNotes: true },
      }),
      this.triggerWarnings(trackId),
    ]);
    const guideNotes = (track?.guideNotes ?? null) as TrackGuideNotes | null;
    let first = true;
    const view: LearnerTrackView = {
      id: outline.id,
      title: outline.title ?? null,
      enrolled: false,
      sections: outline.sections.map((section) => ({
        id: section.id,
        title: section.title ?? null,
        order: section.order,
        items: section.items.map((item) => {
          // Where they would start, once signed in; the rest is ahead.
          const status = first
            ? SessionItemStatus.UNLOCKED
            : SessionItemStatus.LOCKED;
          first = false;
          return {
            id: item.id,
            type: item.type,
            order: item.order,
            title: item.title ?? null,
            description: item.description ?? null,
            status,
            contentMeta: item.contentMeta as Record<string, unknown> | null,
          };
        }),
      })),
    };
    return {
      title: outline.title ?? '',
      description: outline.description ?? null,
      languageCode: outline.languageCode ?? 'en',
      trainerNotes: guideNotes?.notes ?? null,
      spine: buildCourseSpine(view, {
        guideNotes,
        triggerWarningsByItem: warnings,
      }),
    };
  }

  private async triggerWarnings(
    trackId: string,
  ): Promise<Map<string, string[]>> {
    const rows: Array<{ itemId: string; name: string }> =
      await this.dataSource.query(TRACK_TRIGGER_WARNINGS_BY_ITEM_SQL, [
        trackId,
      ]);
    const byItem = new Map<string, string[]>();
    for (const row of rows) {
      const list = byItem.get(row.itemId) ?? [];
      list.push(row.name);
      byItem.set(row.itemId, list);
    }
    return byItem;
  }
}
