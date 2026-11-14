import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuilderSettings } from 'src/builder/entity/builder-settings.entity';
import { PLANNING_DEFAULTS } from '../constants/product-planning.constants';

export interface PlanSettings {
  enabled: boolean;
  ceilingUsd: number;
  ideaCeilingUsd: number;
  closeConfirmVotes: number;
}

/**
 * The planning switches and limits, read from the Builder settings row.
 *
 * `assertEnabled` is what keeps unfinished phases dark: every plan route calls
 * it, and while `planningEnabled` is off they answer 404 rather than a half
 * working flow. One launch at the end (rev 5.2 decision 5).
 */
@Injectable()
export class PlanSettingsService {
  constructor(
    @InjectRepository(BuilderSettings)
    private readonly repository: Repository<BuilderSettings>,
  ) {}

  async get(): Promise<PlanSettings> {
    const row = await this.repository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    const ceiling =
      Number(row?.planCeilingUsd) || PLANNING_DEFAULTS.PLAN_CEILING_USD;
    return {
      enabled: row?.planningEnabled === true,
      ceilingUsd: ceiling,
      ideaCeilingUsd: Math.min(
        Number(row?.planIdeaCeilingUsd) || PLANNING_DEFAULTS.IDEA_CEILING_USD,
        ceiling,
      ),
      closeConfirmVotes:
        row?.planCloseConfirmVotes ??
        PLANNING_DEFAULTS.CLOSE_CONFIRM_VOTE_THRESHOLD,
    };
  }

  async assertEnabled(): Promise<PlanSettings> {
    const settings = await this.get();
    if (!settings.enabled) {
      throw new NotFoundException('Planning is not switched on yet.');
    }
    return settings;
  }
}
