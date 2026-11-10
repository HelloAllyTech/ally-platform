import { isUUID } from 'class-validator';
import { ClChunk } from '../../context-library/entity/cl-chunk.entity';
import {
  ClCollectionId,
  ClUseCase,
} from '../../context-library/enum/context-library.enum';
import { ContextSearchRequest } from '../../context-library/service/context-retrieval.service';

/**
 * One Debrief Guidance guideline as the Debrief prompts have always read a passage: the title
 * it is cited by, and its text. An imported guideline is cited by the document it came from and
 * read word for word; a written or distilled one by its own statement.
 */
export function guidancePassage(chunk: ClChunk): {
  title: string;
  text: string;
} {
  return {
    title: chunk.citation?.title?.trim() || chunk.statement,
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
