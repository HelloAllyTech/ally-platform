import { createHash } from 'crypto';
import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { isUUID } from 'class-validator';
import { LoggerService } from '../../logger/logger.service';
import { ClChunk } from '../../context-library/entity/cl-chunk.entity';
import {
  ClChunkStatus,
  ClCollectionId,
  ClUseCase,
} from '../../context-library/enum/context-library.enum';
import { ContextRetrievalService } from '../../context-library/service/context-retrieval.service';
import { SKILL_FRAMEWORK_KIND } from '../constants/debrief-framework.constants';
import { guidancePassage } from '../util/debrief-guidance.util';

/** `guidance_fetch` returns at most this many entries per call; extra codes are ignored. */
export const MAX_FETCH_CODES = 5;
const TITLE_MAX = 120;
const HINT_MAX = 160;
/** Tenants kept in the index cache; the oldest goes first. */
const CACHE_MAX_TENANTS = 200;

export interface GuidanceIndexEntry {
  code: string;
  kind: string | null;
  level: string[];
  title: string;
  hint: string;
}

export interface GuidancePassageOut {
  id: string;
  code: string;
  title: string;
  text: string;
  citation: string;
  band: 'direct';
}

const clip = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

const asList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v])
    .map((x) => String(x).trim())
    .filter(Boolean);

/** The first sentence of a text, whitespace collapsed. */
function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = t.match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : t;
}

/**
 * Debrief Guidance as the guidance agent browses it (CONTRACT.md §2): an index of every entry a
 * learner's organisation may read (code, kind, level, title, hint), and entries fetched by code.
 * The audience rule is the library's own and the one `DebriefFrameworkService` uses: global, or
 * the tenant listed in `tenantIds`; an unreadable or non-UUID tenant reads global entries only.
 * Skill frameworks are never guidance. Neither call ever throws.
 *
 * The index is cached per tenant. Every call runs one cheap query (`count`, `max(updatedAt)` of
 * the collection's active chunks); the cache is used only while that signature is unchanged, so an
 * edit, delete or addition in the Context Library shows up on the next call, with no deploy.
 */
@Injectable()
export class DebriefGuidanceIndexService {
  private readonly logger = LoggerService.getInstance(
    DebriefGuidanceIndexService.name,
  );
  private readonly cache = new Map<
    string,
    { signature: string; entries: GuidanceIndexEntry[] }
  >();

  constructor(
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
    /** Records that a fetched entry was read (usage events); the fetch works without it. */
    @Optional() private readonly retrieval?: ContextRetrievalService,
  ) {}

  /** A tenant that is a UUID, or nobody. */
  private tenantKey(tenantId?: string | null): string | null {
    return tenantId && isUUID(tenantId) ? tenantId : null;
  }

  private visible(c: ClChunk, tenant: string | null): boolean {
    if (c.facets?.kind === SKILL_FRAMEWORK_KIND) return false;
    return (
      c.isGlobal === true || (!!tenant && (c.tenantIds ?? []).includes(tenant))
    );
  }

  /** `count|max(updatedAt)` over the active chunks of the collection, hashed. */
  private async signature(): Promise<string> {
    const rows: Array<{ n: string | number; m: Date | string | null }> =
      await this.chunks.query(
        `SELECT count(*) AS n, max("updatedAt") AS m
           FROM cl_chunks WHERE collection_id = $1 AND status = $2`,
        [ClCollectionId.DEBRIEF_GUIDANCE, ClChunkStatus.ACTIVE],
      );
    const r = rows?.[0] ?? { n: 0, m: null };
    const m = r.m ? new Date(r.m).toISOString() : '';
    return createHash('sha1')
      .update(`${Number(r.n)}|${m}`)
      .digest('hex')
      .slice(0, 12);
  }

  private entry(c: ClChunk): GuidanceIndexEntry {
    const { title } = guidancePassage(c);
    const situations = (c.situations ?? [])
      .map((s) => s.trim())
      .filter(Boolean);
    const hint = situations.length
      ? situations.join('; ')
      : firstSentence((c.body ?? '').trim() || c.statement || '');
    return {
      code: c.code,
      kind: asList(c.facets?.kind)[0] ?? null,
      level: asList(c.facets?.level),
      title: clip(title, TITLE_MAX),
      hint: clip(hint, HINT_MAX),
    };
  }

