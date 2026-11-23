import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ExecutionManager } from '../../common/execution/execution-manager';
import type { CreateKbOwnedDocumentDto } from '../../knowledge-base/dto/knowledge-base.dto';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';
import { LoggerService } from '../../logger/logger.service';
import { ONBOARDING_COPY } from '../copy/onboarding-copy';
import {
  CRAWL_FINISHED,
  SiteCrawlService,
  stagesSources,
  type CrawlFinishedEvent,
} from '../crawl/site-crawl.service';
import { displayDomain, startUrlFrom } from '../crawl/url-scope';
import { BotDraftEventsService } from '../service/bot-draft-events.service';
import { BotDraftSessionService } from '../service/bot-draft-session.service';
import { BotDraftService } from '../service/bot-draft.service';
import type { CrawlProblem } from '../type/bot-draft.type';
import type { WorkingCopyContext } from '../working-copy/working-copy.service';

/** At most this many addresses wait behind a running crawl. */
export const CRAWL_QUEUE_MAX = 5;

/**
 * Each way a crawl can fail, as a plain error code the dashboard explains (stage 3, Copilot). The
 * message is the approved onboarding copy for the same problem.
 */
export const CRAWL_FAILURE_CODES: Record<CrawlProblem, string> = {
  daily_limit: 'crawl_daily_limit',
  unreachable: 'crawl_unreachable',
  script_heavy: 'crawl_needs_javascript',
  turned_away: 'crawl_turned_away',
  blocked: 'crawl_blocked',
  little_found: 'crawl_little_found',
  generic: 'crawl_failed',
};

export function crawlFailure(
  problem: CrawlProblem | null | undefined,
  context: { domain?: string; read?: number } = {},
): { errorCode: string; message: string } | null {
  if (!problem) return null;
  const text =
    ONBOARDING_COPY.problems[problem] ?? ONBOARDING_COPY.problems.generic;
  return {
    errorCode: CRAWL_FAILURE_CODES[problem] ?? CRAWL_FAILURE_CODES.generic,
    message: text
      .replace(/\{domain\}/g, context.domain ?? 'your site')
      .replace(/\{n\}/g, String(context.read ?? 0)),
  };
}

/** What Copilot says while it works, published on the draft's event stream as `narration`. */
// COPY: needs approval
export const NARRATION = {
  reading: (domain: string) => `Reading ${domain}…`,
  queued: (domain: string, running: string) =>
    `I'll read ${domain} as soon as I've finished ${running}.`,
  read: (n: number, domain: string) =>
    `I read ${n} ${n === 1 ? 'page' : 'pages'} from ${domain}.`,
  readStaged: (n: number, domain: string) =>
    `I read ${n} ${n === 1 ? 'page' : 'pages'} from ${domain}. Your test chatbot uses them now; customers get them when you apply your changes.`,
  document: (title: string) => `Reading ${title}…`,
  documentStaged: (title: string) =>
    `Reading ${title}. Customers get it when you apply your changes.`,
};

export interface AddSourcesInput {
  addresses?: string[];
  /** Files already uploaded with POST /v1/chatbots/:id/documents/upload-url. */
  documents?: Pick<
    CreateKbOwnedDocumentDto,
    | 'title'
    | 'sourceType'
    | 'fileUrl'
    | 'fileName'
    | 'contentType'
    | 'sizeBytes'
    | 'text'
  >[];
}

/**
 * Copilot's backend capabilities (stage 3): add a source by chat or form (a web address is
 * crawled with the existing site crawl; a file goes through the existing upload), queue a second
 * address behind a running crawl, and narrate progress. On a chatbot that has gone live every new
 * source waits for Apply (R3): pages and documents are owned by the chatbot but not on it.
 */
@Injectable()
export class CopilotService {
  private readonly logger = LoggerService.getInstance(CopilotService.name);

  constructor(
    private readonly drafts: BotDraftService,
    private readonly crawl: SiteCrawlService,
    private readonly events: BotDraftEventsService,
    private readonly knowledge: KnowledgeBaseService,
    @Optional() private readonly session?: BotDraftSessionService,
  ) {}

