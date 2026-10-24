import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CourseSpine } from '../conductor/course-spine';
import {
  GuideCard as GuideCardEvent,
  GuideFinalePayload,
} from '../contract/generated/guide-contract';
import { GuideCard } from '../entity/guide-card.entity';
import { GuideThread } from '../entity/guide-thread.entity';
import {
  GuideCardKind,
  GuideCardPresentation,
  GuideCardState,
  GuideMode,
  GuideNotebookKind,
  GuideTone,
} from '../enum/guide.enum';
import { GuideEventBusService } from './guide-event-bus.service';

/** Days until the finale's spaced-recall look back (plan §3 stage 13). */
export const FINALE_RECALL_DAYS = 7;
/** Noticing moments the finale replays, at most (the latest). */
const FINALE_MAX_NOTICINGS = 6;
/** The advice line's limit (plan Appendix A "Advice line length"). */
export const ADVICE_LINE_MAX_CHARS = 200;
/**
 * A course is heavy when this share of its items carry trigger warnings, or
 * any of its practices (bosses) does: the finale is then hushed.
 */
export const HEAVY_WARNING_SHARE = 0.25;

export const FINALE_COPY = {
  title: (course: string) => `Looking back on ${course}`,
  firstMove:
    'This is how you answered at the very start. How would you answer it now?',
  possibleSelf:
    'You said this is the helper you want to become. Does it still fit?',
  fieldTitle: 'Try it on your next shift',
  fieldWatching: (watchFor: string) =>
    `On your next shift, watch for this: ${watchFor} Afterwards, come back and tell me what happened.`,
  fieldDefault:
    'On your next shift, try one thing from this course and notice what happens. Afterwards, come back and tell me how it went.',
  recallTitle: 'A short look back in a week',
  recallBody:
    'Three quick questions, seven days from now, to help what you learned stick.',
  mentorTitle: 'Leave a line for the next learner',
  mentorBody: 'What would you tell someone just starting this course?',
} as const;

/**
 * Heavy material hushes the finale (plan §5.10, §4.7): festive motion over
 * a course about suicide or abuse would clash with what the learner just
 * went through (Stacks: Beauty's Aesthetic Cost in Game Design).
 */
export function isHeavyCourse(spine: CourseSpine): boolean {
  if (!spine.items.length) return false;
  const warned = spine.items.filter((item) => item.triggerWarnings.length);
  if (warned.some((item) => item.boss)) return true;
  return warned.length / spine.items.length >= HEAVY_WARNING_SHARE;
}

/** The finale's tone: festive, unless the course is heavy or the moment is hard. */
export function finaleTone(input: {
  spine: CourseSpine;
  mode: GuideMode;
}): GuideTone.QUIET | GuideTone.FESTIVE {
  return isHeavyCourse(input.spine) || input.mode !== GuideMode.NORMAL
    ? GuideTone.QUIET
    : GuideTone.FESTIVE;
}

/**
 * The finale card's payload (plan §3 stage 13, §5.10): the learner's first
 * move beside an invitation to answer it again now, their possible self
 * revisited, the noticing moments, and three doors — a field assignment,
 * a spaced-recall look back, and the mentor door. Everything shown is the
 * learner's own words or Ally's noticing; there is no score anywhere.
 */
export function buildFinalePayload(input: {
  hushed: boolean;
  firstMove: { text: string; question: string | null } | null;
  possibleSelf: string | null;
  noticings: string[];
  watchFor: string | null;
  now: Date;
  /** Advice lines are a separate workstream; the door stays shut until then. */
  adviceLinesAvailable?: boolean;
}): GuideFinalePayload {
  const watchFor = input.watchFor?.trim().replace(/\s+/g, ' ') ?? '';
  const watching = watchFor
    ? /[.!?]$/.test(watchFor)
      ? watchFor
      : `${watchFor}.`
    : '';
  return {
    hushed: input.hushed,
    firstMove: input.firstMove?.text.trim()
      ? {
          text: input.firstMove.text.trim(),
          question: input.firstMove.question?.trim() || null,
          invitation: FINALE_COPY.firstMove,
        }
      : null,
    possibleSelf: input.possibleSelf?.trim()
      ? {
          text: input.possibleSelf.trim(),
          invitation: FINALE_COPY.possibleSelf,
        }
      : null,
    noticings: input.noticings
      .map((text) => text.trim())
      .filter(Boolean)
      .slice(-FINALE_MAX_NOTICINGS),
    doors: [
      {
        kind: 'field_assignment',
        title: FINALE_COPY.fieldTitle,
        body: watching
          ? FINALE_COPY.fieldWatching(watching).slice(0, 400)
          : FINALE_COPY.fieldDefault,
        available: true,
      },
      {
        kind: 'spaced_recall',
        title: FINALE_COPY.recallTitle,
        body: FINALE_COPY.recallBody,
        suggestedAt: new Date(
          input.now.getTime() + FINALE_RECALL_DAYS * 86_400_000,
        ).toISOString(),
        available: true,
      },
      {
        kind: 'mentor',
        title: FINALE_COPY.mentorTitle,
        body: FINALE_COPY.mentorBody,
        maxChars: ADVICE_LINE_MAX_CHARS,
        available: input.adviceLinesAvailable === true,
      },
    ],
  };
}

