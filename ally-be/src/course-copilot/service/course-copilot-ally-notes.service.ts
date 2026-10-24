import { BadGatewayException, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { itemTension } from 'src/guide/conductor/course-spine';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { LoggerService } from 'src/logger/logger.service';
import { TRACK_TRIGGER_WARNINGS_BY_ITEM_SQL } from 'src/track/constants/track-trigger-warnings.constant';
import { TrackSharedService } from 'src/track/service/track-shared.service';
import { TrackGuideNotes } from 'src/track/type/track-guide-notes.type';
import { ArticleContent, TrackItemType } from 'src/track/type/track.type';
import { collectAnswerKeys } from 'src/track/util/guide-notes-answer-leak.util';
import {
  AllyNotesDraft,
  AllyNotesItemInput,
  AllyNotesSpecialist,
} from './specialists/ally-notes.specialist';
import { SpecialistValidationError } from './specialists/specialist.types';
import { htmlToText, truncateAtWord } from './specialists/specialist.util';

const COURSE_DESCRIPTION_MAX_CHARS = 1500;

export const ALLY_NOTES_DRAFT_UNREADABLE_MESSAGE =
  'Course Copilot could not draft notes for Ally that are safe to use, even ' +
  'after a second try. Try again, or write the notes by hand.';
export const ALLY_NOTES_DRAFT_FAILED_MESSAGE =
  'Course Copilot could not draft notes for Ally right now. Try again in a moment.';

/**
 * Gathers what the Ally-notes writer reads — the SAVED course's outline,
 * never its answer keys — and hands it to the specialist. Read-only, like the
 * landing-page draft: the builder shows the draft, and the trainer saves it
 * through `PUT v1/learn/admin/tracks/:id/guide-notes`, which checks it again.
 */
@Injectable()
export class CourseCopilotAllyNotesService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotAllyNotesService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly trackSharedService: TrackSharedService,
    private readonly allyNotesSpecialist: AllyNotesSpecialist,
  ) {}

  /**
   * @throws NotFoundException when the course does not exist.
   * @throws BadGatewayException, with a readable message, when no usable,
   *   answer-free draft comes back after the repair pass, or the call fails.
   */
  async draft(
    trackId: string,
  ): Promise<{ draft: AllyNotesDraft & { draftedByCopilot: true } }> {
    const track = await this.trackSharedService.getTrackWithStructure(trackId);
    const items = track.sections.flatMap((section) => section.items);
    const scenarioIds = [
      ...new Set(
        items
          .filter((item) => item.type === TrackItemType.ROLEPLAY)
          .map((item) => item.scenarioId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const [scenarios, warningRows] = await Promise.all([
      scenarioIds.length
        ? this.dataSource.getRepository(Scenarios).find({
            where: { id: In(scenarioIds) },
            select: { id: true, description: true },
          })
        : Promise.resolve([]),
      this.dataSource.query(TRACK_TRIGGER_WARNINGS_BY_ITEM_SQL, [
        trackId,
      ]) as Promise<Array<{ itemId: string; name: string }>>,
    ]);
    const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
    const warnings = new Map<string, string[]>();
    for (const row of warningRows) {
      warnings.set(row.itemId, [...(warnings.get(row.itemId) ?? []), row.name]);
    }

    const sections = track.sections.map((section) => ({
      title: section.title ?? '',
      items: section.items.map(
        (item): AllyNotesItemInput => ({
          id: item.id,
          type: String(item.type),
          title: item.title ?? '',
          description: item.description ?? null,
          excerpt: excerptOf(item, scenarioById),
          defaultTension: itemTension(
            String(item.type),
            warnings.get(item.id) ?? [],
          ),
        }),
      ),
    }));
    const current = (track.guideNotes ?? null) as TrackGuideNotes | null;

    try {
      const draft = await this.allyNotesSpecialist.generate({
        trackId,
        title: track.title,
        description: truncateAtWord(
          htmlToText(track.description ?? ''),
          COURSE_DESCRIPTION_MAX_CHARS,
        ),
        sections,
        triggerWarnings: items
          .filter((item) => warnings.has(item.id))
          .map((item) => ({
            itemTitle: item.title ?? '',
            names: warnings.get(item.id)!,
          })),
        currentNotes: current?.notes ?? null,
        answerKeys: collectAnswerKeys(items),
        usageMetadata: { trackId, specialist: 'ally_notes' },
      });
      return { draft: { ...draft, draftedByCopilot: true } };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Ally notes draft failed for track ${trackId}: ${detail}`,
      );
      throw new BadGatewayException(
        error instanceof SpecialistValidationError
          ? ALLY_NOTES_DRAFT_UNREADABLE_MESSAGE
          : ALLY_NOTES_DRAFT_FAILED_MESSAGE,
      );
    }
  }
}

/**
 * A short plain-text window into an item: an article's opening (inline
 * question placeholders are empty divs and drop out), or a roleplay's
 * learner-facing scenario summary — never the actor's prompt, never a quiz.
 */
function excerptOf(
  item: {
    type: TrackItemType | string;
    content?: unknown;
    scenarioId?: number | null;
  },
  scenarios: Map<number, { description?: string | null }>,
): string | null {
  if (item.type === TrackItemType.ARTICLE) {
    const html = (item.content as ArticleContent | undefined)?.html ?? '';
    return htmlToText(html) || null;
  }
  if (item.type === TrackItemType.ROLEPLAY && item.scenarioId) {
    return scenarios.get(item.scenarioId)?.description ?? null;
  }
  return null;
}