  async addSources(ctx: WorkingCopyContext, input: AddSourcesInput) {
    const addresses = (input.addresses ?? [])
      .map((a) => a.trim())
      .filter(Boolean);
    const documents = input.documents ?? [];
    if (!addresses.length && !documents.length) {
      throw new BadRequestException({
        errorCode: 'nothing_to_add',
        message: 'Add a web address or a document.',
      });
    }
    const starts = addresses.map((a) => ({ input: a, start: startUrlFrom(a) }));
    const invalid = starts.find((s) => !s.start);
    if (invalid) {
      throw new BadRequestException({
        errorCode: 'invalid_website',
        message: 'That doesn’t look like a website address.',
        details: { address: invalid.input },
      });
    }
    await this.drafts.touch(ctx.draft.id);
    let draft = ctx.draft;
    const staged = stagesSources(draft) || ctx.live;
    if (staged && !draft.source?.factsStaged) {
      draft = await this.drafts.update(draft, {
        source: { ...draft.source, factsStaged: true },
      });
    }

    const result: {
      started: string | null;
      queued: string[];
      failure: { errorCode: string; message: string } | null;
      documents: { id: string; title: string }[];
      staged: boolean;
    } = { started: null, queued: [], failure: null, documents: [], staged };

    // Addresses: the first starts unless a crawl is running; the rest wait behind it.
    for (const { start } of starts) {
      const fresh = (await this.drafts.findById(draft.id)) ?? draft;
      const running = fresh.crawl?.status === 'running';
      if (running || result.started) {
        const queue = [...(fresh.source?.crawlQueue ?? [])];
        if (queue.length >= CRAWL_QUEUE_MAX) {
          throw new BadRequestException({
            errorCode: 'crawl_queue_full',
            message: `Up to ${CRAWL_QUEUE_MAX} addresses can wait their turn. Try again when one has been read.`,
          });
        }
        if (!queue.includes(start!)) queue.push(start!);
        draft = await this.drafts.update(fresh, {
          source: { ...fresh.source, crawlQueue: queue },
        });
        result.queued.push(start!);
        await this.narrate(
          draft.id,
          'queued',
          NARRATION.queued(
            displayDomain(start!),
            fresh.crawl?.domain ?? 'the site I’m reading',
          ),
        );
        continue;
      }
      const outcome = await this.startCrawl(fresh, start!);
      if (outcome.failure) result.failure = outcome.failure;
      else result.started = start!;
      draft = (await this.drafts.findById(draft.id)) ?? draft;
    }

    // Documents: created as the chatbot's own, then read into what it learned.
    for (const doc of documents) {
      const created = await this.knowledge.createForChatbot(ctx.chatbot.id, {
        ...doc,
        tags: ['onboarding'],
      } as never);
      if (staged) await this.drafts.addPendingDocument(draft.id, created.id);
      else await this.drafts.attachDocument(draft, created.id);
      await this.drafts.addKnowledgeDocument(draft.id, created.id);
      result.documents.push({ id: created.id, title: created.title });
      const title = created.title || 'your document';
      await this.narrate(
        draft.id,
        'document',
        staged ? NARRATION.documentStaged(title) : NARRATION.document(title),
      );
      if (this.session) {
        await this.session.startReading(draft.id, created.id);
        void this.session
          .learnFromDocument(draft.id, created.id)
          .catch((error) =>
            this.logger.warn(
              `Reading document ${created.id} for draft ${draft.id} failed: ${error instanceof Error ? error.message : 'unknown'}`,
            ),
          );
      }
    }
    return result;
  }

  /** The crawl's state as Copilot and the sources list read it. */
  sourcesView(ctx: WorkingCopyContext) {
    const crawl = ctx.draft.crawl;
    return {
      crawl: {
        status: crawl?.status ?? 'idle',
        domain: crawl?.domain ?? null,
        pagesRead: (crawl?.pages ?? []).filter((p) => p.status === 'read')
          .length,
        failure: crawlFailure(crawl?.problem, {
          domain: crawl?.domain,
          read: (crawl?.pages ?? []).filter((p) => p.status === 'read').length,
        }),
      },
      queue: ctx.draft.source?.crawlQueue ?? [],
      pendingDocumentIds: ctx.draft.source?.pendingDocumentIds ?? [],
      live: ctx.live,
    };
  }

  private async startCrawl(
    draft: Awaited<ReturnType<BotDraftService['get']>>,
    start: string,
  ): Promise<{ failure: { errorCode: string; message: string } | null }> {
    const withSite = await this.drafts.update(draft, {
      source: { ...draft.source, website: start },
    });
    await this.narrate(
      draft.id,
      'reading',
      NARRATION.reading(displayDomain(start)),
    );
    const state = await this.crawl.start(withSite);
    return {
      failure:
        state.status === 'failed'
          ? crawlFailure(state.problem, { domain: state.domain })
          : null,
    };
  }

  /** A crawl ended: narrate it, then start the next address waiting behind it. */
  @OnEvent(CRAWL_FINISHED, { async: true })
  async onCrawlFinished(event: CrawlFinishedEvent): Promise<void> {
    try {
      const draft = await this.drafts.findById(event.draftId);
      if (!draft) return;
      const failure = crawlFailure(event.problem, event);
      const domain = event.domain ?? 'your site';
      if (failure) {
        await this.narrate(draft.id, 'failed', failure.message, {
          errorCode: failure.errorCode,
        });
      } else {
        await this.narrate(
          draft.id,
          'read',
          stagesSources(draft)
            ? NARRATION.readStaged(event.read, domain)
            : NARRATION.read(event.read, domain),
        );
      }
      const [next, ...rest] = draft.source?.crawlQueue ?? [];
      if (!next) return;
      const fresh = await this.drafts.update(draft, {
        source: { ...draft.source, crawlQueue: rest },
      });
      // The crawl runs as the owner, as the first one did.
      await ExecutionManager.runWithContext(
        async () => {
          ExecutionManager.setAuthContext(
            String(fresh.ownerUserId),
            fresh.tenantId ?? '',
          );
          await this.startCrawl(fresh, next);
        },
        { path: 'bot-draft-copilot-queue' },
      );
    } catch (error) {
      this.logger.warn(
        `Copilot follow-up for draft ${event.draftId} failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private async narrate(
    draftId: string,
    stage: string,
    text: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.events.publish(draftId, {
      type: 'narration',
      stage,
      text,
      at: new Date().toISOString(),
      ...extra,
    });
  }
}