/**
 * What Ally is told when the finale is on screen: host it briefly, scaled
 * to the course's tone, and point at pride in becoming — a specific change
 * it saw, not praise (Stacks: Combine Emotional Triggers for Pure Emotion).
 */
export function finaleHostingNote(payload: GuideFinalePayload): string {
  return [
    'The learner has finished the whole course, and the finale is on their screen now:',
    payload.firstMove
      ? 'it shows their first move beside an invitation to answer the same question now,'
      : 'it has no first move to compare (they started signed in),',
    payload.possibleSelf
      ? 'their possible self, the noticing moments, and three doors (a field assignment, a look back in a week, and leaving a line for the next learner).'
      : 'the noticing moments, and three doors (a field assignment, a look back in a week, and leaving a line for the next learner).',
    'Host it in two or three sentences: name one specific change you saw in them, then',
    payload.firstMove
      ? 'invite them to answer their first move again, in their own words.'
      : 'ask what they will take into their next shift.',
    'Do not repeat or list what is on the card. No scores, no exclamation marks.',
    payload.hushed
      ? 'The material was heavy or the moment is hard: keep it quiet and plain, with no celebration.'
      : 'It is a real accomplishment: warm, and proud of who they are becoming.',
    'If they answer their first move again, save their words to the notebook as a reflection.',
  ].join(' ');
}

export type FinaleOutcome =
  | { presented: true; card: GuideCardEvent; payload: GuideFinalePayload }
  | {
      presented: false;
      reason: 'visitor' | 'not_finished' | 'already_shown' | 'crisis';
    };

/**
 * Presents the finale when a course is complete (plan §3 stage 13). Once
 * per thread; never in the middle of a crisis — the next turn after it
 * passes presents it then (`presentIfDue`). The thread stays open
 * afterwards (plan D3): the card stays in the feed to be replayed, the
 * notebook stays available, and Ally can still talk about the course.
 */
