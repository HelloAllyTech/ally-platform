import { Injectable } from '@nestjs/common';
import {
  KbCorpus,
  KbDocumentScope,
  KbRetrievalConsumer,
} from 'src/knowledge-base/enum/knowledge-base.enum';
import {
  KbOwner,
  KnowledgeBaseService,
} from 'src/knowledge-base/service/knowledge-base.service';

/** Passages Ally gets per search unless it asks for fewer or more. */
export const GUIDE_LIBRARY_DEFAULT_LIMIT = 5;
/** The most it may ask for: each passage is up to ~780 tokens of tool result. */
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
  /** The learner, for the retrieval log. */
  userId?: number | null;
}

export interface GuideLibraryHit {
  documentId: string;
  title: string;
  text: string;
  similarity: number;
  /** `global` for the platform library, `organisation` for the learner's own org's documents. */
  scope: 'global' | 'organisation';
}

/** The platform's own library: global documents, managed from the Ally Console. */
export const PLATFORM_LIBRARY: KbOwner = Object.freeze({
  corpus: KbCorpus.ALLY_GUIDE_LIBRARY,
  tenantId: null,
});

/** One organisation's own documents: available to its learners only. */
export const organisationLibrary = (tenantId: string): KbOwner => ({
  corpus: KbCorpus.ALLY_GUIDE_LIBRARY,
  tenantId,
});

/**
 * Ally's library (plans/ally-guide/plan.md §6.1, §7.6): material about becoming and being a
 * helper, from the platform and from the learner's own organisation.
 *
 * Searches only through `KnowledgeBaseService.searchForAudience`, so who is asking is part of
 * the query: a learner sees the global documents plus their own organisation's, an anonymous
 * visitor the global ones, and nobody another organisation's (§7.14, cross-tenant leakage).
 *
 * A failure to reach the library THROWS rather than returning nothing, so the caller can tell
 * "the library has nothing on that" from "the library is unavailable" — Ally says different
 * things for each.
 */
@Injectable()
export class GuideLibraryService {
  constructor(private readonly knowledgeBase: KnowledgeBaseService) {}

  async search(input: GuideLibrarySearchInput): Promise<GuideLibraryHit[]> {
    const query = (input.query ?? '').trim();
    if (!query) return [];
    const limit = Math.min(
      Math.max(Math.floor(input.limit ?? GUIDE_LIBRARY_DEFAULT_LIMIT), 1),
      GUIDE_LIBRARY_MAX_LIMIT,
    );

    const { passages } = await this.knowledgeBase.searchForAudience(
      { corpus: KbCorpus.ALLY_GUIDE_LIBRARY, query, limit },
      { tenantId: input.tenantId },
      {
        consumer: KbRetrievalConsumer.ALLY_GUIDE,
        sessionId: input.threadId ?? null,
        userId: input.userId ?? null,
      },
    );

    return passages.map((passage) => ({
      documentId: passage.document_id,
      title: passage.document_title,
      text: passage.text,
      similarity: passage.similarity,
      scope:
        passage.scope === KbDocumentScope.GLOBAL ? 'global' : 'organisation',
    }));
  }
}
