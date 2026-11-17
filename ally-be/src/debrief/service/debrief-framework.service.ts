import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { ClChunk } from '../../context-library/entity/cl-chunk.entity';
import {
  ClChunkOrigin,
  ClChunkStatus,
  ClCollectionId,
} from '../../context-library/enum/context-library.enum';
import { ContextChunkService } from '../../context-library/service/context-chunk.service';
import {
  DebriefSkillFramework,
  FOUNDATIONAL_FRAMEWORK,
  FOUNDATIONAL_FRAMEWORK_NAME,
  NO_FRAMEWORK,
  NO_FRAMEWORK_ID,
  SKILL_FRAMEWORK_KIND,
} from '../constants/debrief-framework.constants';
import {
  frameworkAttributes,
  frameworkFromChunk,
} from '../util/debrief-framework.util';

/** A framework as the Studio dropdown lists it. */
export interface DebriefFrameworkOption {
  /** The Context Library code, or `none`. Null is never listed: the default has its own code. */
  id: string;
  name: string;
  skills: number;
  isDefault: boolean;
}

/**
 * Skill frameworks, read from the Context Library (spec DEBRIEF_ACROSS_ROLEPLAYS §4). The 14
 * foundational helping skills are the first entry and the default; if that entry (or the one a
 * roleplay chose) cannot be read, the built-in copy of it answers, so a debrief never waits on it.
 */
@Injectable()
export class DebriefFrameworkService {
  private readonly logger = LoggerService.getInstance(
    DebriefFrameworkService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ClChunk) private readonly chunks: Repository<ClChunk>,
    private readonly chunkService: ContextChunkService,
  ) {}

  private async active(): Promise<ClChunk[]> {
    const rows = await this.chunks.find({
      where: {
        collectionId: ClCollectionId.DEBRIEF_GUIDANCE,
        status: ClChunkStatus.ACTIVE,
      },
      order: { code: 'ASC' },
    });
    return rows.filter((c) => c.facets?.kind === SKILL_FRAMEWORK_KIND);
  }

  /**
   * Makes sure the foundational entry exists (idempotent; serialised so two callers never both
   * create it). Returns it. Never throws: unreadable means the built-in copy answers.
   */
  async ensureSeed(): Promise<ClChunk | null> {
    try {
      const have = (await this.active()).find(
        (c) => c.statement.trim() === FOUNDATIONAL_FRAMEWORK_NAME,
      );
      if (have) return have;
      return await this.dataSource.transaction(async (m) => {
        await m.query(
          `SELECT pg_advisory_xact_lock(hashtext('debrief_framework_seed'))`,
        );
        const again = (await this.active()).find(
          (c) => c.statement.trim() === FOUNDATIONAL_FRAMEWORK_NAME,
        );
        if (again) return again;
        return this.chunkService.create({
          collectionId: ClCollectionId.DEBRIEF_GUIDANCE,
          origin: ClChunkOrigin.AUTHORED,
          statement: FOUNDATIONAL_FRAMEWORK_NAME,
          body:
            'The 14 foundational helping skills the Debrief has always assessed. ' +
            'One line per skill: key | name | words that identify it.',
          facets: { kind: SKILL_FRAMEWORK_KIND },
          attributes: frameworkAttributes(FOUNDATIONAL_FRAMEWORK),
          keywords: ['skill framework', 'foundational helping skills'],
          topics: [],
          pinned: false,
        });
      });
    } catch (e) {
      this.logger.warn(
        `[debrief] could not seed the foundational skill framework: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /** The frameworks a roleplay may choose, the default first, then "None". */
  async list(): Promise<DebriefFrameworkOption[]> {
    let rows = await this.active().catch(() => [] as ClChunk[]);
    if (!rows.some((c) => c.statement.trim() === FOUNDATIONAL_FRAMEWORK_NAME)) {
      await this.ensureSeed();
      rows = await this.active().catch(() => [] as ClChunk[]);
    }
    const out = rows.map((c) => {
      const f = frameworkFromChunk(c);
      return {
        id: c.code,
        name: f.name,
        skills: f.skills.length,
        isDefault: f.name === FOUNDATIONAL_FRAMEWORK_NAME,
      };
    });
    out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    return [
      ...out,
      { id: NO_FRAMEWORK_ID, name: 'None', skills: 0, isDefault: false },
    ];
  }

  /**
   * The framework a roleplay chose: its Context Library entry, `none`, or (unset or unreadable)
   * the foundational one. A framework that lists no skills reads as "none".
   */
  async resolve(id?: string | null): Promise<DebriefSkillFramework> {
    const choice = String(id ?? '').trim();
    if (choice === NO_FRAMEWORK_ID) return NO_FRAMEWORK;
    try {
      const rows = await this.active();
      if (choice) {
        const hit = rows.find((c) => c.code === choice);
        if (hit) return frameworkFromChunk(hit);
        this.logger.warn(
          `[debrief] skill framework ${choice} is not active; using the foundational one`,
        );
      }
      const base = rows.find(
        (c) => c.statement.trim() === FOUNDATIONAL_FRAMEWORK_NAME,
      );
      if (base) {
        const f = frameworkFromChunk(base);
        // An entry edited down to nothing must not silently turn the default off.
        if (f.skills.length) return f;
      }
    } catch (e) {
      this.logger.warn(
        `[debrief] skill frameworks unreadable, using the built-in one: ${(e as Error).message}`,
      );
    }
    return FOUNDATIONAL_FRAMEWORK;
  }
}
