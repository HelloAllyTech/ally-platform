import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { AiService } from 'src/ai/service/ai.service';
import { ContextChunkUpsertItem } from 'src/ai/dto/context-chunk.dto';
import { LoggerService } from 'src/logger/logger.service';
import {
  CL_INDEX_BATCH_SIZE,
  CL_INDEX_MAX_ATTEMPTS,
} from '../constants/context-library.constants';
import { ClCollection } from '../entity/cl-collection.entity';
import { ClChunk } from '../entity/cl-chunk.entity';
import { ClChunkStatus, ClEmbeddingStatus } from '../enum/context-library.enum';
import { facetValues, getProfile, indexCollectionName } from '../profiles';
import { indexHash, toView } from './context-chunk.service';

/**
 * Keeps each collection's Weaviate index in step with `cl_chunks` — the Knowledge Base's
 * outbox pattern. A write marks the row `pending`; this pushes it. Only ACTIVE chunks are
 * indexed: anything else is deleted from the index, so an archived chunk can never be
 * retrieved even if hydration were skipped.
 *
 * Best effort and self-healing: a failed push is recorded on the row and retried; the
 * nightly reconciliation diffs ids and hashes in both directions.
 */
@Injectable()
export class ContextIndexService {
  private readonly logger = LoggerService.getInstance(ContextIndexService.name);
  private running = false;

  constructor(
    private readonly ai: AiService,
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
    @InjectRepository(ClCollection)
    private readonly collections: Repository<ClCollection>,
  ) {}

  async indexName(collectionId: string): Promise<string> {
    const collection = await this.collections.findOne({
      where: { id: collectionId },
    });
    return indexCollectionName(
      collectionId,
      collection?.activeIndexVersion ?? 1,
    );
  }

  toUpsertItem(chunk: ClChunk): ContextChunkUpsertItem | null {
    const profile = getProfile(chunk.collectionId);
    if (!profile) return null;
    const view = toView(chunk);
    return {
      chunk_id: chunk.id,
      statement_text: profile.statementText(view) || chunk.statement,
      situations_text: profile.situationsText(view) || chunk.statement,
      properties: {
        code: chunk.code,
        collection_id: chunk.collectionId,
        status: chunk.status,
        statement: chunk.statement,
        body: chunk.body ?? null,
        situations: chunk.situations ?? [],
        example_queries: (chunk.exampleQueries ?? []).map((q) => q.text),
        keywords: chunk.keywords ?? [],
        topics: chunk.topics ?? [],
        facet_values: facetValues(chunk.facets ?? {}),
        is_global: chunk.isGlobal,
        tenant_ids: chunk.tenantIds ?? [],
        owner_tenant_id: chunk.ownerTenantId ?? null,
        text_hash: chunk.textHash ?? indexHash(chunk, profile),
      },
    };
  }

  /** Push every pending chunk. Re-entrant calls while one is running are dropped. */
  async syncPending(
    maxBatches = 20,
  ): Promise<{ indexed: number; removed: number; failed: number }> {
    const totals = { indexed: 0, removed: 0, failed: 0 };
    if (this.running) return totals;
    this.running = true;
    try {
      for (let batch = 0; batch < maxBatches; batch++) {
        const pending = await this.chunks.find({
          where: {
            embeddingStatus: In([
              ClEmbeddingStatus.PENDING,
              ClEmbeddingStatus.FAILED,
            ]),
            embeddingAttempts: LessThan(CL_INDEX_MAX_ATTEMPTS),
          },
          order: { updatedAt: 'ASC' },
          take: CL_INDEX_BATCH_SIZE,
        });
        if (!pending.length) break;
        const byCollection = new Map<string, ClChunk[]>();
        for (const chunk of pending) {
          const list = byCollection.get(chunk.collectionId) ?? [];
          list.push(chunk);
          byCollection.set(chunk.collectionId, list);
        }
        for (const [collectionId, list] of byCollection) {
          const r = await this.syncCollection(collectionId, list);
          totals.indexed += r.indexed;
          totals.removed += r.removed;
          totals.failed += r.failed;
        }
      }
    } finally {
      this.running = false;
    }
    return totals;
  }

