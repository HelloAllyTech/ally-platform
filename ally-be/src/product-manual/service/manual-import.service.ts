import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MANUAL_IMPORT_MAX_PAGES } from '../constants/manual.constants';
import {
  ImportPage,
  ImportResult,
  ManualWriteError,
} from '../type/manual.types';
import { ManualPageService } from './manual-page.service';

/**
 * Bulk upsert by slug (how the manual's content gets in: it is never in git). Every page goes through
 * `ManualPageService.write()` as author `seed`, so it is scrubbed, revisioned and linked like any
 * other write but is not marked "ships in next release". A bad page is reported and skipped, never
 * aborting the batch. Parents may come after their children: `write()` does not need the parent to
 * exist yet, and links to a slug that does not exist yet are stored and light up once it does.
 */
@Injectable()
export class ManualImportService {
  private readonly logger = new Logger(ManualImportService.name);

  constructor(private readonly pages: ManualPageService) {}

  async import(
    pages: ImportPage[],
    userId: number | null,
  ): Promise<ImportResult> {
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new BadRequestException('pages must be a non-empty list.');
    }
    if (pages.length > MANUAL_IMPORT_MAX_PAGES) {
      throw new BadRequestException(
        `At most ${MANUAL_IMPORT_MAX_PAGES} pages per call; send the rest in another call.`,
      );
    }
    const result: ImportResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [],
    };
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const label = typeof page?.slug === 'string' ? page.slug : `#${i + 1}`;
      if (!page || typeof page !== 'object') {
        result.errors.push(`${label}: not a page object.`);
        continue;
      }
      try {
        const outcome = await this.pages.write(
          {
            slug: page.slug,
            title: page.title,
            summary: page.summary,
            body: page.body,
            parentSlug: page.parentSlug,
            position: page.position,
            kind: page.kind,
            roles: page.roles,
            surfaces: page.surfaces,
            journeys: page.journeys,
          },
          {
            kind: 'seed',
            ref: userId != null ? `import:${userId}` : 'import',
            reason: 'Imported',
          },
          userId,
        );
        if (outcome.created) result.created++;
        else if (outcome.changed) result.updated++;
        else result.unchanged++;
      } catch (error) {
        if (error instanceof ManualWriteError) {
          result.errors.push(`${label}: ${error.message}`);
        } else {
          this.logger.warn(
            `Import of ${label} failed: ${(error as Error)?.message}`,
          );
          result.errors.push(`${label}: could not be saved.`);
        }
      }
    }
    return result;
  }
}
