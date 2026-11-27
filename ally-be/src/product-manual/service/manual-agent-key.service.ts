import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { RedisService } from 'src/redis/service/redis.service';
import {
  MANUAL_MCP_RATE_PER_MINUTE,
  MANUAL_MCP_RATE_PREFIX,
} from '../constants/manual-agent.constants';
import { ManualAgentKey } from '../entity/manual-agent-key.entity';

export const MANUAL_KEY_PREFIX = 'pmk_';

export function hashManualKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export type ManualAgentKeyRow = {
  id: string;
  label: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);

/** Too many requests on one key this minute. A 429, so a coding agent backs off rather than re-auths. */
export class ManualKeyRateLimitedException extends HttpException {
  constructor() {
    super(
      'Too many requests this minute; try again shortly.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Keys a coding agent uses on the proposal MCP (`pmk_…`). A key can read the manual and file
 * proposals; nothing it can call edits a page. Only the sha256 is stored; the key is shown once.
 * Modelled on the Context Library's reader keys. Keys are shared admin infrastructure (one per
 * laptop or CI runner), so the admin list shows every key, not only the caller's.
 */
@Injectable()
export class ManualAgentKeyService {
  constructor(
    @InjectRepository(ManualAgentKey)
    private readonly keys: Repository<ManualAgentKey>,
    private readonly redis: RedisService,
  ) {}

  async create(
    ownerId: number,
    label: string,
  ): Promise<{ id: string; key: string }> {
    const key = `${MANUAL_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const row = await this.keys.save(
      this.keys.create({
        ownerId,
        label: (label?.trim() || 'Coding agent').slice(0, 80),
        keyHash: hashManualKey(key),
        keyPrefix: key.slice(0, 10),
      }),
    );
    return { id: row.id, key };
  }

  async list(): Promise<ManualAgentKeyRow[]> {
    const rows = await this.keys.find({
      select: [
        'id',
        'label',
        'keyPrefix',
        'lastUsedAt',
        'revokedAt',
        'createdAt',
      ],
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      keyPrefix: r.keyPrefix,
      lastUsedAt: iso(r.lastUsedAt),
      revokedAt: iso(r.revokedAt),
      createdAt: iso(r.createdAt) as string,
    }));
  }

  async revoke(id: string): Promise<void> {
    const row = await this.keys.findOne({ where: { id } });
    if (!row) throw new NotFoundException('No such key.');
    if (row.revokedAt) return;
    await this.keys.update(id, { revokedAt: new Date() });
  }

  /**
   * A bearer header to its live key row, or 401. Then the per-key rate limit (60/min, 429) and
   * `last_used_at`, touched at most once a minute.
   */
  async verify(authorization: string | undefined): Promise<ManualAgentKey> {
    const key = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!key.startsWith(MANUAL_KEY_PREFIX)) {
      throw new UnauthorizedException(
        'A Product Manual agent key (pmk_…) is required.',
      );
    }
    const row = await this.keys.findOne({
      where: { keyHash: hashManualKey(key), revokedAt: IsNull() },
    });
    if (!row) {
      throw new UnauthorizedException(
        'That key is not valid or has been revoked.',
      );
    }
    const minute = Math.floor(Date.now() / 60_000);
    const { count } = await this.redis
      .incrWithExpiry(`${MANUAL_MCP_RATE_PREFIX}${row.id}:${minute}`, 70)
      .catch(() => ({ count: 0 }));
    if (count > MANUAL_MCP_RATE_PER_MINUTE)
      throw new ManualKeyRateLimitedException();
    if (
      !row.lastUsedAt ||
      Date.now() - new Date(row.lastUsedAt).getTime() > 60_000
    ) {
      await this.keys
        .update(row.id, { lastUsedAt: new Date() })
        .catch(() => undefined);
    }
    return row;
  }
}
