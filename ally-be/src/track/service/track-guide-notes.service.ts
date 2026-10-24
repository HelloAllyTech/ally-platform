import {
  BadRequestException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorCode } from 'src/exception/error-code.enum';
import { itemTension } from 'src/guide/conductor/course-spine';
import { TRACK_TRIGGER_WARNINGS_BY_ITEM_SQL } from '../constants/track-trigger-warnings.constant';
import { TrackRepository } from '../repository/track.repository';
import {
  GUIDE_NOTES_MAX_CHARS,
  GuideNotesTension,
  TrackGuideNotes,
} from '../type/track-guide-notes.type';
import {
  AnswerLeak,
  collectAnswerKeys,
  findAnswerLeaks,
} from '../util/guide-notes-answer-leak.util';
import { TrackService } from './track.service';

const TENSIONS: readonly GuideNotesTension[] = ['low', 'medium', 'high'];

export interface TrackGuideNotesItemView {
  id: string;
  title: string;
  type: string;
  sectionId: string;
  sectionTitle: string;
  /** What Ally assumes with no override: by type, raised by trigger warnings. */
  defaultTension: GuideNotesTension;
  /** The trainer's override, or null. */
  tension: GuideNotesTension | null;
  triggerWarnings: string[];
}

export interface TrackGuideNotesView {
  trackId: string;
  notes: string | null;
  draftedByCopilot: boolean;
  /** Items in course order, each with its default and overridden tension. */
  items: TrackGuideNotesItemView[];
  notesMaxChars: number;
}

/**
 * The course builder's Ally notes (plans/ally-guide/plan.md §4.4, §7.6,
 * §10.5): what a trainer tells Ally about a course, and per-item pacing
 * tension. Stored on `tracks.guideNotes`, read into Ally's course layer.
 *
 * Saving is refused while the notes contain the text of a quiz answer — the
 * notes reach Ally's prompt, and the firewall (§6.4) is that Ally never
 * holds an answer it could pass on.
 */
@Injectable()
export class TrackGuideNotesService {
  constructor(
    private readonly trackService: TrackService,
    private readonly trackRepository: TrackRepository,
    private readonly dataSource: DataSource,
  ) {}

  /** Gated like reading the course in the builder. */
  async get(trackId: string): Promise<TrackGuideNotesView> {
    const track = await this.trackService.getTrackById(trackId);
    const warnings = await this.triggerWarnings(trackId);
    const notes = (track.guideNotes ?? null) as TrackGuideNotes | null;
    const overrides = notes?.tension ?? {};
    return {
      trackId,
      notes: notes?.notes ?? null,
      draftedByCopilot: Boolean(notes?.draftedByCopilot),
      notesMaxChars: GUIDE_NOTES_MAX_CHARS,
      items: track.sections.flatMap((section) =>
        section.items.map((item) => {
          const itemWarnings = warnings.get(item.id) ?? [];
          return {
            id: item.id,
            title: item.title ?? '',
            type: String(item.type),
            sectionId: section.id,
            sectionTitle: section.title ?? '',
            defaultTension: itemTension(String(item.type), itemWarnings),
            // An override for an item since removed is simply not shown.
            tension: overrides[item.id] ?? null,
            triggerWarnings: itemWarnings,
          };
        }),
      ),
    };
  }

  /**
   * Replace the notes. Gated like editing the course.
   *
   * @throws BadRequestException for an unknown item or tension level.
   * @throws UnprocessableEntityException (GUIDE_NOTES_ANSWER_LEAK) when the
   *   notes carry a quiz answer; nothing is saved.
   */
  async save(
    trackId: string,
    input: {
      notes?: string | null;
      tension?: Record<string, string> | null;
      draftedByCopilot?: boolean;
    },
  ): Promise<TrackGuideNotesView> {
    await this.trackService.assertCallerMayEdit(trackId);
    const track = await this.trackService.getTrackById(trackId);
    const items = track.sections.flatMap((section) => section.items);
    const itemIds = new Set(items.map((item) => item.id));

    const text = input.notes?.trim() || null;
    if (text && text.length > GUIDE_NOTES_MAX_CHARS) {
      throw new BadRequestException(
        `Ally notes can be up to ${GUIDE_NOTES_MAX_CHARS} characters`,
      );
    }
    const tension: Record<string, GuideNotesTension> = {};
    for (const [itemId, level] of Object.entries(input.tension ?? {})) {
      if (!itemIds.has(itemId)) {
        throw new BadRequestException(
          `Item ${itemId} is not in this course. Reload the course and try again.`,
        );
      }
      if (!TENSIONS.includes(level as GuideNotesTension)) {
        throw new BadRequestException(
          `Tension must be one of ${TENSIONS.join(', ')}`,
        );
      }
      tension[itemId] = level as GuideNotesTension;
    }

    const leaks = findAnswerLeaks(text, collectAnswerKeys(items));
    if (leaks.length) throw answerLeakError(leaks);

    const value: TrackGuideNotes | null =
      text || Object.keys(tension).length
        ? {
            notes: text,
            tension,
            draftedByCopilot: Boolean(input.draftedByCopilot && text),
          }
        : null;
    await this.trackRepository.update(trackId, { guideNotes: value as never });
    return this.get(trackId);
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
      byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row.name]);
    }
    return byItem;
  }
}

/** What to fix, in the trainer's terms: which answer, and where it lives. */
export function answerLeakError(
  leaks: AnswerLeak[],
): UnprocessableEntityException {
  const named = leaks
    .slice(0, 3)
    .map(
      (leak) =>
        `"${leak.answer}"${leak.itemTitle ? ` (${leak.itemTitle})` : ''}`,
    )
    .join(', ');
  const more = leaks.length > 3 ? ` and ${leaks.length - 3} more` : '';
  return new UnprocessableEntityException({
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      `These notes include a quiz answer Ally could pass on to learners: ${named}${more}. ` +
      'Describe the idea without the answer, or remove it, then save.',
    error: 'Unprocessable Entity',
    errorCode: ErrorCode.GUIDE_NOTES_ANSWER_LEAK,
  });
}
