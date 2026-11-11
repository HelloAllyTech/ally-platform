import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  GeneratedImage,
  GeneratedImageStatus,
} from '../entity/generated-image.entity';

const returningRows = <T>(result: unknown): T[] => {
  // pg returns [rows, count] for UPDATE … RETURNING through TypeORM's query().
  if (Array.isArray(result) && Array.isArray(result[0]))
    return result[0] as T[];
  return (Array.isArray(result) ? result : []) as T[];
};

@Injectable()
export class GeneratedImageRepository extends Repository<GeneratedImage> {
  constructor(private readonly dataSource: DataSource) {
    super(GeneratedImage, dataSource.createEntityManager());
  }

  /**
   * Claim the oldest queued image. `FOR UPDATE SKIP LOCKED` lets every API
   * task run a worker without two of them taking the same row.
   */
  async claimNext(): Promise<GeneratedImage | null> {
    const rows = returningRows<{ id: string }>(
      await this.manager.query(
        `UPDATE "generated_images"
            SET "status" = 'running', "attempts" = "attempts" + 1,
                "startedAt" = COALESCE("startedAt", now()),
                "heartbeatAt" = now(), "updatedAt" = now()
          WHERE id = (
            SELECT id FROM "generated_images"
             WHERE "status" = 'queued'
             ORDER BY "createdAt"
             LIMIT 1
             FOR UPDATE SKIP LOCKED
          )
          RETURNING id`,
      ),
    );
    if (!rows.length) return null;
    return this.findOne({ where: { id: rows[0].id } });
  }

  async heartbeat(id: string): Promise<void> {
    await this.manager.query(
      `UPDATE "generated_images" SET "heartbeatAt" = now()
        WHERE id = $1 AND "status" = 'running'`,
      [id],
    );
  }

  /** Settle a running image. Conditional, so a reconciled-away run cannot overwrite its retry. */
  async settle(
    id: string,
    status: GeneratedImageStatus.SUCCEEDED | GeneratedImageStatus.FAILED,
    patch: Partial<GeneratedImage>,
  ): Promise<boolean> {
    const result = await this.createQueryBuilder()
      .update(GeneratedImage)
      .set({
        ...patch,
        status,
        finishedAt: new Date(),
      } as QueryDeepPartialEntity<GeneratedImage>)
      .where('id = :id AND status = :running', {
        id,
        running: GeneratedImageStatus.RUNNING,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * Running rows whose task died (a deploy): requeue while attempts remain,
   * fail the rest. Returns how many of each.
   */
  async reconcileStale(
    staleMs: number,
    maxAttempts: number,
    failedMessage: string,
  ): Promise<{ requeued: number; failed: number }> {
    const seconds = Math.round(staleMs / 1000);
    const requeued = returningRows(
      await this.manager.query(
        `UPDATE "generated_images" SET "status" = 'queued', "updatedAt" = now()
          WHERE "status" = 'running' AND "attempts" < $2
            AND COALESCE("heartbeatAt", "startedAt", "createdAt") < now() - make_interval(secs => $1)
          RETURNING id`,
        [seconds, maxAttempts],
      ),
    ).length;
    const failed = returningRows(
      await this.manager.query(
        `UPDATE "generated_images"
            SET "status" = 'failed', "error" = $3, "finishedAt" = now(), "updatedAt" = now()
          WHERE "status" = 'running' AND "attempts" >= $2
            AND COALESCE("heartbeatAt", "startedAt", "createdAt") < now() - make_interval(secs => $1)
          RETURNING id`,
        [seconds, maxAttempts, failedMessage],
      ),
    ).length;
    return { requeued, failed };
  }

  countActiveFor(userId: number): Promise<number> {
    return this.count({
      where: {
        createdBy: userId,
        status: In([GeneratedImageStatus.QUEUED, GeneratedImageStatus.RUNNING]),
      },
    });
  }

  findForTenant(
    ids: string[],
    tenantId: string | null,
  ): Promise<GeneratedImage[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.find({
      where: { id: In(ids), tenantId: tenantId ?? IsNull() },
    });
  }

  findHistory(
    tenantId: string | null,
    slotKey: string,
    limit: number,
  ): Promise<GeneratedImage[]> {
    return this.find({
      where: {
        tenantId: tenantId ?? IsNull(),
        slotKey,
        status: GeneratedImageStatus.SUCCEEDED,
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** The latest accepted cast sheet per character — per style, or for one style when given. */
  async findCastSheets(
    tenantId: string | null,
    characterIds: string[],
    styleId?: string,
  ): Promise<GeneratedImage[]> {
    if (!characterIds.length) return [];
    const rows = await this.find({
      where: {
        tenantId: tenantId ?? IsNull(),
        characterId: In(characterIds),
        ...(styleId ? { styleId } : {}),
        slotKind: 'cast_sheet',
        status: GeneratedImageStatus.SUCCEEDED,
        acceptedAt: Not(IsNull()),
      },
      order: { acceptedAt: 'DESC' },
    });
    const latest = new Map<string, GeneratedImage>();
    for (const row of rows) {
      const key = `${row.characterId}:${row.styleId}`;
      if (row.characterId && !latest.has(key)) latest.set(key, row);
    }
    return [...latest.values()];
  }

  /** Unaccepted succeeded images older than the retention window, oldest first. */
  findExpiredCandidates(
    days: number,
    limit: number,
  ): Promise<GeneratedImage[]> {
    return this.createQueryBuilder('image')
      .where('image.status = :status', {
        status: GeneratedImageStatus.SUCCEEDED,
      })
      .andWhere('image.acceptedAt IS NULL')
      .andWhere(`image."createdAt" < now() - make_interval(days => :days)`, {
        days,
      })
      .orderBy('image.createdAt', 'ASC')
      .take(limit)
      .getMany();
  }

  /** Ids among `ids` that another image uses as a reference. */
  async idsUsedAsReference(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows: { id: string }[] = await this.manager.query(
      `SELECT DISTINCT ref->>'imageId' AS id
         FROM "generated_images" g, jsonb_array_elements(g."references") ref
        WHERE ref->>'imageId' = ANY($1::text[])`,
      [ids],
    );
    return new Set(rows.map((row) => row.id));
  }
}
