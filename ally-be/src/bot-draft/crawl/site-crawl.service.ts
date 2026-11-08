import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotImageService } from '../../chatbot/bot-image/bot-image.service';
import { BotPageService } from '../../chatbot/bot-page/bot-page.service';
import { ChatbotDocument } from '../../chatbot/entity/chatbot-document.entity';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import {
  GuardedFetchError,
  guardedFetchText,
} from '../../common/net/guarded-fetch';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AppConfigService } from '../../config/config.service';
import { KbDocumentSourceType } from '../../knowledge-base/enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import { BotDraftActor, BotDraftStep } from '../enum/bot-draft.enum';
import { BotDraftEventsService } from '../service/bot-draft-events.service';
import { BotDraftService } from '../service/bot-draft.service';
import type {
  CrawlPage,
  CrawlProblem,
  CrawlState,
} from '../type/bot-draft.type';
import { detectBrand } from './brand';
import { parsePage } from './page-parser';
import { CRAWLER_USER_AGENT, parseRobots, Robots } from './robots';
import { parseSitemap } from './sitemap';
import {
  displayDomain,
  isArticle,
  isJunk,
  MAX_ARTICLES,
  normaliseUrl,
  sameSite,
  startUrlFrom,
} from './url-scope';

/** The brief's limits: 50 pages, 2 minutes, 4 at a time. */
export const CRAWL_LIMITS = {
  maxPages: 50,
  maxMs: 120_000,
  concurrency: 4,
  pageTimeoutMs: 10_000,
  pageMaxBytes: 2 * 1024 * 1024,
  cssMaxBytes: 512 * 1024,
  // A page shorter than this is skipped. Low on purpose: a contact page is often only an
  // address, a phone number and hours, and it's among the most useful pages there are.
  minPageChars: 60,
  /** Pages read before their summaries are sent to the builder, so findings appear while reading. */
  learnBatch: 8,
  /** A crawl left "running" this long (an instance restarted) is picked up by the sweep. */
  stalledSeconds: 60,
  queueCap: 400,
};

/** Hands each batch of pages to the builder to learn from (BotDraftLearningService). */
/** A page read, with its text for fact extraction. The text is never saved with the crawl. */
export type LearnablePage = CrawlPage & { text: string };

export interface CrawlLearner {
  learnFrom(draftId: string, pages: LearnablePage[]): Promise<void>;
  /** The crawl ended (read, partly read or failed): the builder says so in the chat. */
  crawlFinished?(
    draftId: string,
    outcome: { read: number; domain?: string; problem?: CrawlProblem },
  ): Promise<void>;
}
export const CRAWL_LEARNER = 'BOT_DRAFT_CRAWL_LEARNER';

/**
 * Reads the owner's website into the draft (chunk 20a).
 *
 * In-process and resumable (Shehbaz, 2026-11-07): it runs in the background of the request that
 * started it, holds a Redis lock per draft, and saves its queue after every page, so if this
 * instance restarts the 5-minute sweep picks it up where it left off. Same site only, robots.txt
 * respected, at most 50 pages in 2 minutes, 4 at a time, through the shared address guard. Each
 * page becomes a library document attached to the draft's chatbot (as pasted text, so ingestion
 * never fetches it again unguarded). Logs carry domains and counts only.
 */
