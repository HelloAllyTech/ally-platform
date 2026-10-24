import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CourseSpine, SpineItem } from '../conductor/course-spine';
import {
  GuideSceneReceipt,
  GuideSceneView,
} from '../contract/generated/guide-contract';
import { GuideCard } from '../entity/guide-card.entity';
import {
  GuideCardKind,
  GuideCardPresentation,
  GuideCardState,
  GuideNotebookKind,
} from '../enum/guide.enum';
import { GuideEventBusService } from './guide-event-bus.service';

/** Behaviour labels a receipt shows, at most. */
const RECEIPT_MAX_LABELS = 3;
const LABEL_MAX_CHARS = 60;

/** Writes a durable event and returns its seq (a turn's own, or the bus). */
export type SceneEmit = (
  type: 'scene.opened' | 'scene.closed',
  data: Record<string, unknown>,
) => Promise<number>;

/** A scene card's payload: the chapter it is, and how it ended. */
interface ScenePayload {
  sectionId: string;
  sectionIndex: number;
  stakes: string | null;
  closedSeq: number | null;
  receipt: GuideSceneReceipt | null;
}

/** "You stayed with the silence (in the roleplay)" → "You stayed with the silence". */
export function behaviourLabel(noticing: string): string {
  const label = noticing.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return label.length > LABEL_MAX_CHARS
    ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…`
    : label;
}

/**
 * A chapter's receipt (plan §5.5): the behaviours Ally noticed in it as
 * labels, how many side quests the learner did, and the one noticing that
 * closed it — the most recent, in full. Never a score.
 */
export function sceneReceipt(
  noticings: string[],
  sideQuests: number,
): GuideSceneReceipt {
  const labels: string[] = [];
  for (const text of noticings) {
    const label = behaviourLabel(text);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return {
    behaviourLabels: labels.slice(-RECEIPT_MAX_LABELS),
    sideQuests,
    noticing: noticings.length ? noticings[noticings.length - 1] : null,
  };
}

/** A thread's scene cards as bootstrap returns them, oldest first. */
export function sceneViews(
  rows: Array<
    Pick<GuideCard, 'id' | 'kind' | 'title' | 'payload' | 'presentedSeq'>
  >,
): GuideSceneView[] {
  return rows
    .filter(
      (row) =>
        row.kind === GuideCardKind.CHAPTER_TITLE && row.presentedSeq != null,
    )
    .sort((a, b) => a.presentedSeq! - b.presentedSeq!)
    .map((row) => {
      const payload = (row.payload ?? {}) as Partial<ScenePayload>;
      return {
        sceneId: row.id,
        sectionId: payload.sectionId ?? '',
        title: row.title,
        stakes: payload.stakes ?? null,
        openedSeq: row.presentedSeq!,
        closedSeq: payload.closedSeq ?? null,
        ...(payload.receipt ? { receipt: payload.receipt } : {}),
      };
    });
}

/**
 * A chapter's one-line stakes for its title card: the practice it builds
 * to, when it has one. Plain fact from the outline, never invented.
 */
export function sceneStakes(
  spine: CourseSpine,
  sectionId: string,
): string | null {
  const boss = spine.items.find(
    (item) => item.sectionId === sectionId && item.boss,
  );
  return boss ? `It builds to a practice: ${boss.title}.` : null;
}

/**
 * Scenes, not a log (plans/ally-guide/plan.md §5.5). A chapter opens as a
 * title card when its first item is presented (`scene.opened`) and closes
 * with a receipt when classic progression says it is complete — or when the
 * learner moves on to another chapter first (`scene.closed`).
 *
 * Each scene is kept as a `chapter_title` card row, so a reload can group
 * the feed by seq range (bootstrap `scenes`) long after the SSE outbox has
 * been trimmed; the scene id is that card's id. Window comparisons happen
 * in SQL against the card's own `createdAt`, never against a JS Date: the
 * columns are `timestamp` without zone.
 */
@Injectable()
export class GuideSceneService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly bus: GuideEventBusService,
    @InjectRepository(GuideCard)
    private readonly cards: Repository<GuideCard>,
  ) {}

  /** The thread's open scene, if any. */
  async openScene(threadId: string): Promise<GuideCard | null> {
    const rows = await this.cards
      .createQueryBuilder('c')
      .where('c."threadId" = :threadId', { threadId })
      .andWhere('c."kind" = :kind', { kind: GuideCardKind.CHAPTER_TITLE })
      .andWhere(`c."payload"->>'closedSeq' IS NULL`)
      .orderBy('c."createdAt"', 'DESC')
      .limit(1)
      .getMany();
    return rows[0] ?? null;
  }

  /**
   * Open the chapter `item` belongs to, closing the one before if it is
   * still open. Nothing for an item in the chapter already open, or for an
   * item revisited after it was completed.
   */
  async enterChapterOf(input: {
    threadId: string;
    tenantId: string | null;
    spine: CourseSpine;
    item: SpineItem;
    emit?: SceneEmit;
  }): Promise<string | null> {
    if (input.item.state === 'completed') return null;
    const open = await this.openScene(input.threadId);
    const openPayload = open?.payload as ScenePayload | undefined;
    if (open && openPayload?.sectionId === input.item.sectionId) return null;
    if (open) await this.closeCard(open, input.emit);
    const section = input.spine.sections.find(
      (candidate) => candidate.id === input.item.sectionId,
    );
    if (!section) return null;
    const stakes = sceneStakes(input.spine, section.id);
    const payload: ScenePayload = {
      sectionId: section.id,
      sectionIndex: section.index,
      stakes,
      closedSeq: null,
      receipt: null,
    };
    const saved = await this.cards.save(
      this.cards.create({
        threadId: input.threadId,
        kind: GuideCardKind.CHAPTER_TITLE,
        presentation: GuideCardPresentation.INLINE,
        state: GuideCardState.READY,
        title: section.title.slice(0, 255),
        payload: payload as unknown as Record<string, any>,
        tenantId: input.tenantId,
      }),
    );
    const seq = await this.emitter(input.threadId, input.emit)('scene.opened', {
      sceneId: saved.id,
      sectionId: section.id,
      title: section.title,
      stakes,
    });
    await this.cards.update(saved.id, { presentedSeq: seq });
    return saved.id;
  }

  /** Close the open scene for `sectionId` (a completed chapter). */
  async closeChapter(
    threadId: string,
    sectionId: string,
    emit?: SceneEmit,
  ): Promise<GuideSceneReceipt | null> {
    const open = await this.openScene(threadId);
    if (!open || (open.payload as ScenePayload)?.sectionId !== sectionId) {
      return null;
    }
    return this.closeCard(open, emit);
  }

  private async closeCard(
    card: GuideCard,
    emit?: SceneEmit,
  ): Promise<GuideSceneReceipt> {
    const payload = (card.payload ?? {}) as ScenePayload;
    const [noticings, quests] = await Promise.all([
      this.dataSource.query(
        `SELECT n."text" FROM "guide_notebook_entries" n
          WHERE n."threadId" = $1 AND n."kind" = $2 AND n."deletedAt" IS NULL
            AND n."createdAt" >= (SELECT "createdAt" FROM "guide_cards" WHERE "id" = $3)
          ORDER BY n."createdAt" ASC`,
        [card.threadId, GuideNotebookKind.NOTICING, card.id],
      ) as Promise<Array<{ text: string }>>,
      this.dataSource.query(
        `SELECT count(*)::int AS "count" FROM "guide_cards" c
          WHERE c."threadId" = $1 AND c."kind" = $2 AND c."state" = $3
            AND c."createdAt" >= (SELECT "createdAt" FROM "guide_cards" WHERE "id" = $4)`,
        [
          card.threadId,
          GuideCardKind.MICRO_ACTIVITY,
          GuideCardState.DONE,
          card.id,
        ],
      ) as Promise<Array<{ count: number }>>,
    ]);
    const receipt = sceneReceipt(
      noticings.map((row) => row.text),
      Number(quests[0]?.count ?? 0),
    );
    const seq = await this.emitter(card.threadId, emit)('scene.closed', {
      sceneId: card.id,
      sectionId: payload.sectionId,
      receipt,
    });
    await this.cards.update(card.id, {
      state: GuideCardState.DONE,
      payload: {
        ...payload,
        closedSeq: seq,
        receipt,
      } as unknown as Record<string, any>,
    });
    return receipt;
  }

  private emitter(threadId: string, emit?: SceneEmit): SceneEmit {
    return (
      emit ??
      (async (type, data) =>
        (await this.bus.appendDurable(threadId, type, data as never)).seq)
    );
  }
}
