import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { CheckupService } from '../checkup/checkup.service';
import { SiteCrawlService } from '../crawl/site-crawl.service';
import {
  PAGE_CHOICE_LIMITS,
  PageChoice,
  chosen,
  normalisePattern,
  sectionOf,
} from '../crawl/url-scope';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import { BotDraftActor } from '../enum/bot-draft.enum';
import { BotDraftService } from '../service/bot-draft.service';
import type {
  CrawlPage,
  DraftEvent,
  LearnedFact,
} from '../type/bot-draft.type';

/** One page the assistant read, as What it knows → Sources lists it. */
export interface SourceView {
  url: string;
  title: string | null;
  /** Details that came from this page (and from it alone: each detail has one source). */
  details: number;
  removed: boolean;
  /** The removal to undo, while it's removed. */
  eventId: string | null;
}

/** What a removal or a choice took away, kept on its event so Undo puts it back exactly. */
interface Taken {
  url: string;
  documentId: string | null;
  facts: LearnedFact[];
}

/**
 * Which pages an assistant learns from (chunk 20a-2): "Choose pages" while it's set up, and What
 * it knows → Sources afterwards. Taking a page away detaches its document from the assistant (so
 * it can't answer from it any more) and removes the details that came only from it; the page is
 * never read again until it's put back. Each removal is one event that Undo reverses exactly. The
 * library document itself is kept, so nothing is lost.
 */
@Injectable()
export class SourcesService {
  constructor(
    private readonly drafts: BotDraftService,
    private readonly crawl: SiteCrawlService,
    private readonly access: ChatbotAccessService,
    private readonly checkup: CheckupService,
    private readonly dataSource: DataSource,
  ) {}

  // ── Choose pages (onboarding) ─────────────────────────────────────────

  /** The site's pages found so far, grouped by section, and the choice saved. */
  async found(draftId: string) {
    const draft = await this.drafts.get(draftId);
    if (draft.chatbotId) {
      await this.access.assert(draft.chatbotId, ChatbotMemberRole.EDITOR);
    }
    const pages = await this.crawl.discover(draft);
    const groups = new Map<
      string,
      { url: string; path: string; title: string | null; read: boolean }[]
    >();
    for (const page of pages) {
      const section = sectionOf(page.url);
      const list = groups.get(section) ?? [];
      list.push({ ...page, path: new URL(page.url).pathname });
      groups.set(section, list);
    }
    return {
      choice: choiceOf(draft),
      groups: [...groups.entries()]
        .map(([section, list]) => ({
          section,
          pages: list.sort((a, b) => a.path.localeCompare(b.path)),
        }))
        .sort((a, b) =>
          !a.section ? -1 : !b.section ? 1 : a.section.localeCompare(b.section),
        ),
    };
  }

  /**
   * Save the owner's choice. Pages already read that it leaves out are taken away (with what
   * came only from them), as one event Undo reverses.
   */
  async choose(draftId: string, raw: PageChoice) {
    const draft = await this.drafts.get(draftId);
    if (draft.chatbotId) {
      await this.access.assert(draft.chatbotId, ChatbotMemberRole.EDITOR);
    }
    const choice = cleanChoice(raw);
    const out = draft.crawl.pages
      .filter((p) => p.status === 'read' && !chosen(p.url, choice))
      .filter((p) => !(draft.source.removed ?? []).includes(p.url));
    const { event, next } = await this.take(draft, out, choice);
    return {
      choice,
      removed: out.length,
      eventId: event?.id ?? null,
      draft: next.id,
    };
  }

  // ── Sources (assistant home) ──────────────────────────────────────────

  async list(chatbotId: string): Promise<SourceView[]> {
    await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
    const draft = await this.drafts.findByChatbot(chatbotId);
    if (!draft) return [];
    const removed = new Set(draft.source.removed ?? []);
    const facts = draft.learned.facts;
    const open = openRemovals(draft);
    return draft.crawl.pages
      .filter((p) => p.status === 'read')
      .map((page) => ({
        url: page.url,
        title: page.title,
        details: removed.has(page.url)
          ? (open.get(page.url)?.facts.length ?? 0)
          : facts.filter((f) => f.sourceUrl === page.url).length,
        removed: removed.has(page.url),
        eventId: open.get(page.url)?.eventId ?? null,
      }));
  }

  /** "Remove {page}? Your assistant will forget {n} details…": the count, nothing removed. */
  async preview(chatbotId: string, url: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const draft = await this.draftFor(chatbotId);
    const page = readPage(draft, url);
    return {
      url,
      title: page.title,
      details: draft.learned.facts.filter((f) => f.sourceUrl === url).length,
    };
  }

  async remove(chatbotId: string, url: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const draft = await this.draftFor(chatbotId);
    const page = readPage(draft, url);
    if ((draft.source.removed ?? []).includes(url)) {
      throw new BadRequestException('That page is already removed.');
    }
    const { event } = await this.take(draft, [page]);
    return { eventId: event!.id };
  }

  /** Undo a removal (or a choice that removed pages): everything it took comes back. */
  async restore(chatbotId: string, eventId: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const draft = await this.draftFor(chatbotId);
    return this.undoTaking(draft, eventId);
  }

  async restoreForDraft(draftId: string, eventId: string) {
    const draft = await this.drafts.get(draftId);
    if (draft.chatbotId) {
      await this.access.assert(draft.chatbotId, ChatbotMemberRole.EDITOR);
    }
    return this.undoTaking(draft, eventId);
  }

