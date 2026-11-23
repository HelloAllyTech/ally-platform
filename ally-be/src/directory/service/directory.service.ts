import { randomBytes } from 'crypto';
import { promises as dns } from 'dns';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CreateDirectoryCollectionDto,
  PatchDirectoryCollectionDto,
  PatchDirectoryEntryDto,
  UpsertDirectoryEntryDto,
} from '../dto/directory.dto';
import {
  DEFAULT_COLLECTION_SETTINGS,
  DirectoryCollection,
  DirectoryCollectionSettings,
} from '../entity/directory-collection.entity';
import { DirectoryCollectionEntry } from '../entity/directory-collection-entry.entity';
import {
  DirectoryEntry,
  DirectoryVisibility,
} from '../entity/directory-entry.entity';

export type EntryScope = 'all' | 'public' | 'mine';

const HOSTNAME =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Hosts that belong to Ally itself can never be claimed as a custom domain. */
const RESERVED_DOMAIN_SUFFIXES = ['helloally.ai', 'localhost'];
export const VERIFY_PREFIX = '_ally-directory';

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);

/**
 * The directory's rules, in one place:
 *  - anyone signed in adds entries (public or private);
 *  - an entry is readable if it is public or yours, and editable only if it is yours;
 *  - a collection is editable only by its owner, and may hold public entries or the owner's own.
 */
@Injectable()
export class DirectoryService {
  constructor(
    @InjectRepository(DirectoryEntry)
    private readonly entries: Repository<DirectoryEntry>,
    @InjectRepository(DirectoryCollection)
    private readonly collections: Repository<DirectoryCollection>,
    @InjectRepository(DirectoryCollectionEntry)
    private readonly links: Repository<DirectoryCollectionEntry>,
  ) {}

  // ── Entries ──

  async listEntries(
    userId: number,
    q: { scope?: EntryScope; search?: string; category?: string },
  ) {
    const scope: EntryScope = q.scope ?? 'all';
    const qb = this.entries.createQueryBuilder('e');
    if (scope === 'public') {
      qb.where('e.visibility = :pub', { pub: DirectoryVisibility.PUBLIC });
    } else if (scope === 'mine') {
      qb.where('e.owner_id = :userId', { userId });
    } else {
      qb.where('(e.visibility = :pub OR e.owner_id = :userId)', {
        pub: DirectoryVisibility.PUBLIC,
        userId,
      });
    }
    const search = q.search?.trim();
    if (search) {
      qb.andWhere(
        `(e.title ILIKE :s OR e.description ILIKE :s OR e.organization ILIKE :s OR e.city ILIKE :s OR e.tags::text ILIKE :s)`,
        { s: `%${search.replace(/[%_\\]/g, '\\$&')}%` },
      );
    }
    if (q.category?.trim()) {
      qb.andWhere('e.category = :category', { category: q.category.trim() });
    }
    const rows = await qb.orderBy('e.updatedAt', 'DESC').take(500).getMany();
    return rows.map((r) => this.entryView(r, userId));
  }

  async getEntry(userId: number, id: string) {
    const row = await this.readableEntry(userId, id);
    return this.entryView(row, userId);
  }

  async createEntry(userId: number, dto: UpsertDirectoryEntryDto) {
    const row = this.entries.create({
      ownerId: userId,
      title: dto.title.trim(),
      description: dto.description?.trim() ?? '',
      category: dto.category?.trim() ?? '',
      organization: dto.organization?.trim() ?? '',
      websiteUrl: dto.websiteUrl?.trim() ?? '',
      phone: dto.phone?.trim() ?? '',
      email: dto.email?.trim() ?? '',
      address: dto.address?.trim() ?? '',
      city: dto.city?.trim() ?? '',
      region: dto.region?.trim() ?? '',
      country: dto.country?.trim() ?? '',
      tags: this.cleanList(dto.tags),
      languages: this.cleanList(dto.languages),
      visibility: dto.visibility ?? DirectoryVisibility.PRIVATE,
    });
    return this.entryView(await this.entries.save(row), userId);
  }

  async updateEntry(userId: number, id: string, dto: PatchDirectoryEntryDto) {
    const row = await this.ownedEntry(userId, id);
    const text = (v: string | undefined, cur: string) =>
      v === undefined ? cur : v.trim();
    row.title = text(dto.title, row.title);
    row.description = text(dto.description, row.description);
    row.category = text(dto.category, row.category);
    row.organization = text(dto.organization, row.organization);
    row.websiteUrl = text(dto.websiteUrl, row.websiteUrl);
    row.phone = text(dto.phone, row.phone);
    row.email = text(dto.email, row.email);
    row.address = text(dto.address, row.address);
    row.city = text(dto.city, row.city);
    row.region = text(dto.region, row.region);
    row.country = text(dto.country, row.country);
    if (dto.tags !== undefined) row.tags = this.cleanList(dto.tags);
    if (dto.languages !== undefined) {
      row.languages = this.cleanList(dto.languages);
    }
    if (dto.visibility !== undefined) row.visibility = dto.visibility;
    return this.entryView(await this.entries.save(row), userId);
  }

