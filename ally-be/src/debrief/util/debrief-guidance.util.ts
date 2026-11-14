import { isUUID } from 'class-validator';
import { ClChunk } from '../../context-library/entity/cl-chunk.entity';
import {
  ClCollectionId,
  ClUseCase,
} from '../../context-library/enum/context-library.enum';
import { ContextSearchRequest } from '../../context-library/service/context-retrieval.service';

/** How a protocol's title reads in every prompt that is given one. */
export const ORGANISATION_PROTOCOL_LABEL = 'ORGANISATION PROTOCOL:';

/**
 * One Debrief Guidance guideline as the Debrief prompts have always read a passage: the title
 * it is cited by, and its text. An imported guideline is cited by the document it came from and
 * read word for word; a written or distilled one by its own statement.
 */
export function guidancePassage(chunk: ClChunk): {
  title: string;
  text: string;
} {
  const title = chunk.citation?.title?.trim() || chunk.statement;
  return {
    // A protocol is the organisation's rule, not advice: labelled, so the Writer can name one the
    // trainee did not follow (plan case 17) and the judge can tell when a debrief contradicts it.
    title:
      chunk.facets?.kind === 'protocol'
        ? `${ORGANISATION_PROTOCOL_LABEL} ${title}`
        : title,
    text:
      (chunk.body ?? '').trim() ||
      String(chunk.attributes?.detail ?? '').trim() ||
      chunk.statement,
  };
}

/**
 * A guidance search for one learner: the `debrief` use case, Debrief Guidance only, as the
 * learner's organisation may read it. The organisation is a UUID or nobody — a non-UUID tenant
 * (an old roleplay's placeholder) reads the global guidelines only.
 */
export function guidanceSearch(
  query: string,
  tenantId: string | null | undefined,
  limit: number,
  sessionId: string,
): ContextSearchRequest {
  return {
    useCase: ClUseCase.DEBRIEF,
    audience: { tenantId: tenantId && isUUID(tenantId) ? tenantId : null },
    collections: [ClCollectionId.DEBRIEF_GUIDANCE],
    queries: [query],
    limit,
    sessionId,
    queryOrigin: 'agent_tool',
  };
}
