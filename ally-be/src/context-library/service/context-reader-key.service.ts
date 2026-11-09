import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { RedisService } from 'src/redis/service/redis.service';
import { ClReaderKey } from '../entity/cl-retrieval.entity';

const KEY_PREFIX = 'clr_';
/** Searches per key per minute; generous for an editor, small for a leaked key. */
const RATE_PER_MINUTE = 60;

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Engineers' read-only keys for the Context Library MCP endpoint. Separate from Skills Store
 * keys by decision: a leaked key here can only search what engineers may read, nothing else.
 * Only the hash is stored; the key itself is shown once, at creation.
 */
@Injectable()
export class ContextReaderKeyService {
  constructor(
    @InjectRepository(ClReaderKey)
    private readonly keys: Repository<ClReaderKey>,
    private readonly redis: RedisService,
  ) {}

  async create(ownerId: number, label: string) {
    const key = `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const row = await this.keys.save(
      this.keys.create({
        ownerId,
        label: (label || 'My laptop').slice(0, 80),
        keyHash: hashKey(key),
        keyPrefix: key.slice(0, 10),
      }),
    );
    return {
      id: row.id,
      label: row.label,
      key,
      keyPrefix: row.keyPrefix,
      createdAt: row.createdAt,
    };
  }

  list(ownerId: number) {
    return this.keys.find({
      where: { ownerId, revokedAt: IsNull() },
      select: ['id', 'label', 'keyPrefix', 'lastUsedAt', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
  }

  async revoke(ownerId: number, id: string) {
    const row = await this.keys.findOne({ where: { id, ownerId } });
    if (!row) throw new NotFoundException();
    row.revokedAt = new Date();
    await this.keys.save(row);
  }

  async restore(ownerId: number, id: string) {
    const row = await this.keys.findOne({ where: { id, ownerId } });
    if (!row) throw new NotFoundException();
    row.revokedAt = null;
    await this.keys.save(row);
  }

  /** Resolve a bearer key to its row, enforcing revocation and the per-key rate limit. */
  async verify(authorization: string | undefined): Promise<ClReaderKey> {
    const key = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!key.startsWith(KEY_PREFIX))
      throw new UnauthorizedException(
        'A Context Library reader key is required.',
      );
    const row = await this.keys.findOne({
      where: { keyHash: hashKey(key), revokedAt: IsNull() },
    });
    if (!row)
      throw new UnauthorizedException(
        'That key is not valid or has been revoked.',
      );
    const bucket = `cl:mcp:rate:${row.id}:${Math.floor(Date.now() / 60_000)}`;
    const count =
      Number((await this.redis.get(bucket).catch(() => null)) ?? 0) + 1;
    await this.redis.set(bucket, String(count), 70).catch(() => undefined);
    if (count > RATE_PER_MINUTE) {
      throw new UnauthorizedException(
        'Too many searches this minute; try again shortly.',
      );
    }
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await this.keys.update(row.id, { lastUsedAt: new Date() });
    }
    return row;
  }
}