  async deleteEntry(userId: number, id: string): Promise<void> {
    await this.ownedEntry(userId, id);
    await this.entries.delete({ id }); // collection links go with it (FK cascade)
  }

  // ── Collections ──

  async listCollections(userId: number) {
    const rows = await this.collections.find({
      where: { ownerId: userId },
      order: { updatedAt: 'DESC' },
    });
    const counts = await this.countEntries(rows.map((r) => r.id));
    return rows.map((r) => ({
      ...this.collectionView(r),
      entryCount: counts.get(r.id) ?? 0,
    }));
  }

  async getCollection(userId: number, id: string) {
    const row = await this.ownedCollection(userId, id);
    return {
      ...this.collectionView(row),
      entries: await this.collectionEntries(row),
    };
  }

  async createCollection(userId: number, dto: CreateDirectoryCollectionDto) {
    const base = slugify(dto.name) || 'directory';
    const slug = await this.freeSlug(base);
    const row = await this.collections.save(
      this.collections.create({
        ownerId: userId,
        name: dto.name.trim(),
        description: dto.description?.trim() ?? '',
        slug,
        published: false,
        settings: { ...DEFAULT_COLLECTION_SETTINGS },
      }),
    );
    return { ...this.collectionView(row), entryCount: 0, entries: [] };
  }