  // ── plumbing ──────────────────────────────────────────────────────────

  private async take(
    draft: BotDraftEntity,
    pages: CrawlPage[],
    choice?: PageChoice,
  ): Promise<{ event: DraftEvent | null; next: BotDraftEntity }> {
    const urls = new Set(pages.map((p) => p.url));
    const taken: Taken[] = pages.map((page) => ({
      url: page.url,
      documentId: page.documentId ?? null,
      facts: draft.learned.facts.filter((f) => f.sourceUrl === page.url),
    }));
    const event: DraftEvent | null = pages.length
      ? {
          id: randomUUID(),
          at: new Date().toISOString(),
          actor: BotDraftActor.OWNER,
          kind: 'pages',
          summary: pages.map((p) => p.title ?? p.url).join(', '),
          ops: [{ op: 'remove', path: '/sources', value: taken }],
        }
      : null;
    const next = await this.drafts.update(
      draft,
      {
        source: {
          ...draft.source,
          ...(choice ? { pages: choice } : {}),
          removed: [...new Set([...(draft.source.removed ?? []), ...urls])],
        },
        learned: {
          ...draft.learned,
          facts: draft.learned.facts.filter((f) => !urls.has(f.sourceUrl)),
        },
      },
      event ? [event] : [],
    );
    const documentIds = taken.map((t) => t.documentId).filter(Boolean);
    if (draft.chatbotId && documentIds.length) {
      await this.dataSource.query(
        `DELETE FROM chatbot_documents WHERE chatbot_id = $1 AND document_id = ANY($2::uuid[])`,
        [draft.chatbotId, documentIds],
      );
      this.checkup.scheduleAfterChange(draft.chatbotId);
    }
    return { event, next };
  }

  private async undoTaking(draft: BotDraftEntity, eventId: string) {
    const event = draft.events.find(
      (e) => e.id === eventId && e.kind === 'pages' && !e.undoneBy,
    );
    if (!event) throw new NotFoundException('Nothing to undo.');
    const taken = (event.ops?.[0]?.value ?? []) as Taken[];
    const urls = new Set(taken.map((t) => t.url));
    const known = new Set(draft.learned.facts.map((f) => f.id));
    const undo: DraftEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: BotDraftActor.OWNER,
      kind: 'undo',
      summary: `Put back ${event.summary}`,
    };
    await this.drafts.update(
      draft,
      {
        source: {
          ...draft.source,
          removed: (draft.source.removed ?? []).filter((u) => !urls.has(u)),
        },
        learned: {
          ...draft.learned,
          facts: [
            ...draft.learned.facts,
            ...taken.flatMap((t) => t.facts).filter((f) => !known.has(f.id)),
          ],
        },
        events: draft.events.map((e) =>
          e.id === event.id ? { ...e, undoneBy: undo.id } : e,
        ),
      },
      [undo],
    );
    if (draft.chatbotId) {
      for (const { documentId } of taken) {
        if (!documentId) continue;
        await this.dataSource.query(
          `INSERT INTO chatbot_documents (chatbot_id, document_id, created_by)
           SELECT $1, $2, NULL
            WHERE NOT EXISTS (
              SELECT 1 FROM chatbot_documents WHERE chatbot_id = $1 AND document_id = $2
            )`,
          [draft.chatbotId, documentId],
        );
      }
      this.checkup.scheduleAfterChange(draft.chatbotId);
    }
    return { restored: taken.length };
  }

  private async draftFor(chatbotId: string): Promise<BotDraftEntity> {
    const draft = await this.drafts.findByChatbot(chatbotId);
    if (!draft) throw new NotFoundException('This assistant has no pages.');
    return draft;
  }
}

function choiceOf(draft: BotDraftEntity): PageChoice {
  return {
    include: draft.source.pages?.include ?? [],
    exclude: draft.source.pages?.exclude ?? [],
  };
}

export function cleanChoice(raw: PageChoice): PageChoice {
  const clean = (list: string[] | undefined) => {
    if ((list ?? []).length > PAGE_CHOICE_LIMITS.patterns) {
      throw new BadRequestException(
        `Choose at most ${PAGE_CHOICE_LIMITS.patterns} pages or sections.`,
      );
    }
    return [
      ...new Set(
        (list ?? []).map(normalisePattern).filter((p): p is string => !!p),
      ),
    ];
  };
  return { include: clean(raw.include), exclude: clean(raw.exclude) };
}

function readPage(draft: BotDraftEntity, url: string): CrawlPage {
  const page = draft.crawl.pages.find(
    (p) => p.url === url && p.status === 'read',
  );
  if (!page) throw new NotFoundException('That page isn’t one it read.');
  return page;
}

/** For each removed page, the removal still open (not undone) and what it took. */
function openRemovals(
  draft: BotDraftEntity,
): Map<string, { eventId: string; facts: LearnedFact[] }> {
  const out = new Map<string, { eventId: string; facts: LearnedFact[] }>();
  for (const event of draft.events) {
    if (event.kind !== 'pages' || event.undoneBy) continue;
    for (const taken of (event.ops?.[0]?.value ?? []) as Taken[]) {
      out.set(taken.url, { eventId: event.id, facts: taken.facts });
    }
  }
  return out;
}