  private async syncCollection(collectionId: string, list: ClChunk[]) {
    const result = { indexed: 0, removed: 0, failed: 0 };
    const name = await this.indexName(collectionId);
    const collection = await this.collections.findOne({
      where: { id: collectionId },
    });
    const version = collection?.activeIndexVersion ?? 1;
    const active = list.filter((c) => c.status === ClChunkStatus.ACTIVE);
    const inactive = list.filter((c) => c.status !== ClChunkStatus.ACTIVE);

    if (inactive.length) {
      try {
        await this.ai.contextChunksDelete(
          name,
          inactive.map((c) => c.id),
        );
        await this.mark(inactive, ClEmbeddingStatus.SKIPPED, version);
        result.removed += inactive.length;
      } catch (error) {
        await this.fail(inactive, error);
        result.failed += inactive.length;
      }
    }

    if (active.length) {
      const items = active
        .map((c) => this.toUpsertItem(c))
        .filter(Boolean) as ContextChunkUpsertItem[];
      try {
        const response = await this.ai.contextChunksBulkUpsert(name, items);
        const ok = new Set(response?.succeeded ?? []);
        const succeeded = active.filter((c) => ok.has(c.id));
        const failed = active.filter((c) => !ok.has(c.id));
        await this.mark(succeeded, ClEmbeddingStatus.SUCCESS, version);
        if (failed.length)
          await this.fail(failed, new Error('rejected by the index'));
        result.indexed += succeeded.length;
        result.failed += failed.length;
      } catch (error) {
        await this.fail(active, error);
        result.failed += active.length;
      }
    }
    return result;
  }

  private async mark(
    chunks: ClChunk[],
    status: ClEmbeddingStatus,
    version: number,
  ) {
    if (!chunks.length) return;
    await this.chunks.update(
      { id: In(chunks.map((c) => c.id)) },
      {
        embeddingStatus: status,
        embeddedAt: new Date(),
        indexVersion: version,
      },
    );
  }

  private async fail(chunks: ClChunk[], error: unknown) {
    this.logger.warn(
      `Context index push failed for ${chunks.length} chunk(s): ${error instanceof Error ? error.message : String(error)}`,
    );
    await this.chunks
      .createQueryBuilder()
      .update()
      .set({
        embeddingStatus: ClEmbeddingStatus.FAILED,
        embeddingAttempts: () => '"embedding_attempts" + 1',
      })
      .whereInIds(chunks.map((c) => c.id))
      .execute();
  }

  /**
   * Diff the index against Postgres in both directions: ids the index holds that are not
   * active here are deleted; active rows the index lacks, or holds with a stale hash, are
   * re-queued. A half-applied state is the dangerous one, so this runs nightly.
   */
  async reconcile(
    collectionId: string,
  ): Promise<{ removed: number; requeued: number }> {
    const name = await this.indexName(collectionId);
    const indexed = new Map<string, string | null>();
    let after: string | null = null;
    for (let page = 0; page < 500; page++) {
      const response = await this.ai.contextChunksIds(name, after, 500);
      for (const item of response?.items ?? [])
        indexed.set(item.chunk_id, item.text_hash);
      after = response?.next ?? null;
      if (!after) break;
    }
    const active = await this.chunks.find({
      where: { collectionId, status: ClChunkStatus.ACTIVE },
      select: ['id', 'textHash'],
    });
    const activeIds = new Set(active.map((c) => c.id));
    const extra = [...indexed.keys()].filter((id) => !activeIds.has(id));
    const stale = active
      .filter((c) => indexed.get(c.id) !== c.textHash)
      .map((c) => c.id);
    if (extra.length) await this.ai.contextChunksDelete(name, extra);
    if (stale.length) {
      await this.chunks.update(
        { id: In(stale) },
        { embeddingStatus: ClEmbeddingStatus.PENDING, embeddingAttempts: 0 },
      );
    }
    return { removed: extra.length, requeued: stale.length };
  }
}
