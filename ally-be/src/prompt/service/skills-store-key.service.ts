import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import {
  SkillsStoreKey,
  SkillsStoreKeyScope,
} from '../entity/skills-store-key.entity';

/** Every Skills Store key starts with this, so a leaked one is recognisable. */
export const SKILLS_STORE_KEY_PREFIX = 'ssk_';

export interface IssuedSkillsStoreKey {
  id: string;
  name: string;
  scopes: SkillsStoreKeyScope[];
  /** The plain key. Returned once, at creation; only its hash is stored. */
  key: string;
}

export type SkillsStoreKeySummary = Pick<
  SkillsStoreKey,
  | 'id'
  | 'name'
  | 'prefix'
  | 'scopes'
  | 'createdBy'
  | 'createdAt'
  | 'revokedAt'
  | 'lastUsedAt'
>;

function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Keys for the `prompts` CLI. Generated in the Skills Store by anyone with
 * access to it, shared with whoever needs one (contractors included), and
 * revoked there.
 */
@Injectable()
export class SkillsStoreKeyService {
  constructor(private readonly dataSource: DataSource) {}

  private get repo() {
    return this.dataSource.getRepository(SkillsStoreKey);
  }

  async issue(
    name: string,
    scopes: SkillsStoreKeyScope[],
    createdBy: number | null,
  ): Promise<IssuedSkillsStoreKey> {
    const trimmed = name?.trim();
    if (!trimmed) {
      throw new BadRequestException(
        'Give the key a name, so it can be recognised later.',
      );
    }
    const unique = [...new Set(scopes)].filter((s) =>
      Object.values(SkillsStoreKeyScope).includes(s),
    );
    if (!unique.length) {
      throw new BadRequestException('A key needs at least one scope.');
    }
    const key = `${SKILLS_STORE_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const saved = await this.repo.save(
      this.repo.create({
        name: trimmed.slice(0, 120),
        prefix: key.slice(0, 12),
        keyHash: hashKey(key),
        scopes: unique,
        createdBy,
      }),
    );
    return { id: saved.id, name: saved.name, scopes: saved.scopes, key };
  }

  async list(): Promise<SkillsStoreKeySummary[]> {
    const rows = await this.repo.find({ order: { createdAt: 'DESC' } });
    return rows.map(
      ({
        id,
        name,
        prefix,
        scopes,
        createdBy,
        createdAt,
        revokedAt,
        lastUsedAt,
      }) => ({
        id,
        name,
        prefix,
        scopes,
        createdBy,
        createdAt,
        revokedAt,
        lastUsedAt,
      }),
    );
  }

  async revoke(id: string, revokedBy: number | null): Promise<void> {
    const result = await this.repo.update(
      { id, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedBy },
    );
    if (!result.affected) {
      throw new NotFoundException('No active key with that id.');
    }
  }

  /**
   * Check a presented key and return it, or throw. Records when it was last
   * used so a stale key stands out in the list.
   */
  async verify(
    presented: string | undefined,
    scope: SkillsStoreKeyScope,
  ): Promise<SkillsStoreKey> {
    if (!presented?.startsWith(SKILLS_STORE_KEY_PREFIX)) {
      throw new UnauthorizedException('Skills Store key missing');
    }
    const key = await this.repo.findOne({
      where: { keyHash: hashKey(presented) },
    });
    if (!key || key.revokedAt) {
      throw new UnauthorizedException('Skills Store key is invalid or revoked');
    }
    if (!key.scopes.includes(scope)) {
      throw new UnauthorizedException(
        `This Skills Store key can't ${scope}. Ask for a key with the ${scope} scope.`,
      );
    }
    await this.repo.update({ id: key.id }, { lastUsedAt: new Date() });
    return key;
  }
}
