import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LoggerService } from 'src/logger/logger.service';
import { RoadmapOpportunityRepository } from 'src/product-roadmap/repository/roadmap-opportunity.repository';
import { RoadmapProductGoalRepository } from 'src/product-roadmap/repository/roadmap-taxonomy.repository';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import { PM_CONTEXT } from '../constants/pm-agent-pipeline.constants';
import { PmContextSource, PmSharedContext } from './pm-pipeline.types';

const oneLine = (text: string, max: number) => {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/**
 * The stable context every lane shares: the mandate (settings), the Vision & strategy page
 * (RoadmapStrategyContextService, the text the roadmap copilot reads), the product map
 * (BuilderProductMapService: repos, admin surfaces, knowledge packs, docs index), and the
 * roadmap itself — what is already planned, and the product goals an accepted card is filed
 * under. The first two are reached lazily through ModuleRef; everything fails soft: a run
 * without one of them is a weaker run, not a failed one.
 */
@Injectable()
export class PmAgentContextService implements PmContextSource {
  private readonly logger = LoggerService.getInstance(
    PmAgentContextService.name,
  );

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly opportunities: RoadmapOpportunityRepository,
    private readonly goals: RoadmapProductGoalRepository,
  ) {}

  async sharedContext(settings: PmAgentSettings): Promise<PmSharedContext> {
    const [strategy, productMap, roadmap, productGoals] = await Promise.all([
      this.strategy(),
      this.productMap(),
      this.roadmapDigest(),
      this.productGoals(),
    ]);
    return {
      mandate: settings.mandate ?? '',
      strategy,
      productMap,
      roadmap,
      productGoals,
    };
  }

  /**
   * One line per live opportunity, newest first: `OPP-123 [stage · goal] description…`.
   * Bugs are left out (Bug Hunter's findings are their own dedupe source). Archived ideas
   * stay in: they are decisions the team already made.
   */
  private async roadmapDigest(): Promise<string> {
    try {
      const rows = await this.opportunities
        .createQueryBuilder('o')
        .select(['o.code', 'o.stage', 'o.productGoal', 'o.description'])
        .where('o.type = :type', { type: 'idea' })
        .orderBy('o.createdAt', 'DESC')
        .take(PM_CONTEXT.ROADMAP_DIGEST_ITEMS)
        .getMany();
      const lines: string[] = [];
      let size = 0;
      for (const row of rows) {
        const line = `${row.code} [${row.stage} · ${oneLine(row.productGoal, 40)}] ${oneLine(
          row.description,
          PM_CONTEXT.ROADMAP_DIGEST_LINE_CHARS,
        )}`;
        if (size + line.length > PM_CONTEXT.ROADMAP_DIGEST_MAX_CHARS) break;
        lines.push(line);
        size += line.length + 1;
      }
      return lines.join('\n');
    } catch (error) {
      this.logger.warn(
        `[PM_AGENT] Roadmap digest unavailable: ${(error as Error)?.message}`,
      );
      return '';
    }
  }

  private async productGoals(): Promise<string[]> {
    try {
      return (await this.goals.findAllOrdered()).map((goal) => goal.name);
    } catch (error) {
      this.logger.warn(
        `[PM_AGENT] Product goals unavailable: ${(error as Error)?.message}`,
      );
      return [];
    }
  }

  private async strategy(): Promise<string> {
    try {
      const { RoadmapStrategyContextService } =
        await import('../../product-roadmap/service/roadmap-strategy-context.service');
      const service = this.moduleRef.get(RoadmapStrategyContextService, {
        strict: false,
      });
      return await service.renderForCopilot();
    } catch (error) {
      this.logger.warn(
        `[PM_AGENT] Strategy page unavailable: ${(error as Error)?.message}`,
      );
      return '';
    }
  }

  private async productMap(): Promise<string> {
    try {
      const { BuilderProductMapService } =
        await import('../../builder/service/builder-product-map.service');
      const service = this.moduleRef.get(BuilderProductMapService, {
        strict: false,
      });
      return await service.render();
    } catch (error) {
      this.logger.warn(
        `[PM_AGENT] Product map unavailable: ${(error as Error)?.message}`,
      );
      return '';
    }
  }
}
