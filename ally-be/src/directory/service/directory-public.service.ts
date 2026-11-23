import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DEFAULT_COLLECTION_SETTINGS,
  DirectoryCollection,
} from '../entity/directory-collection.entity';
import { DirectoryService } from './directory.service';

/**
 * What a visitor to a collection's landing page gets. Nothing here is keyed on a user: a page
 * that is unpublished, or a domain that is not verified, answers 404 exactly like one that does
 * not exist. Entry owners are never named; contact details are dropped when the owner hides them.
 */
@Injectable()
export class DirectoryPublicService {
  constructor(
    @InjectRepository(DirectoryCollection)
    private readonly collections: Repository<DirectoryCollection>,
    private readonly directory: DirectoryService,
  ) {}

  async bySlug(slug: string) {
    const row = await this.collections
      .createQueryBuilder('c')
      .where('lower(c.slug) = :slug AND c.published = true', {
        slug: slug.toLowerCase(),
      })
      .getOne();
    return this.view(row);
  }

  async byDomain(host: string) {
    const domain = host.trim().toLowerCase().replace(/:\d+$/, '');
    const row = domain
      ? await this.collections
          .createQueryBuilder('c')
          .where(
            'lower(c.custom_domain) = :domain AND c.published = true AND c.domain_verified_at IS NOT NULL',
            { domain },
          )
          .getOne()
      : null;
    return this.view(row);
  }

  /** For the TLS front door's on-demand certificate check: only verified, published domains. */
  async domainIsServed(host: string): Promise<boolean> {
    try {
      await this.byDomain(host);
      return true;
    } catch {
      return false;
    }
  }

  private async view(row: DirectoryCollection | null) {
    if (!row) throw new NotFoundException('Page not found');
    const settings = { ...DEFAULT_COLLECTION_SETTINGS, ...row.settings };
    const entries = await this.directory.visibleEntries(row);
    return {
      name: row.name,
      description: row.description,
      slug: row.slug,
      settings,
      entries: entries.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        category: e.category,
        organization: e.organization,
        websiteUrl: e.websiteUrl,
        city: e.city,
        region: e.region,
        country: e.country,
        tags: e.tags,
        languages: e.languages,
        ...(settings.showContactDetails
          ? { phone: e.phone, email: e.email, address: e.address }
          : {}),
      })),
    };
  }
}
