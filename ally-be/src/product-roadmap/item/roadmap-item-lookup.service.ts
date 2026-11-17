import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** The few facts the v2 routes need about one idea. */
export interface RoadmapItemRef {
  id: string;
  code: string;
  createdBy: number;
  builderSessionId: string | null;
}

/**
 * Finds an idea by id or code (`/v1/roadmap/items/:code`). A soft-deleted
 * opportunity is not found. The read model (P2) grows from here.
 */
@Injectable()
export class RoadmapItemLookupService {
  constructor(private readonly dataSource: DataSource) {}

  async get(idOrCode: string): Promise<RoadmapItemRef> {
    const key = (idOrCode ?? '').trim();
    if (!key || key.length > 64) throw new NotFoundException('Idea not found');
    const rows: RoadmapItemRef[] = await this.dataSource.query(
      `SELECT id, code, "createdBy", "builderSessionId"
         FROM "roadmap_opportunities"
        WHERE (id::text = $1 OR upper(code) = upper($1))
          AND "deletedAt" IS NULL
        LIMIT 1`,
      [key],
    );
    const row = rows?.[0];
    if (!row) throw new NotFoundException('Idea not found');
    return row;
  }
}