  async updateCollection(
    userId: number,
    id: string,
    dto: PatchDirectoryCollectionDto,
  ) {
    const row = await this.ownedCollection(userId, id);
    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.description !== undefined) row.description = dto.description.trim();
    if (dto.slug !== undefined && dto.slug !== row.slug) {
      const taken = await this.collections
        .createQueryBuilder('c')
        .where('lower(c.slug) = :slug AND c.id <> :id', {
          slug: dto.slug.toLowerCase(),
          id,
        })
        .getExists();
      if (taken) {
        throw new ConflictException('That page address is already taken');
      }
      row.slug = dto.slug.toLowerCase();
    }
    if (dto.published !== undefined) row.published = dto.published;
    if (dto.settings) {
      const next: DirectoryCollectionSettings = {
        ...DEFAULT_COLLECTION_SETTINGS,
        ...row.settings,
      };
      for (const [k, v] of Object.entries(dto.settings)) {
        if (v !== undefined)
          (next as unknown as Record<string, unknown>)[k] = v;
      }
      row.settings = next;
    }
    const saved = await this.collections.save(row);
    return {
      ...this.collectionView(saved),
      entries: await this.collectionEntries(saved),
    };
  }

  async deleteCollection(userId: number, id: string): Promise<void> {
    await this.ownedCollection(userId, id);
    await this.collections.delete({ id });
  }

  async addEntry(userId: number, collectionId: string, entryId: string) {
    await this.ownedCollection(userId, collectionId);
    // Only a public entry or one of the caller's own can be saved to a view.
    await this.readableEntry(userId, entryId);
    await this.links
      .createQueryBuilder()
      .insert()
      .values({ collectionId, entryId })
      .orIgnore()
      .execute();
    await this.collections.update(
      { id: collectionId },
      { updatedAt: new Date() },
    );
    return this.getCollection(userId, collectionId);
  }

  async removeEntry(userId: number, collectionId: string, entryId: string) {
    await this.ownedCollection(userId, collectionId);
    await this.links.delete({ collectionId, entryId });
    await this.collections.update(
      { id: collectionId },
      { updatedAt: new Date() },
    );
    return this.getCollection(userId, collectionId);
  }

  /** Which of the caller's collections hold this entry (for the "saved to" checkmarks). */
  async collectionsHolding(userId: number, entryId: string): Promise<string[]> {
    const rows = await this.links
      .createQueryBuilder('l')
      .innerJoin(DirectoryCollection, 'c', 'c.id = l.collection_id')
      .where('l.entry_id = :entryId AND c.owner_id = :userId', {
        entryId,
        userId,
      })
      .select('l.collection_id', 'collectionId')
      .getRawMany<{ collectionId: string }>();
    return rows.map((r) => r.collectionId);
  }

  // ── Custom domain ──

  /** `DIRECTORY_DOMAIN_TARGET`: the host the owner points their domain's CNAME at. */
  domainTarget(): string {
    return process.env.DIRECTORY_DOMAIN_TARGET ?? '';
  }

  normaliseDomain(raw: string): string {
    const domain = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/\.$/, '');
    if (!HOSTNAME.test(domain)) {
      throw new BadRequestException(
        'Enter a domain like resources.example.org (no https://, no path)',
      );
    }
    if (
      RESERVED_DOMAIN_SUFFIXES.some(
        (s) => domain === s || domain.endsWith(`.${s}`),
      )
    ) {
      throw new BadRequestException('That domain cannot be used');
    }
    return domain;
  }

  async setDomain(userId: number, id: string, raw: string) {
    const row = await this.ownedCollection(userId, id);
    const domain = this.normaliseDomain(raw);
    const taken = await this.collections
      .createQueryBuilder('c')
      .where('lower(c.custom_domain) = :domain AND c.id <> :id', { domain, id })
      .getExists();
    if (taken) {
      throw new ConflictException(
        'That domain is already used by another collection',
      );
    }
    if (row.customDomain !== domain) {
      row.customDomain = domain;
      row.domainVerificationToken = randomBytes(16).toString('hex');
      row.domainVerifiedAt = null;
      await this.collections.save(row);
    }
    return this.getCollection(userId, id);
  }

  async clearDomain(userId: number, id: string) {
    const row = await this.ownedCollection(userId, id);
    row.customDomain = null;
    row.domainVerificationToken = null;
    row.domainVerifiedAt = null;
    await this.collections.save(row);
    return this.getCollection(userId, id);
  }

  /** Looks for the owner's TXT record. Verified domains start answering on the next request. */
  async verifyDomain(userId: number, id: string) {
    const row = await this.ownedCollection(userId, id);
    if (!row.customDomain || !row.domainVerificationToken) {
      throw new BadRequestException('Set a domain first');
    }
    const expected = `ally-verify=${row.domainVerificationToken}`;
    let found = false;
    try {
      const records = await dns.resolveTxt(
        `${VERIFY_PREFIX}.${row.customDomain}`,
      );
      found = records.some((parts) => parts.join('') === expected);
    } catch {
      found = false; // ENOTFOUND / ENODATA: the record is not there (yet)
    }
    row.domainVerifiedAt = found ? new Date() : null;
    await this.collections.save(row);
    return this.getCollection(userId, id);
  }

  // ── Views and helpers ──

  entryView(row: DirectoryEntry, userId: number) {
    const { ownerId, ...rest } = row;
    return { ...rest, isOwner: ownerId === userId };
  }

  collectionView(row: DirectoryCollection) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      slug: row.slug,
      published: row.published,
      settings: { ...DEFAULT_COLLECTION_SETTINGS, ...row.settings },
      customDomain: row.customDomain,
      domainVerified: Boolean(row.domainVerifiedAt),
      domainVerification: row.customDomain
        ? {
            txtName: `${VERIFY_PREFIX}.${row.customDomain}`,
            txtValue: `ally-verify=${row.domainVerificationToken}`,
            cnameTarget: this.domainTarget(),
          }
        : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Entries a collection shows: public ones, plus the owner's own private ones. */
  async visibleEntries(collection: DirectoryCollection) {
    return this.entries
      .createQueryBuilder('e')
      .innerJoin(
        DirectoryCollectionEntry,
        'l',
        'l.entry_id = e.id AND l.collection_id = :cid',
        { cid: collection.id },
      )
      .where('(e.visibility = :pub OR e.owner_id = :owner)', {
        pub: DirectoryVisibility.PUBLIC,
        owner: collection.ownerId,
      })
      .orderBy('e.title', 'ASC')
      .getMany();
  }

  private async collectionEntries(collection: DirectoryCollection) {
    const rows = await this.visibleEntries(collection);
    return rows.map((r) => this.entryView(r, collection.ownerId));
  }

  private async countEntries(ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ids.length) return out;
    const rows = await this.links
      .createQueryBuilder('l')
      .select('l.collection_id', 'id')
      .addSelect('count(*)', 'n')
      .where({ collectionId: In(ids) })
      .groupBy('l.collection_id')
      .getRawMany<{ id: string; n: string }>();
    rows.forEach((r) => out.set(r.id, Number(r.n)));
    return out;
  }

  private async freeSlug(base: string): Promise<string> {
    const padded = base.length >= 3 ? base : `${base}-dir`;
    for (let i = 0; i < 5; i += 1) {
      const slug =
        i === 0 ? padded : `${padded}-${randomBytes(2).toString('hex')}`;
      const taken = await this.collections
        .createQueryBuilder('c')
        .where('lower(c.slug) = :slug', { slug })
        .getExists();
      if (!taken) return slug;
    }
    return `${padded}-${randomBytes(4).toString('hex')}`;
  }

  private cleanList(list?: string[]): string[] {
    return [
      ...new Set((list ?? []).map((s) => s.trim()).filter((s) => s.length > 0)),
    ];
  }

  /** Public, or the caller's own. Anything else is "not found", never "forbidden". */
  private async readableEntry(userId: number, id: string) {
    const row = await this.entries.findOne({ where: { id } });
    if (
      !row ||
      (row.visibility !== DirectoryVisibility.PUBLIC && row.ownerId !== userId)
    ) {
      throw new NotFoundException('Entry not found');
    }
    return row;
  }

  private async ownedEntry(userId: number, id: string) {
    const row = await this.readableEntry(userId, id);
    if (row.ownerId !== userId) {
      throw new ForbiddenException('You can only change entries you added');
    }
    return row;
  }

  private async ownedCollection(userId: number, id: string) {
    const row = await this.collections.findOne({ where: { id } });
    if (!row || row.ownerId !== userId) {
      throw new NotFoundException('Collection not found');
    }
    return row;
  }
}