@Injectable()
export class GuideFinaleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly bus: GuideEventBusService,
    @InjectRepository(GuideCard)
    private readonly cards: Repository<GuideCard>,
  ) {}

  async present(
    thread: Pick<
      GuideThread,
      'id' | 'userId' | 'tenantId' | 'trackId' | 'mode'
    >,
    spine: CourseSpine,
    courseTitle: string,
    options: {
      now?: Date;
      /** A turn's own emitter, so its seq bookkeeping stays right. */
      emit?: (
        type: 'card.presented',
        data: { card: GuideCardEvent },
      ) => Promise<number>;
    } = {},
  ): Promise<FinaleOutcome> {
    const now = options.now ?? new Date();
    if (!thread.userId || !thread.tenantId) {
      return { presented: false, reason: 'visitor' };
    }
    if (!spine.finished) return { presented: false, reason: 'not_finished' };
    const mode = thread.mode ?? GuideMode.NORMAL;
    if (mode === GuideMode.CRISIS) {
      return { presented: false, reason: 'crisis' };
    }
    if (await this.shown(thread.id)) {
      return { presented: false, reason: 'already_shown' };
    }
    const owner = { userId: thread.userId, tenantId: thread.tenantId };
    const [firstMove, possibleSelf, noticings, watchFor] = await Promise.all([
      this.firstMove(owner, thread.trackId),
      this.latestNotebookText(
        owner,
        thread.trackId,
        GuideNotebookKind.POSSIBLE_SELF,
      ),
      this.notebookTexts(owner, thread.trackId, GuideNotebookKind.NOTICING),
      this.lastWatchFor(thread.id),
    ]);
    const tone = finaleTone({ spine, mode });
    const payload = buildFinalePayload({
      hushed: tone === GuideTone.QUIET,
      firstMove,
      possibleSelf,
      noticings,
      watchFor,
      now,
    });
    const title = FINALE_COPY.title(courseTitle).slice(0, 255);
    const saved = await this.cards.save(
      this.cards.create({
        threadId: thread.id,
        kind: GuideCardKind.FINALE,
        presentation: GuideCardPresentation.THEATRE,
        state: GuideCardState.READY,
        tone,
        title,
        payload: payload as unknown as Record<string, any>,
        tenantId: thread.tenantId,
      }),
    );
    const card: GuideCardEvent = {
      cardId: saved.id,
      kind: GuideCardKind.FINALE,
      presentation: GuideCardPresentation.THEATRE,
      state: GuideCardState.READY,
      title,
      framing: null,
      tone,
      cta: { label: 'Open', action: 'open' },
      payload: payload as unknown as Record<string, unknown>,
    };
    const seq = options.emit
      ? await options.emit('card.presented', { card })
      : (await this.bus.appendDurable(thread.id, 'card.presented', { card }))
          .seq;
    await this.cards.update(saved.id, {
      presentedSeq: seq,
      payload: { ...payload, card } as unknown as Record<string, any>,
    });
    return { presented: true, card, payload };
  }

  /** The finale this thread was shown, if any (it can be replayed, plan D3). */
  async payloadFor(threadId: string): Promise<GuideFinalePayload | null> {
    const row = await this.cards.findOne({
      where: { threadId, kind: GuideCardKind.FINALE },
      order: { createdAt: 'DESC' },
    });
    if (!row?.payload) return null;
    // The stored payload also carries the card as presented; leave it out.
    const payload = { ...(row.payload as Record<string, unknown>) };
    delete payload.card;
    return payload as unknown as GuideFinalePayload;
  }

  /** Whether this thread has had its finale. */
  async shown(threadId: string): Promise<boolean> {
    return (
      (await this.cards.count({
        where: { threadId, kind: GuideCardKind.FINALE },
      })) > 0
    );
  }

  /**
   * The learner's first move on this course (kept on sign-in as the
   * notebook's "before"), with the question Ally had just asked, if any.
   */
  private async firstMove(
    owner: { userId: number; tenantId: string },
    trackId: string,
  ): Promise<{ text: string; question: string | null } | null> {
    const rows: Array<{ text: string; question: string | null }> =
      await this.dataSource.query(
        `SELECT n."text",
                (SELECT a."content" FROM "guide_messages" a
                  WHERE a."threadId" = m."threadId" AND a."role" = 'ally'
                    AND a."seq" < m."seq"
                  ORDER BY a."seq" DESC LIMIT 1) AS "question"
           FROM "guide_notebook_entries" n
           LEFT JOIN "guide_messages" m ON m."id" = n."sourceMessageId"
          WHERE n."userId" = $1 AND n."tenant_id" = $2 AND n."trackId" = $3
            AND n."kind" = $4 AND n."deletedAt" IS NULL
          ORDER BY n."createdAt" ASC LIMIT 1`,
        [owner.userId, owner.tenantId, trackId, GuideNotebookKind.FIRST_MOVE],
      );
    return rows[0] ?? null;
  }

  private async notebookTexts(
    owner: { userId: number; tenantId: string },
    trackId: string,
    kind: GuideNotebookKind,
  ): Promise<string[]> {
    const rows: Array<{ text: string }> = await this.dataSource.query(
      `SELECT n."text" FROM "guide_notebook_entries" n
        WHERE n."userId" = $1 AND n."tenant_id" = $2 AND n."trackId" = $3
          AND n."kind" = $4 AND n."deletedAt" IS NULL
        ORDER BY n."createdAt" ASC`,
      [owner.userId, owner.tenantId, trackId, kind],
    );
    return rows.map((row) => row.text);
  }

  private async latestNotebookText(
    owner: { userId: number; tenantId: string },
    trackId: string,
    kind: GuideNotebookKind,
  ): Promise<string | null> {
    const texts = await this.notebookTexts(owner, trackId, kind);
    return texts.length ? texts[texts.length - 1] : null;
  }

  /** "One thing to watch for" from the last closing ritual, if any. */
  private async lastWatchFor(threadId: string): Promise<string | null> {
    const rows: Array<{ watchFor: string | null }> =
      await this.dataSource.query(
        `SELECT c."payload"->>'watchFor' AS "watchFor" FROM "guide_cards" c
          WHERE c."threadId" = $1 AND c."kind" = $2
          ORDER BY c."createdAt" DESC LIMIT 1`,
        [threadId, GuideCardKind.CLOSING_RITUAL],
      );
    return rows[0]?.watchFor?.trim() || null;
  }
}
