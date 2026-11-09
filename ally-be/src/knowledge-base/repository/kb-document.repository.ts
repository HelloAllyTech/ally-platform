import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, IsNull, Repository } from 'typeorm';
import { resolveSort } from 'src/common/util/sort.util';
import { KbDocument } from '../entity/kb-document.entity';
import {
  KbCorpus,
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../enum/knowledge-base.enum';

export interface ListKbDocumentsOptions {
  /**
   * Required HERE even though the DTOs default it, and that asymmetry is deliberate. The
   * DTO default exists for one reason — the shipped dashboard does not send the field yet
   * and ally-be deploys first — so it belongs at the HTTP edge, where the compatibility
   * problem actually is. Inside, every screen and every retrieval is about exactly one
   * corpus, and a default would only ever serve a caller who forgot: the WhatsApp coverage
   * report was exactly that caller, counting other corpora's documents as its own uncited
   * material until the compiler caught it.
   */
  corpus: KbCorpus;
  limit?: number;
  offset?: number;
  search?: string;
  status?: KbDocumentStatus;
  sourceType?: KbDocumentSourceType;
  tags?: string[];
  /** Only what this organisation can retrieve: its own targeted documents plus the global ones. */
  tenantId?: string;
  /** With `tenantId`: only documents aimed at it, not the global ones. */
  excludeGlobal?: boolean;
  /**
   * Only documents an org-restricted admin may manage: targeted at one or more of these
   * organisations and at NO other, never global. Editing a document shared with an organisation
   * outside their allowlist would change another customer's corpus.
   */
  ownedByTenantIds?: string[];
  /**
   * Only the documents this owner MANAGES (`owner_tenant_id`): an organisation's own, or with
   * `tenantId: null` the platform's. An object rather than a bare `string | null` so that
   * "no owner filter" (absent) and "the platform's documents" (`{ tenantId: null }`) cannot
   * be confused — the null-means-unfiltered slip is the one that would list every
   * organisation's documents on the platform screen.
   */
  owner?: { tenantId: string | null };
  includeArchived?: boolean;
  sortBy?: string;
  sortDir?: string;
}

/**
 * What a caller may sort the corpus by. A whitelist — these strings reach ORDER BY.
 *
 * `status` sorts by the enum's stored text rather than by pipeline order, which puts `failed` first
 * ascending. That happens to be the useful end of the list, so it is left alone rather than given a
 * CASE expression nobody asked for.
 */
const DOCUMENT_SORT_COLUMNS = {
  title: 'doc.title',
  status: 'doc.status',
  chunkCount: 'doc.chunkCount',
  updatedAt: 'doc.updatedAt',
  createdAt: 'doc.createdAt',
};

@Injectable()
export class KbDocumentRepository extends Repository<KbDocument> {
  constructor(private readonly dataSource: DataSource) {
    super(KbDocument, dataSource.createEntityManager());
  }

  async list(
    options: ListKbDocumentsOptions,
  ): Promise<{ documents: KbDocument[]; count: number }> {
    const {
      corpus,
      limit = 25,
      offset = 0,
      search,
      status,
      sourceType,
      tags,
      tenantId,
      excludeGlobal = false,
      owner,
      ownedByTenantIds,
      includeArchived = false,
    } = options;
    const sort = resolveSort(
      DOCUMENT_SORT_COLUMNS,
      'doc.createdAt',
      options.sortBy,
      options.sortDir,
    );

    const query = this.createQueryBuilder('doc');

    query.andWhere('doc.corpus = :corpus', { corpus });
    // A chatbot's own documents (chunk 3d) are listed on that chatbot's Knowledge tab only, never
    // in the library or another bot's picker.
    query.andWhere('doc.ownerChatbotId IS NULL');

    if (!includeArchived) {
      query.andWhere('doc.archivedAt IS NULL');
    }
    if (status) {
      query.andWhere('doc.status = :status', { status });
    }
    if (sourceType) {
      query.andWhere('doc.sourceType = :sourceType', { sourceType });
    }
    if (tags?.length) {
      // `&&` is array overlap: match a document carrying ANY of the requested tags. Requiring all
      // of them would make multi-tag filtering almost always empty.
      query.andWhere('doc.tags && :tags', { tags });
    }
    if (tenantId) {
      // "What can this customer see" — the global corpus PLUS anything targeted at them, which
      // is exactly the disjunction retrieval applies. An EXISTS subquery rather than a join, so
      // a document targeted at several organisations cannot appear twice in the page and skew
      // the count.
      query.andWhere(
        `(${excludeGlobal ? 'false' : 'doc."is_global" = true'} OR EXISTS (
            SELECT 1 FROM kb_document_tenants dt
            WHERE dt.document_id = doc.id
              AND dt.tenant_id = :tenantId
              AND dt."deletedAt" IS NULL
          ))`,
        { tenantId },
      );
    }
    if (ownedByTenantIds) {
      query.andWhere(
        `doc."is_global" = false
          AND EXISTS (
            SELECT 1 FROM kb_document_tenants dt
            WHERE dt.document_id = doc.id
              AND dt.tenant_id IN (:...ownedByTenantIds)
              AND dt."deletedAt" IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM kb_document_tenants dt
            WHERE dt.document_id = doc.id
              AND dt.tenant_id NOT IN (:...ownedByTenantIds)
              AND dt."deletedAt" IS NULL
          )`,
        // An empty allowlist must match nothing, and `IN ()` is a syntax error.
        {
          ownedByTenantIds: ownedByTenantIds.length
            ? ownedByTenantIds
            : ['00000000-0000-0000-0000-000000000000'],
        },
      );
    }
    if (owner) {
      if (owner.tenantId === null) {
        query.andWhere('doc.ownerTenantId IS NULL');
      } else {
        query.andWhere('doc.ownerTenantId = :ownerTenantId', {
          ownerTenantId: owner.tenantId,
        });
      }
    }
    if (search?.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      query.andWhere(
        new Brackets((qb) => {
          qb.where('LOWER(doc.title) LIKE :term', { term })
            // rawText is searched too, so an admin can find the document that contains a phrase
            // rather than only the one whose title mentions it. Deliberately LIKE rather than
            // full-text: this is a small admin corpus, and a tsvector index plus its maintenance
            // is not worth it until the list is slow.
            .orWhere('LOWER(doc.rawText) LIKE :term', { term });
        }),
      );
    }

    // Selecting rawText into a list response would send megabytes per page for a column no list
    // view renders. Excluded explicitly rather than by accident.
    query
      .select([
        'doc.id',
        'doc.corpus',
        'doc.title',
        'doc.sourceType',
        'doc.sourceUrl',
        'doc.fileUrl',
        'doc.fileName',
        'doc.contentType',
        'doc.sizeBytes',
        'doc.language',
        'doc.tags',
        'doc.status',
        'doc.statusMessage',
        'doc.chunkCount',
        'doc.indexedChunkCount',
        'doc.isGlobal',
        'doc.ownerTenantId',
        'doc.contentHash',
        'doc.chunkVersion',
        'doc.archivedAt',
        'doc.createdBy',
        'doc.updatedBy',
        'doc.createdAt',
        'doc.updatedAt',
      ])
      // Archived last ALWAYS, whatever the chosen sort — mirrors the comfort-audio library, where
      // archiving hides an item from use without removing it from management. The requested sort is
      // secondary to that: a retired document sorting to the top of a title sort would put material
      // the bot no longer uses above material it does.
      .orderBy('doc.archivedAt', 'ASC', 'NULLS FIRST')
      .addOrderBy(sort.column, sort.direction)
      .limit(limit)
      .offset(offset);

    const [documents, count] = await query.getManyAndCount();
    return { documents, count };
  }

  /**
   * The retrievable documents of one corpus. Archived documents are excluded: their vectors
   * are deleted, so returning their ids would only ask ally-ai about chunks it no longer holds.
   *
   * Returning ids rather than a filter flag is what keeps the corpus boundary honest —
   * ally-ai's search takes `document_ids`, so the scope becomes the query itself.
   */
  async retrievableIds(options: {
    corpus: KbCorpus;
    tags?: string[];
  }): Promise<string[]> {
    const query = this.createQueryBuilder('doc')
      .select(['doc.id'])
      .where('doc.corpus = :corpus', { corpus: options.corpus })
      .andWhere('doc.archivedAt IS NULL')
      // Only an indexed document has vectors to match against; the others are still
      // extracting or have failed, and asking about them returns nothing at a cost.
      .andWhere('doc.status = :status', { status: KbDocumentStatus.INDEXED });

    if (options.tags?.length) {
      // `&&` overlap, matching the list filter's semantics rather than inventing a
      // second meaning for the same field.
      query.andWhere('doc.tags && :tags', { tags: options.tags });
    }

    const rows = await query.getMany();
    return rows.map((row) => row.id);
  }

  /**
   * The retrievable documents of one corpus that ONE AUDIENCE may read, keyed by id, with
   * whether each is global.
   *
   * The audience is a required argument with no "everyone" value. An organisation gets the
   * global documents plus those targeted at it; `tenantId: null` — an anonymous visitor, or
   * a learner with no organisation — gets the global documents only. It is the disjunction
   * the corpus list's organisation filter applies and ally-ai applies inside the vector
   * query, resolved here FIRST so that the ids travel as the search's `document_ids`: a
   * document outside this set cannot come back, whatever the vector index believes about
   * its audience.
   *
   * Indexed and unarchived only, as in `retrievableIds`.
   */
  async retrievableForAudience(options: {
    corpus: KbCorpus;
    tenantId: string | null;
  }): Promise<Map<string, { isGlobal: boolean }>> {
    const query = this.createQueryBuilder('doc')
      .select(['doc.id', 'doc.isGlobal'])
      .where('doc.corpus = :corpus', { corpus: options.corpus })
      .andWhere('doc.archivedAt IS NULL')
      .andWhere('doc.status = :status', { status: KbDocumentStatus.INDEXED })
      // Clinical content is served only as signed off: its current text, by the advisor.
      .andWhere(
        `(doc."needs_clinical_sign_off" = false
          OR doc."clinical_signed_off_hash" = doc."content_hash")`,
      );

    if (options.tenantId === null) {
      query.andWhere('doc.isGlobal = true');
    } else {
      query.andWhere(
        `(doc."is_global" = true OR EXISTS (
            SELECT 1 FROM kb_document_tenants dt
            WHERE dt.document_id = doc.id
              AND dt.tenant_id = :tenantId
              AND dt."deletedAt" IS NULL
          ))`,
        { tenantId: options.tenantId },
      );
    }

    const rows = await query.getMany();
    return new Map(rows.map((row) => [row.id, { isGlobal: row.isGlobal }]));
  }

  /**
   * One document of an owned corpus, only if this owner owns it — the organisation's, or
   * with `tenantId: null` the platform's. Null otherwise, which the caller reports as the
   * same 404 as a missing id, so an organisation cannot probe for another's document ids.
   */
  async findOwned(
    id: string,
    owner: { corpus: KbCorpus; tenantId: string | null },
  ): Promise<KbDocument | null> {
    return this.findOne({
      where: {
        id,
        corpus: owner.corpus,
        ownerTenantId: owner.tenantId === null ? IsNull() : owner.tenantId,
      },
    });
  }

  /** Counts by status, for one corpus's stats strip. */
  async countsByStatus(corpus: KbCorpus): Promise<Record<string, number>> {
    const rows = await this.createQueryBuilder('doc')
      .select('doc.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('doc.corpus = :corpus', { corpus })
      .andWhere('doc.archivedAt IS NULL')
      .groupBy('doc.status')
      .getRawMany<{ status: string; count: string }>();

    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});
  }

  async totals(
    corpus: KbCorpus,
  ): Promise<{ chunkCount: number; indexedChunkCount: number }> {
    const row = await this.createQueryBuilder('doc')
      .select('COALESCE(SUM(doc.chunkCount), 0)', 'chunkCount')
      .addSelect('COALESCE(SUM(doc.indexedChunkCount), 0)', 'indexedChunkCount')
      .where('doc.corpus = :corpus', { corpus })
      .andWhere('doc.archivedAt IS NULL')
      .getRawOne<{ chunkCount: string; indexedChunkCount: string }>();

    return {
      chunkCount: Number(row?.chunkCount ?? 0),
      indexedChunkCount: Number(row?.indexedChunkCount ?? 0),
    };
  }
}
