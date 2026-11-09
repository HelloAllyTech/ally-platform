import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { In, Not, Repository } from 'typeorm';
import { computeCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { AppConfigService } from 'src/config/config.service';
import { extractDocument } from 'src/knowledge-base/extractor';
import { KbDocumentSourceType } from 'src/knowledge-base/enum/knowledge-base.enum';
import { LoggerService } from 'src/logger/logger.service';
import {
  CL_COST_CAP_MULTIPLIER,
  CL_SEGMENT_TTL_WARN_SECONDS,
  CL_UPLOAD_MAX_BYTES,
  CL_UPLOAD_MAX_FILES,
  CL_WORKER_CONCURRENCY,
} from '../constants/context-library.constants';
import {
  ClIngestSegment,
  ClSegmentRun,
} from '../entity/cl-ingest-segment.entity';
import { ClSource } from '../entity/cl-source.entity';
import {
  ClChunkOrigin,
  ClSegmentRunStatus,
  ClSegmentStatus,
  ClSourceKind,
  ClSourceStatus,
} from '../enum/context-library.enum';
import { requireProfile } from '../profiles';
import { segmentDocument } from '../util/segment.util';
import { ClActor } from './context-chunk.service';
import { ContextStagingService } from './context-staging.service';
import { ContextWorkerService } from './context-worker.service';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface UploadOptions {
  collections: string[];
  /** Per file name: an admin-chosen title. */
  titles?: Record<string, string>;
  docVersion?: string | null;
  year?: number | null;
  /** Re-extract files already in a target collection, instead of skipping them. */
  reextract?: boolean;
  /** Add files whose title matches an existing document anyway. */
  addAnyway?: boolean;
  /** Overrides the default cap of 1.5× the estimate, per document. */
  costCapUsd?: number | null;
  batchId?: string | null;
}

export type UploadOutcome =
  | 'queued'
  | 'already_in_collection'
  | 'same_title'
  | 'duplicate_in_drop'
  | 'unsupported'
  | 'too_large'
  | 'no_text'
  | 'failed';

export interface UploadResult {
  fileName: string;
  outcome: UploadOutcome;
  message?: string;
  sourceId?: string;
  title?: string;
  segments?: number;
  estimatedCostUsd?: number;
  estimatedStartAt?: string;
  /** Set when the document would start after its text expires. */
  outlivesTtl?: boolean;
}

/** Seconds one part × collection takes, end to end, before there is data to say better. */
const SECONDS_PER_RUN_ESTIMATE = 45;

export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\.(pdf|epub)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(v|version|edition|ed)\s*\d+(\.\d+)*\b/g, '')
    .trim();
}

function kindFor(file: UploadedFile): ClSourceKind | null {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.pdf') || file.mimetype === 'application/pdf')
    return ClSourceKind.PDF;
  if (name.endsWith('.epub') || file.mimetype === 'application/epub+zip')
    return ClSourceKind.EPUB;
  return null;
}

/**
 * Uploads: read in memory, parse with the Knowledge Base's extractors, segment, stage the
 * text in Redis, queue the runs — and drop the file. Nothing about the file is stored but
 * its hash, title and page count.
 *
 * Each file is handled on its own: a scanned PDF or a duplicate is reported for that file
 * with its default applied (skip), and the rest of the drop carries on.
 */
@Injectable()
export class ContextUploadService {
  private readonly logger = LoggerService.getInstance(
    ContextUploadService.name,
  );

  constructor(
    @InjectRepository(ClSource) private readonly sources: Repository<ClSource>,
    @InjectRepository(ClIngestSegment)
    private readonly segments: Repository<ClIngestSegment>,
    @InjectRepository(ClSegmentRun)
    private readonly runs: Repository<ClSegmentRun>,
    private readonly staging: ContextStagingService,
    private readonly worker: ContextWorkerService,
    private readonly config: AppConfigService,
  ) {}

  private validateCollections(collections: string[], actor: ClActor): void {
    if (!collections?.length)
      throw new BadRequestException('Choose at least one collection.');
    for (const id of collections) {
      const profile = requireProfile(id);
      if (
        !profile.extraction ||
        !profile.allowedOrigins.includes(ClChunkOrigin.DISTILLED)
      ) {
        throw new BadRequestException(
          `${profile.name} does not take documents.`,
        );
      }
      if (actor.tenantId && !profile.allowsOrgChunks) {
        throw new BadRequestException(
          `${profile.name} does not take organisation documents.`,
        );
      }
    }
  }

