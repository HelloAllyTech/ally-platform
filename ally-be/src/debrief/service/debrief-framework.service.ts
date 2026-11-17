import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { ClChunk } from '../../context-library/entity/cl-chunk.entity';
import {
  ClChunkStatus,
  ClCollectionId,
} from '../../context-library/enum/context-library.enum';
import {
  DebriefSkillFramework,
  SKILL_FRAMEWORK_KIND,
  emptyFramework,
} from '../constants/debrief-framework.constants';
import {
  frameworkFromChunk,
  mergeFrameworks,
} from '../util/debrief-framework.util';

/**
 * Skill frameworks, read from the Context Library (spec DEBRIEF_ACROSS_ROLEPLAYS §4). Nothing is
 * hardcoded or seeded: the frameworks of a run are every active `skill_framework` entry the
 * learner's organisation can read. A person edits or deletes an entry in the library, no deploy.
 */
@Injectable()
export class DebriefFrameworkService {
  private readonly logger = LoggerService.getInstance(
    DebriefFrameworkService.name,
  );

  constructor(
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
  ) {}

  /**
   * The one framework for a run: the merged active entries visible to the tenant (the library's
   * own audience rule: global, or the tenant listed in `tenantIds`). No entries or an unreadable
   * library is the empty framework, i.e. only the roleplay's own competencies. Never throws.
   */
  async forTenant(tenantId?: string | null): Promise<DebriefSkillFramework> {
    try {
      const rows = await this.chunks.find({
        where: {
          collectionId: ClCollectionId.DEBRIEF_GUIDANCE,
          status: ClChunkStatus.ACTIVE,
        },
        order: { code: 'ASC' },
      });
      const tenant = String(tenantId ?? '');
      const visible = rows.filter(
        (c) =>
          c.facets?.kind === SKILL_FRAMEWORK_KIND &&
          (c.isGlobal === true ||
            (!!tenant && (c.tenantIds ?? []).includes(tenant))),
      );
      return mergeFrameworks(visible.map(frameworkFromChunk));
    } catch (e) {
      this.logger.warn(
        `[debrief] skill frameworks unreadable, running without one: ${(e as Error).message}`,
      );
      return emptyFramework();
    }
  }
}
