import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';

import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { RedisService } from 'src/redis/service/redis.service';

import { BlogAuthorKey } from '../entity/blog-author-key.entity';

export const BLOG_AUTHOR_KEY_PREFIX = 'bga_';
/** Calls per key per minute: plenty for writing a post, small for a leaked key. */
const RATE_PER_MINUTE = 60;

export function hashBlogAuthorKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Keys that let Claude Code write draft blog posts as their owner. Only the hash is stored; the
 * key is shown once. A key stops working when it is revoked or when its owner no longer has the
 * permission to edit blogs.
 */
@Injectable()
export class BlogAuthorKeyService {
  constructor(
    @InjectRepository(BlogAuthorKey)
    private readonly keys: Repository<BlogAuthorKey>,
    private readonly redis: RedisService,
    private readonly permissions: PermissionsService,
  ) {}

  async create(ownerId: number, label: string) {
    const key = `${BLOG_AUTHOR_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const row = await this.keys.save(
      this.keys.create({
        ownerId,
        label: (label || 'My laptop').trim().slice(0, 80) || 'My laptop',
        keyHash: hashBlogAuthorKey(key),
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

  /** Resolve a bearer key to its row: not revoked, within the rate limit, owner still an editor. */
  async verify(authorization: string | undefined): Promise<BlogAuthorKey> {
    const key = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!key.startsWith(BLOG_AUTHOR_KEY_PREFIX))
      throw new UnauthorizedException('An Ally blog author key is required.');
    const row = await this.keys.findOne({
      where: { keyHash: hashBlogAuthorKey(key), revokedAt: IsNull() },
    });
    if (!row)
      throw new UnauthorizedException(
        'That key is not valid or has been revoked.',
      );

    const bucket = `blog:author:rate:${row.id}:${Math.floor(Date.now() / 60_000)}`;
    const count =
      Number((await this.redis.get(bucket).catch(() => null)) ?? 0) + 1;
    await this.redis.set(bucket, String(count), 70).catch(() => undefined);
    if (count > RATE_PER_MINUTE) {
      throw new UnauthorizedException(
        'Too many calls this minute; try again shortly.',
      );
    }

    const granted = await this.permissions.getUserPermissions(row.ownerId);
    if (!granted.includes(PERMISSIONS.EDIT_BLOG)) {
      throw new UnauthorizedException(
        'The person who made this key can no longer edit blog posts.',
      );
    }

    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await this.keys.update(row.id, { lastUsedAt: new Date() });
    }
    return row;
  }
}