  /** One debug line per tool call: the step, the tool and a count, never a query or any learner text. */
  logCall(step: string, tool: string, count: number): void {
    this.logger.debug(`[debrief] ${tool} step=${step} count=${count}`);
  }

  /** `guidance_index`: the entries this tenant may read, by code, with the cache's version. */
  async index(tenantId?: string | null): Promise<{
    version: string;
    entries: GuidanceIndexEntry[];
    unavailable?: true;
  }> {
    try {
      const tenant = this.tenantKey(tenantId);
      const signature = await this.signature();
      const key = tenant ?? '';
      const hit = this.cache.get(key);
      if (hit && hit.signature === signature) {
        this.logger.debug(
          `[debrief] guidance_index cache hit (${hit.entries.length} entries)`,
        );
        return { version: signature, entries: hit.entries };
      }
      const rows = await this.chunks.find({
        where: {
          collectionId: ClCollectionId.DEBRIEF_GUIDANCE,
          status: ClChunkStatus.ACTIVE,
        },
        order: { code: 'ASC' },
      });
      const entries = rows
        .filter((c) => this.visible(c, tenant))
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
        .map((c) => this.entry(c));
      this.cache.delete(key);
      this.cache.set(key, { signature, entries });
      if (this.cache.size > CACHE_MAX_TENANTS) {
        this.cache.delete(this.cache.keys().next().value as string);
      }
      this.logger.debug(
        `[debrief] guidance_index rebuilt (${entries.length} entries)`,
      );
      return { version: signature, entries };
    } catch (e) {
      this.logger.warn(
        `[debrief] guidance_index unavailable: ${(e as Error).message}`,
      );
      return { version: 'unavailable', entries: [], unavailable: true };
    }
  }

  /** `guidance_fetch`: up to five entries by code, only ones this tenant may read. */
  async fetch(
    tenantId: string | null | undefined,
    codes: unknown,
    sessionId?: string | null,
    step = 'guidance_agent',
  ): Promise<{
    passages: GuidancePassageOut[];
    not_found: string[];
    unavailable?: true;
  }> {
    const wanted = [
      ...new Set(
        (Array.isArray(codes) ? codes : [])
          .map((c) =>
            String(c ?? '')
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean),
      ),
    ].slice(0, MAX_FETCH_CODES);
    if (!wanted.length) return { passages: [], not_found: [] };
    try {
      const tenant = this.tenantKey(tenantId);
      const rows = await this.chunks.find({
        where: {
          collectionId: ClCollectionId.DEBRIEF_GUIDANCE,
          status: ClChunkStatus.ACTIVE,
          code: In(wanted),
        },
      });
      const byCode = new Map(
        rows
          .filter((c) => this.visible(c, tenant))
          .map((c) => [c.code.toUpperCase(), c]),
      );
      const passages: GuidancePassageOut[] = [];
      const notFound: string[] = [];
      for (const code of wanted) {
        const c = byCode.get(code);
        if (!c) {
          notFound.push(code);
          continue;
        }
        const { title, text } = guidancePassage(c);
        passages.push({
          id: c.id,
          code: c.code,
          title,
          text,
          citation: title,
          band: 'direct',
        });
      }
      this.logger.debug(
        `[debrief] guidance_fetch step=${step} ${passages.length} found, ${notFound.length} not found`,
      );
      if (passages.length && this.retrieval) {
        // The same usage event path as a search (`read`), so the library can measure the RAG.
        await this.retrieval
          .recordUsage(
            ClUseCase.DEBRIEF,
            { ids: passages.map((p) => p.id) },
            'read',
            {
              sessionId: sessionId ?? null,
              detail: { tool: 'guidance_fetch', step },
            },
          )
          .catch(() => undefined);
      }
      return { passages, not_found: notFound };
    } catch (e) {
      this.logger.warn(
        `[debrief] guidance_fetch unavailable: ${(e as Error).message}`,
      );
      return { passages: [], not_found: wanted, unavailable: true };
    }
  }
}
