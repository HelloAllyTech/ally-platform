import { Injectable } from '@nestjs/common';
import {
  ClCollectionId,
  ClUseCase,
} from 'src/context-library/enum/context-library.enum';
import { ContextRetrievalService } from 'src/context-library/service/context-retrieval.service';

/** Entries Ally gets per search unless it asks for fewer or more. */
export const GUIDE_LIBRARY_DEFAULT_LIMIT = 5;
/** The most it may ask for: each entry carries its whole passage. */
export const GUIDE_LIBRARY_MAX_LIMIT = 8;

export interface GuideLibrarySearchInput {
  query: string;
  /**
   * The learner's organisation, or null for an anonymous visitor (or a learner with no
   * organisation), who gets the global library only. REQUIRED, not optional: a search that
   * forgot it must not compile, because the safe-looking default does not exist —
   * "everything" leaks organisations' protocols and "global only" silently hides a
   * learner's own.
   */
  tenantId: string | null;
  limit?: number;
  /** The guide thread this search served, for the retrieval log. */
  threadId?: string | null;
  /**
   * The learner. Not written to the Context Library's log, which keys a search by its session
   * (the thread) rather than by person; kept so callers need not change.
   */
  userId?: number | null;
}

export interface GuideLibraryHit {
  /** The entry's code, e.g. `AG-0042`. */
  code: string;
  /** What to cite: the document the passage came from, else the entry's own statement. */
  title: string;
  /** The passage exactly as written (or, for a distilled entry, what it says). */
  text: string;
  /** Fused retrieval score; comparable only within one search. */
  score: number;
  /** `global` for Ally's own library, `organisation` for the learner's own organisation's. */
  scope: 'global' | 'organisation';
}

/**
 * Ally's library (plans/ally-guide/plan.md §6.1, §7.6): material about becoming and being a
 * helper, from the platform and from the learner's own organisation — the Context Library's Ally
 * Guide Library (docs/context-library/PLAN.md §9.6).
 *
 * Searches the `ally_guide` use case with the learner's audience, so who is asking is part of
 * the query: a learner sees the global entries plus their own organisation's, an anonymous
 * visitor the global ones, and nobody another organisation's (§7.14, cross-tenant leakage). The
 * retrieval service pre-filters in the index and re-checks every hit in Postgres. The query is a
 * learner's words: the use case is marked sensitive, so it is never shown back or learned from.
 *
 * A failure to reach the library THROWS rather than returning nothing, so the caller can tell
 * "the library has nothing on that" from "the library is unavailable" — Ally says different
 * things for each.
 */
@Injectable()
export class GuideLibraryService {
  constructor(private readonly retrieval: ContextRetrievalService) {}

  async search(input: GuideLibrarySearchInput): Promise<GuideLibraryHit[]> {
    const query = (input.query ?? '').trim();
    if (!query) return [];
    const limit = Math.min(
      Math.max(Math.floor(input.limit ?? GUIDE_LIBRARY_DEFAULT_LIMIT), 1),
      GUIDE_LIBRARY_MAX_LIMIT,
    );

    const { results, noConfidentMatch } = await this.retrieval.search({
      useCase: ClUseCase.ALLY_GUIDE,
      audience: { tenantId: input.tenantId },
      collections: [ClCollectionId.ALLY_GUIDE_LIBRARY],
      queries: [query],
      limit,
      sessionId: input.threadId ?? null,
      queryOrigin: 'agent_tool',
    });
    // "No confident match" hands back the single closest low match; Ally treats that as
    // nothing found rather than stretching a weak passage into an answer.
    if (noConfidentMatch) return [];

    return results.map(({ chunk, score }) => ({
      code: chunk.code,
      title: chunk.citation?.title?.trim() || chunk.statement,
      text:
        (chunk.body ?? '').trim() ||
        String(chunk.attributes?.detail ?? '').trim() ||
        chunk.statement,
      score,
      scope: chunk.isGlobal ? 'global' : 'organisation',
    }));
  }
}
