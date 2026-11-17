import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LoggerService } from 'src/logger/logger.service';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import { PmContextSource, PmSharedContext } from './pm-pipeline.types';

/**
 * The stable context every lane shares: the mandate (settings), the Vision & strategy page
 * (RoadmapStrategyContextService, the text the roadmap copilot reads) and the product map
 * (BuilderProductMapService: repos, admin surfaces, knowledge packs, docs index). Both are
 * reached lazily through ModuleRef, like PmAgentBuilderPort, and fail soft: a run without the
 * product map is a weaker run, not a failed one.
 */
@Injectable()
export class PmAgentContextService implements PmContextSource {
  private readonly logger = LoggerService.getInstance(
    PmAgentContextService.name,
  );

  constructor(private readonly moduleRef: ModuleRef) {}

  async sharedContext(settings: PmAgentSettings): Promise<PmSharedContext> {
    const [strategy, productMap] = await Promise.all([
      this.strategy(),
      this.productMap(),
    ]);
    return { mandate: settings.mandate ?? '', strategy, productMap };
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