@Injectable()
export class SiteCrawlService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(SiteCrawlService.name);

  constructor(
    private readonly drafts: BotDraftService,
    private readonly events: BotDraftEventsService,
    private readonly knowledge: KnowledgeBaseService,
    @InjectRepository(ChatbotDocument)
    private readonly chatbotDocuments: Repository<ChatbotDocument>,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    @Optional() @Inject(CRAWL_LEARNER) private readonly learner?: CrawlLearner,
    // Chunk 20d (the site's logo onto the page). Optional and last so earlier specs construct the
    // service unchanged; Nest always provides them.
    @Optional()
    @InjectRepository(Chatbot)
    private readonly chatbots?: Repository<Chatbot>,
    @Optional() private readonly images?: BotImageService,
    @Optional() private readonly pages?: BotPageService,
  ) {}

  /**
   * The site's logo and colour onto the bot's page (chunk 20d): the logo is downloaded through the
   * same guarded fetcher and stored like an upload. Best effort: a logo that can't be used leaves
   * initials, and nothing here stops the crawl.
   */
  private async storeBrand(
    draft: BotDraftEntity,
    brand: { logoUrl: string | null; accentColour: string | null },
    allowHosts: string[] | undefined,
  ): Promise<void> {
    if (!this.chatbots || !this.images || !this.pages) return;
    if (!draft.chatbotId || (!brand.logoUrl && !brand.accentColour)) return;
    try {
      const chatbot = await this.chatbots.findOne({
        where: { id: draft.chatbotId },
      });
      if (!chatbot) return;
      const logo = brand.logoUrl
        ? await this.images.importFromUrl(chatbot.id, brand.logoUrl, {
            allowHosts,
            alt: `${chatbot.name} logo`,
            tenantId: draft.tenantId ?? null,
          })
        : null;
      if (!logo && !brand.accentColour) return;
      await this.pages.saveBrand(chatbot, {
        ...(logo ? { logo: logo.id } : {}),
        ...(brand.accentColour ? { accent: brand.accentColour } : {}),
      });
    } catch (error) {
      this.logger.warn(
        `Brand not stored for draft ${draft.id}: ${(error as Error).message}`,
      );
    }
  }

  onModuleInit(): void {
    scheduledTaskRegistry.register('5min', 'bot-draft-crawl-resume', () =>
      this.resumeStalled(),
    );
  }

  /**
   * Start reading. Returns at once with the crawl's first state; the reading carries on in the
   * background and reports through draft events. A start URL that isn't one, or the daily cap,
   * ends it straight away with the problem (copy §13).
   */
  async start(draft: BotDraftEntity): Promise<CrawlState> {
    const website = draft.source.website ?? '';
    const startUrl = startUrlFrom(website);
    if (!startUrl) return this.fail(draft, 'unreachable', website);

    const day = new Date().toISOString().slice(0, 10);
    try {
      const { count } = await this.redis.incrWithExpiry(
        `bd:crawl-cap:${draft.ownerUserId}:${day}`,
        90_000,
      );
      if (count > this.config.botDraft.crawlsPerDay) {
        return this.fail(draft, 'daily_limit', startUrl);
      }
    } catch {
      // Fail open, as the other caps do: a Redis outage shouldn't stop onboarding.
    }

    const crawl: CrawlState = {
      status: 'running',
      website: startUrl,
      domain: displayDomain(startUrl),
      startedAt: new Date().toISOString(),
      queue: [startUrl],
      seen: [],
      pages: [],
      findings: [],
    };
    await this.drafts.saveCrawl(draft.id, crawl);
    await this.events.publish(draft.id, {
      type: 'reading',
      domain: crawl.domain,
    });
    this.runInBackground(draft);
    return crawl;
  }

  /** The sweep: finish crawls an instance left behind. */
  async resumeStalled(): Promise<void> {
    const stalled = await this.drafts.findStalledCrawls(
      CRAWL_LIMITS.stalledSeconds,
    );
    for (const draft of stalled) this.runInBackground(draft);
  }

  private runInBackground(draft: BotDraftEntity): void {
    // The owner's identity, so library documents are theirs even when the sweep resumes the crawl.
    setImmediate(() =>
      ExecutionManager.runWithContext(
        () => {
          ExecutionManager.setAuthContext(
            String(draft.ownerUserId),
            draft.tenantId ?? '',
          );
          void this.run(draft.id).catch((error) =>
            this.logger.error(
              `Crawl failed for draft ${draft.id}: ${error instanceof Error ? error.message : 'unknown'}`,
            ),
          );
        },
        { path: 'bot-draft-crawl' },
      ),
    );
  }

  /** The crawl itself. Safe to call again: it resumes from the saved queue. */
  async run(draftId: string): Promise<void> {
    const lockKey = `bd:crawl:${draftId}`;
    if (!(await this.redis.acquireLock(lockKey, 180).catch(() => true))) return;
    try {
      const draft = await this.drafts.findById(draftId);
      if (!draft || draft.crawl.status !== 'running' || !draft.crawl.website)
        return;
      await this.crawl(draft);
    } finally {
      await this.redis.releaseLock(lockKey).catch(() => undefined);
    }
  }

  private async crawl(draft: BotDraftEntity): Promise<void> {
    const crawl = draft.crawl;
    const startUrl = crawl.website!;
    const started = Date.parse(crawl.startedAt ?? new Date().toISOString());
    const deadline = started + CRAWL_LIMITS.maxMs;
    const allowHosts = this.config.botDraft.crawlAllowHosts;
    const fetchOptions = {
      timeoutMs: CRAWL_LIMITS.pageTimeoutMs,
      maxBytes: CRAWL_LIMITS.pageMaxBytes,
      userAgent: `Mozilla/5.0 (compatible; ${CRAWLER_USER_AGENT}/1.0)`,
      allowHosts,
    };

    // robots.txt first; a site that asks us not to read its start page is not read at all.
    const robots = await this.robots(startUrl, fetchOptions);
    if (!robots.allows(pathOf(startUrl))) {
      return this.finish(draft.id, crawl, 'failed', 'blocked');
    }
    if (!crawl.seen.length) {
      for (const url of await this.sitemapUrls(
        startUrl,
        robots,
        fetchOptions,
      )) {
        if (crawl.queue.length >= CRAWL_LIMITS.queueCap) break;
        if (!crawl.queue.includes(url)) crawl.queue.push(url);
      }
    }

    let pending: LearnablePage[] = [];
    const learning: Promise<void>[] = [];
    const flushLearning = () => {
      if (!pending.length || !this.learner) return;
      const batch = pending;
      pending = [];
      learning.push(
        this.learner
          .learnFrom(draft.id, batch)
          .catch((error) =>
            this.logger.warn(
              `Learning from ${batch.length} pages failed for draft ${draft.id}: ${error instanceof Error ? error.message : 'unknown'}`,
            ),
          ),
      );
    };

    const readCount = () =>
      crawl.pages.filter((p) => p.status === 'read').length;
    // The business's own pages first; blog and news pages only once those run out, and at most
    // MAX_ARTICLES of them (counted from what was taken, so it holds across a resume).
    const take = (): string | undefined => {
      crawl.queue = crawl.queue.filter((url) => !crawl.seen.includes(url));
      const core = crawl.queue.findIndex((url) => !isArticle(url));
      if (core >= 0) return crawl.queue.splice(core, 1)[0];
      const articles = crawl.seen.filter((url) => isArticle(url)).length;
      if (articles >= MAX_ARTICLES) {
        crawl.queue = [];
        return undefined;
      }
      return crawl.queue.shift();
    };

    let startFailed: GuardedFetchError | null = null;
    /** Read one URL from the queue; false when there's nothing left to do. */
    // Pages being read right now count against the cap, so 4 workers can't overshoot 50.
    let reading = 0;
    const step = async (): Promise<boolean> => {
      if (
        Date.now() > deadline ||
        readCount() + reading >= CRAWL_LIMITS.maxPages
      )
        return false;
      const url = take();
      if (!url) return false;
      crawl.seen.push(url);
      reading += 1;
      const page = await this.readPage(
        url,
        startUrl,
        robots,
        fetchOptions,
        crawl,
        draft,
      )
        .catch((error: unknown) => {
          if (url === startUrl && error instanceof GuardedFetchError)
            startFailed = error;
          return { url, title: null, status: 'failed' as const };
        })
        .finally(() => {
          reading -= 1;
        });
      const { text, ...stored } = page as CrawlPage & { text?: string };
      crawl.pages.push(stored);
      if (stored.status === 'read') {
        pending.push({ ...stored, text: text ?? '' });
        await this.events.publish(draft.id, {
          type: 'page',
          n: readCount(),
          url: page.url,
          title: page.title,
        });
        if (pending.length >= CRAWL_LIMITS.learnBatch) flushLearning();
      }
      await this.drafts.saveCrawl(draft.id, crawl);
      return true;
    };
    const worker = async () => {
      while (await step()) {
        /* keep reading */
      }
    };

    // The start page alone first (unless resuming): it decides reachability and the brand. A
    // short home page (a banner and links) is still followed: only a page we couldn't reach, or
    // one that kept nothing and links nowhere, ends the crawl here.
    if (!crawl.pages.length) {
      await step();
      const kept = crawl.pages.some((p) => p.status === 'read');
      if (startFailed || (!kept && !crawl.queue.length)) {
        return this.finish(
          draft.id,
          crawl,
          'failed',
          startFailed ? 'unreachable' : 'little_found',
        );
      }
    }
    await Promise.all(
      Array.from({ length: CRAWL_LIMITS.concurrency }, () => worker()),
    );
    flushLearning();
    await Promise.all(learning);

    const read = crawl.pages.filter((p) => p.status === 'read');
    const chars = read.reduce((sum, p) => sum + (p.snippet?.length ?? 0), 0);
    const problem: CrawlProblem | undefined =
      read.length <= 2 && crawl.findings.includes('script_heavy')
        ? 'script_heavy'
        : chars < 600
          ? 'little_found'
          : undefined;
    return this.finish(
      draft.id,
      crawl,
      !read.length
        ? 'failed'
        : Date.now() > deadline && crawl.queue.length
          ? 'partial'
          : 'done',
      problem,
    );
  }

  /** Fetch, parse and store one page; queue its links. */
  private async readPage(
    url: string,
    startUrl: string,
    robots: Robots,
    fetchOptions: Parameters<typeof guardedFetchText>[1],
    crawl: CrawlState,
    draft: BotDraftEntity,
  ): Promise<CrawlPage> {
    const fetched = await guardedFetchText(url, {
      ...fetchOptions,
      contentTypes: ['text/html', 'application/xhtml+xml'],
    });
    // A redirect off the site ends here; the owner gave us their site, nothing else.
    if (!sameSite(fetched.url, startUrl))
      return { url, title: null, status: 'skipped' };
    const parsed = parsePage(fetched.body);

    const canonical = parsed.canonical
      ? normaliseUrl(parsed.canonical, fetched.url)
      : null;
    const pageUrl =
      canonical && sameSite(canonical, startUrl)
        ? canonical
        : (normaliseUrl(fetched.url) ?? url);
    if (pageUrl !== url) {
      if (
        crawl.seen.includes(pageUrl) ||
        crawl.pages.some((p) => p.url === pageUrl)
      ) {
        return { url, title: parsed.title, status: 'skipped' };
      }
      crawl.seen.push(pageUrl);
    }

    for (const href of parsed.links) {
      const link = normaliseUrl(href, fetched.url);
      if (
        link &&
        sameSite(link, startUrl) &&
        !isJunk(link) &&
        robots.allows(pathOf(link)) &&
        !crawl.seen.includes(link) &&
        !crawl.queue.includes(link) &&
        crawl.queue.length < CRAWL_LIMITS.queueCap
      ) {
        crawl.queue.push(link);
      }
    }

    if (url === startUrl) {
      if (parsed.text.length < 300 && parsed.scriptCount >= 5)
        crawl.findings.push('script_heavy');
      const css = await this.stylesheets(
        parsed.stylesheets,
        fetched.url,
        startUrl,
        fetchOptions,
      );
      crawl.brand = detectBrand(parsed, fetched.url, css);
      await this.storeBrand(draft, crawl.brand, fetchOptions.allowHosts);
      await this.drafts.applyBrand(draft.id, crawl.brand);
      await this.events.publish(draft.id, { type: 'brand', ...crawl.brand });
      if (crawl.brand.logoUrl || crawl.brand.accentColour) {
        crawl.findings.push('brand');
        await this.events.publish(draft.id, { type: 'finding', kind: 'brand' });
      }
    }

    if (parsed.text.length < CRAWL_LIMITS.minPageChars) {
      return { url: pageUrl, title: parsed.title, status: 'skipped' };
    }
    const title = (parsed.title ?? displayDomain(pageUrl)).slice(0, 300);
    const document = await this.knowledge.createForChatbot(draft.chatbotId!, {
      sourceType: KbDocumentSourceType.PASTE,
      title,
      text: parsed.text.slice(0, 200_000),
      sourceUrl: pageUrl,
      tags: ['onboarding'],
    });
    await this.chatbotDocuments
      .createQueryBuilder()
      .insert()
      .into(ChatbotDocument)
      .values({
        chatbotId: draft.chatbotId!,
        documentId: document.id,
        createdBy: draft.ownerUserId,
      })
      .orIgnore()
      .execute();
    await this.drafts.addKnowledgeDocument(draft.id, document.id);
    return {
      url: pageUrl,
      title,
      status: 'read',
      documentId: document.id,
      headings: parsed.headings.slice(0, 20),
      snippet: parsed.text.slice(0, 600),
      text: parsed.text.slice(0, 12_000),
    } as CrawlPage;
  }

  private async robots(
    startUrl: string,
    fetchOptions: Parameters<typeof guardedFetchText>[1],
  ): Promise<Robots> {
    try {
      const fetched = await guardedFetchText(
        new URL('/robots.txt', startUrl).toString(),
        {
          ...fetchOptions,
          maxBytes: 256 * 1024,
          contentTypes: ['text/'],
        },
      );
      return parseRobots(fetched.body);
    } catch {
      // No robots.txt (or none readable) means nothing is disallowed.
      return parseRobots('');
    }
  }

  private async sitemapUrls(
    startUrl: string,
    robots: Robots,
    fetchOptions: Parameters<typeof guardedFetchText>[1],
  ): Promise<string[]> {
    const listed = robots.sitemaps.length
      ? robots.sitemaps
      : [new URL('/sitemap.xml', startUrl).toString()];
    const urls: string[] = [];
    const read = async (sitemapUrl: string, depth: number) => {
      if (!sameSite(sitemapUrl, startUrl)) return;
      try {
        const fetched = await guardedFetchText(sitemapUrl, {
          ...fetchOptions,
          maxBytes: 1024 * 1024,
          contentTypes: [
            'application/xml',
            'text/xml',
            'text/plain',
            'application/x-xml',
          ],
        });
        const parsed = parseSitemap(fetched.body);
        for (const page of parsed.pages) {
          const url = normaliseUrl(page);
          if (
            url &&
            sameSite(url, startUrl) &&
            !isJunk(url) &&
            robots.allows(pathOf(url))
          ) {
            urls.push(url);
          }
        }
        if (depth === 0) {
          for (const child of parsed.sitemaps.slice(0, 5)) await read(child, 1);
        }
      } catch {
        // A missing or broken sitemap just means we follow links instead.
      }
    };
    for (const sitemap of listed.slice(0, 3)) await read(sitemap, 0);
    return [...new Set(urls)].slice(0, CRAWL_LIMITS.queueCap);
  }

  private async stylesheets(
    hrefs: string[],
    pageUrl: string,
    startUrl: string,
    fetchOptions: Parameters<typeof guardedFetchText>[1],
  ): Promise<string[]> {
    const out: string[] = [];
    for (const href of hrefs.slice(0, 2)) {
      const url = normaliseUrl(href, pageUrl);
      if (!url || !sameSite(url, startUrl)) continue;
      try {
        const fetched = await guardedFetchText(url, {
          ...fetchOptions,
          maxBytes: CRAWL_LIMITS.cssMaxBytes,
          contentTypes: ['text/css', 'text/plain'],
        });
        out.push(fetched.body);
      } catch {
        // The colour is a nicety; theme-color or inline CSS may still give one.
      }
    }
    return out;
  }

  private async finish(
    draftId: string,
    crawl: CrawlState,
    status: CrawlState['status'],
    problem?: CrawlProblem,
  ): Promise<void> {
    crawl.status = status;
    crawl.finishedAt = new Date().toISOString();
    if (problem) crawl.problem = problem;
    crawl.queue = [];
    await this.drafts.saveCrawl(draftId, crawl);
    const read = crawl.pages.filter((p) => p.status === 'read').length;
    const seconds = Math.max(
      1,
      Math.round(
        (Date.parse(crawl.finishedAt) -
          Date.parse(crawl.startedAt ?? crawl.finishedAt)) /
          1000,
      ),
    );
    this.logger.info(
      `Crawl of ${crawl.domain} for draft ${draftId}: ${status}, ${read} pages in ${seconds}s${problem ? ` (${problem})` : ''}`,
    );
    await this.events.publish(draftId, {
      type: 'done',
      n: read,
      seconds,
      status,
      problem: problem ?? null,
    });
    await this.moveOn(draftId, { read, domain: crawl.domain, problem });
  }

  /** Leave "reading" for "what we learned", and let the builder say how it went. */
  private async moveOn(
    draftId: string,
    outcome: { read: number; domain?: string; problem?: CrawlProblem },
  ): Promise<void> {
    const draft = await this.drafts.findById(draftId);
    if (draft && draft.step === BotDraftStep.READING) {
      await this.drafts.setStep(
        draft,
        BotDraftStep.LEARNED,
        BotDraftActor.SYSTEM,
      );
    }
    await this.learner
      ?.crawlFinished?.(draftId, outcome)
      .catch((error) =>
        this.logger.warn(
          `Could not post the crawl's outcome for draft ${draftId}: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
  }

  private async fail(
    draft: BotDraftEntity,
    problem: CrawlProblem,
    website: string,
  ): Promise<CrawlState> {
    const crawl: CrawlState = {
      status: 'failed',
      website,
      domain: website ? safeDomain(website) : undefined,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      queue: [],
      seen: [],
      pages: [],
      findings: [],
      problem,
    };
    await this.drafts.saveCrawl(draft.id, crawl);
    await this.events.publish(draft.id, {
      type: 'done',
      n: 0,
      seconds: 0,
      status: 'failed',
      problem,
    });
    await this.moveOn(draft.id, { read: 0, domain: crawl.domain, problem });
    return crawl;
  }
}

function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function safeDomain(input: string): string {
  try {
    return displayDomain(startUrlFrom(input) ?? input);
  } catch {
    return input.slice(0, 80);
  }
}
