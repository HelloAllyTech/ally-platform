import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/service/redis.service';
import {
  CL_SEGMENT_REDIS_PREFIX,
  CL_SEGMENT_TTL_SECONDS,
} from '../constants/context-library.constants';

export interface StagedSegment {
  text: string;
  /** The previous segment's tail. Context only — never extracted from. */
  leadIn: string;
  nextHeading: string | null;
}

/**
 * The ONLY place document text lives, and only for a day.
 *
 * Redis, not Postgres, because Postgres backups are kept for far longer than this text may
 * be. A segment is deleted as soon as every target collection has extracted it, and expires
 * after 24 hours whatever happened — at which point the segment is marked `expired` and the
 * admin drops the file again to resume.
 */
@Injectable()
export class ContextStagingService {
  constructor(private readonly redis: RedisService) {}

  private key(segmentId: string): string {
    return `${CL_SEGMENT_REDIS_PREFIX}${segmentId}`;
  }

  async put(segmentId: string, segment: StagedSegment): Promise<void> {
    await this.redis.set(
      this.key(segmentId),
      JSON.stringify(segment),
      CL_SEGMENT_TTL_SECONDS,
    );
  }

  async get(segmentId: string): Promise<StagedSegment | null> {
    const raw = await this.redis.get(this.key(segmentId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StagedSegment;
    } catch {
      return null;
    }
  }

  async delete(segmentIds: string[]): Promise<void> {
    await Promise.all(segmentIds.map((id) => this.redis.del(this.key(id))));
  }
}