  /** Rough cost of extracting `tokens` of text into one collection (extract + critic). */
  estimateCost(tokens: number, parts: number): number {
    const strong = this.config.builder?.interviewModel || 'gemini-2.5-pro';
    const extract = computeCostUsd(
      strong,
      tokens + parts * 1500,
      parts * 1800,
    ).costUsd;
    const critic = computeCostUsd(
      'gpt-4o-mini',
      tokens + parts * 1200,
      parts * 600,
    ).costUsd;
    return Math.round((extract + critic) * 10000) / 10000;
  }

  /** When a newly queued run would start, from the work ahead of it. */
  async estimatedStart(extraRunsAhead = 0): Promise<Date> {
    const ahead = await this.runs.count({
      where: {
        status: In([ClSegmentRunStatus.PENDING, ClSegmentRunStatus.CLAIMED]),
      },
    });
    const seconds =
      ((ahead + extraRunsAhead) * SECONDS_PER_RUN_ESTIMATE) /
      CL_WORKER_CONCURRENCY;
    return new Date(Date.now() + seconds * 1000);
  }

  async upload(
    files: UploadedFile[],
    options: UploadOptions,
    actor: ClActor,
  ): Promise<UploadResult[]> {
    if (!files?.length) throw new BadRequestException('No files received.');
    if (files.length > CL_UPLOAD_MAX_FILES) {
      throw new BadRequestException(
        `Add at most ${CL_UPLOAD_MAX_FILES} files at a time.`,
      );
    }
    this.validateCollections(options.collections, actor);
    const batchId = options.batchId || randomUUID();
    const results: UploadResult[] = [];
    const seenHashes = new Set<string>();
    let runsQueuedInThisDrop = 0;

    for (const file of files) {
      const fileName = file.originalname;
      try {
        const kind = kindFor(file);
        if (!kind) {
          results.push({
            fileName,
            outcome: 'unsupported',
            message: 'Only PDF and EPUB files can be added.',
          });
          continue;
        }
        if (file.size > CL_UPLOAD_MAX_BYTES) {
          results.push({
            fileName,
            outcome: 'too_large',
            message: 'This file is over the 150 MB limit.',
          });
          continue;
        }
        const fileHash = createHash('sha256').update(file.buffer).digest('hex');
        if (seenHashes.has(fileHash)) {
          results.push({
            fileName,
            outcome: 'duplicate_in_drop',
            message: 'The same file is already in this drop.',
          });
          continue;
        }
        seenHashes.add(fileHash);

        // Duplicates, per collection: skip the collections that already have this file.
        const previous = await this.sources.find({
          where: {
            fileHash,
            status: Not(
              In([ClSourceStatus.ARCHIVED, ClSourceStatus.CANCELLED]),
            ),
          },
          order: { generation: 'DESC' },
        });
        const already = new Set(previous.flatMap((p) => p.targetCollections));
        const targets = options.reextract
          ? options.collections
          : options.collections.filter((c) => !already.has(c));
        if (!targets.length) {
          results.push({
            fileName,
            outcome: 'already_in_collection',
            sourceId: previous[0]?.id,
            message:
              'Already in this collection. Choose "Re-extract" to run it again with the current settings.',
          });
          continue;
        }

        const extracted = await extractDocument({
          sourceType:
            kind === ClSourceKind.PDF
              ? KbDocumentSourceType.PDF
              : KbDocumentSourceType.EPUB,
          buffer: file.buffer,
        });
        // From here on nothing needs the bytes; let them go.
        file.buffer = Buffer.alloc(0);

        const title = (
          options.titles?.[fileName] ||
          extracted.title ||
          fileName.replace(/\.(pdf|epub)$/i, '')
        ).trim();
        const key = titleKey(title);
        if (!options.addAnyway && !previous.length) {
          const sameTitle = await this.sources.findOne({
            where: {
              titleKey: key,
              status: Not(
                In([ClSourceStatus.ARCHIVED, ClSourceStatus.CANCELLED]),
              ),
            },
          });
          if (sameTitle && sameTitle.fileHash !== fileHash) {
            results.push({
              fileName,
              outcome: 'same_title',
              sourceId: sameTitle.id,
              title,
              message: `Looks like "${sameTitle.title}", added on ${sameTitle.createdAt.toISOString().slice(0, 10)}.`,
            });
            continue;
          }
        }

        const prepared = segmentDocument(extracted);
        const extractable = prepared.filter((s) => !s.skippedReason);
        if (!extractable.length) {
          results.push({
            fileName,
            outcome: 'no_text',
            message:
              'No text to read. If this is a scanned PDF, export a text-based PDF and drop it again.',
          });
          continue;
        }
        const tokens = extractable.reduce((sum, s) => sum + s.tokenCount, 0);
        const estimate =
          this.estimateCost(tokens, extractable.length) * targets.length;
        const generation =
          options.reextract && previous.length ? previous[0].generation + 1 : 1;

        const source = await this.sources.save(
          this.sources.create({
            title,
            docVersion: options.docVersion ?? null,
            year: options.year ?? null,
            kind,
            language: extracted.language ?? null,
            fileHash,
            titleKey: key,
            targetCollections: targets,
            ownerTenantId: actor.tenantId,
            pageCount: extracted.pages.length,
            segmentCount: extractable.length,
            extractionWarnings: extracted.sections.length
              ? []
              : ['No headings found; parts follow paragraph boundaries.'],
            status: ClSourceStatus.QUEUED,
            batchId,
            queuePosition: String(Date.now() * 1000 + results.length),
            costCapUsd: String(
              Math.max(
                0.05,
                options.costCapUsd ??
                  Math.round(estimate * CL_COST_CAP_MULTIPLIER * 10000) / 10000,
              ),
            ),
            generation,
            uploadedBy: actor.userId,
          }),
        );

        const rows = await this.segments.save(
          prepared.map((s) =>
            this.segments.create({
              sourceId: source.id,
              ordinal: s.ordinal,
              sectionPath: s.sectionPath,
              pageFrom: s.pageFrom,
              pageTo: s.pageTo,
              textHash: s.textHash,
              tokenCount: s.tokenCount,
              forOverview: s.forOverview,
              status: s.skippedReason
                ? ClSegmentStatus.SKIPPED
                : ClSegmentStatus.PENDING,
              skippedReason: s.skippedReason,
            }),
          ),
        );
        const byOrdinal = new Map(rows.map((r) => [r.ordinal, r]));
        for (const s of extractable) {
          await this.staging.put(byOrdinal.get(s.ordinal)!.id, {
            text: s.text,
            leadIn: s.leadIn,
            nextHeading: s.nextHeading,
          });
        }
        const runRows = extractable.flatMap((s) =>
          targets.map((collectionId) =>
            this.runs.create({
              segmentId: byOrdinal.get(s.ordinal)!.id,
              sourceId: source.id,
              collectionId,
              queuePosition: source.queuePosition,
              ordinal: s.ordinal,
              status: ClSegmentRunStatus.PENDING,
            }),
          ),
        );
        await this.runs.save(runRows, { chunk: 200 });

        const start = await this.estimatedStart(runsQueuedInThisDrop);
        runsQueuedInThisDrop += runRows.length;
        results.push({
          fileName,
          outcome: 'queued',
          sourceId: source.id,
          title,
          segments: extractable.length,
          estimatedCostUsd: Math.round(estimate * 100) / 100,
          estimatedStartAt: start.toISOString(),
          outlivesTtl:
            start.getTime() - Date.now() > CL_SEGMENT_TTL_WARN_SECONDS * 1000,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Context Library upload of a file failed: ${message}`);
        results.push({
          fileName,
          outcome: /text/i.test(message) ? 'no_text' : 'failed',
          message,
        });
      } finally {
        file.buffer = Buffer.alloc(0);
      }
    }

    if (results.some((r) => r.outcome === 'queued')) this.worker.kick();
    return results;
  }

  // ── Queue controls ─────────────────────────────────────────────────────────

  async pause(sourceId: string): Promise<void> {
    await this.sources.update(
      {
        id: sourceId,
        status: In([ClSourceStatus.QUEUED, ClSourceStatus.EXTRACTING]),
      },
      { status: ClSourceStatus.PAUSED, pausedAt: new Date() },
    );
  }

  async resume(sourceId: string, raiseCapBy?: number): Promise<void> {
    const source = await this.sources.findOneOrFail({
      where: { id: sourceId },
    });
    if (source.status !== ClSourceStatus.PAUSED) return;
    const cap = raiseCapBy
      ? String(Number(source.costCapUsd ?? 0) + raiseCapBy)
      : source.costCapUsd;
    await this.sources.update(sourceId, {
      status: ClSourceStatus.QUEUED,
      pausedAt: null,
      error: null,
      costCapUsd: cap,
    });
    this.worker.kick();
  }

  /** Cancel: the document's staged text is deleted at once. */
  async cancel(sourceId: string): Promise<void> {
    await this.sources.update(sourceId, { status: ClSourceStatus.CANCELLED });
    const segs = await this.segments.find({
      where: { sourceId },
      select: ['id'],
    });
    await this.staging.delete(segs.map((s) => s.id));
    await this.runs.update(
      {
        sourceId,
        status: In([ClSegmentRunStatus.PENDING, ClSegmentRunStatus.CLAIMED]),
      },
      { status: ClSegmentRunStatus.FAILED, error: 'cancelled' },
    );
  }

  /** Move a document to the front of the queue (or anywhere, by position). */
  async moveToFront(sourceId: string): Promise<void> {
    const first = await this.sources.findOne({
      where: {
        status: In([
          ClSourceStatus.QUEUED,
          ClSourceStatus.EXTRACTING,
          ClSourceStatus.PAUSED,
        ]),
      },
      order: { queuePosition: 'ASC' },
    });
    const position = String(
      BigInt(first?.queuePosition ?? Date.now() * 1000) - 1n,
    );
    await this.sources.update(sourceId, { queuePosition: position });
    await this.runs.update({ sourceId }, { queuePosition: position });
  }

  async retryFailed(sourceId: string): Promise<number> {
    const result = await this.runs.update(
      { sourceId, status: ClSegmentRunStatus.FAILED },
      { status: ClSegmentRunStatus.PENDING, attempts: 0, error: null },
    );
    const source = await this.sources.findOne({ where: { id: sourceId } });
    if (source && source.status !== ClSourceStatus.CANCELLED) {
      // A retried collection consolidates again once its runs finish.
      await this.sources.update(sourceId, {
        status: ClSourceStatus.QUEUED,
        consolidatedCollections: [],
      });
    }
    this.worker.kick();
    return result.affected ?? 0;
  }

  async queue(ownerTenantId?: string | null) {
    const where = ownerTenantId ? { ownerTenantId } : {};
    const recent = await this.sources.find({
      where: [
        {
          ...where,
          status: In([
            ClSourceStatus.QUEUED,
            ClSourceStatus.EXTRACTING,
            ClSourceStatus.CONSOLIDATING,
            ClSourceStatus.PAUSED,
          ]),
        },
      ],
      order: { queuePosition: 'ASC' },
      take: 200,
    });
    const counts: Array<{ source_id: string; status: string; n: string }> =
      recent.length
        ? await this.runs
            .createQueryBuilder('r')
            .select('r.source_id', 'source_id')
            .addSelect('r.status', 'status')
            .addSelect('COUNT(*)', 'n')
            .where('r.source_id IN (:...ids)', { ids: recent.map((s) => s.id) })
            .groupBy('r.source_id')
            .addGroupBy('r.status')
            .getRawMany()
        : [];
    return recent.map((s) => {
      const mine = counts.filter((c) => c.source_id === s.id);
      const total = mine.reduce((sum, c) => sum + Number(c.n), 0);
      const done = mine
        .filter((c) => c.status === 'done' || c.status === 'failed')
        .reduce((sum, c) => sum + Number(c.n), 0);
      const failed = Number(mine.find((c) => c.status === 'failed')?.n ?? 0);
      return {
        id: s.id,
        title: s.title,
        status: s.status,
        targetCollections: s.targetCollections,
        partsTotal: total,
        partsDone: done,
        partsFailed: failed,
        costUsd: Number(s.costUsd),
        costCapUsd: s.costCapUsd ? Number(s.costCapUsd) : null,
        error: s.error ?? null,
        queuePosition: s.queuePosition,
      };
    });
  }
}
