import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MANUAL_BUDGET_DEFAULT_USD,
  MANUAL_BUDGET_MAX_USD,
  MANUAL_BUDGET_MIN_USD,
} from '../constants/manual.constants';
import { ManualSettings } from '../entity/manual-settings.entity';
import type { ManualLastRun, ManualSettingsView } from '../type/manual.types';

export function toSettingsView(row: ManualSettings): ManualSettingsView {
  return {
    enabled: row.enabled === true,
    monthlyBudgetUsd: Number(row.monthlyBudgetUsd) || MANUAL_BUDGET_DEFAULT_USD,
    lastRunDate: row.lastRunDate ?? null,
    lastRun: row.lastRun ?? null,
    updatedBy: row.updatedBy ?? null,
    updatedAt: new Date(row.updatedAt ?? Date.now()).toISOString(),
  };
}

/** The singleton settings row (id = 1): off by default, a USD budget per IST month. */
@Injectable()
export class ManualSettingsService {
  constructor(
    @InjectRepository(ManualSettings)
    private readonly repository: Repository<ManualSettings>,
  ) {}

  private async row(): Promise<ManualSettings> {
    const found = await this.repository.findOne({ where: { id: 1 } });
    if (found) return found;
    // The migration seeds it; this only covers a database restored without it.
    await this.repository
      .createQueryBuilder()
      .insert()
      .values({ id: 1 })
      .orIgnore()
      .execute();
    return await this.repository.findOneOrFail({ where: { id: 1 } });
  }

  async get(): Promise<ManualSettingsView> {
    return toSettingsView(await this.row());
  }

  async update(
    patch: { enabled?: boolean; monthlyBudgetUsd?: number },
    userId: number,
  ): Promise<ManualSettingsView> {
    const row = await this.row();
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') {
        throw new BadRequestException('enabled must be true or false.');
      }
      row.enabled = patch.enabled;
    }
    if (patch.monthlyBudgetUsd !== undefined) {
      const usd = Number(patch.monthlyBudgetUsd);
      if (
        !Number.isFinite(usd) ||
        usd < MANUAL_BUDGET_MIN_USD ||
        usd > MANUAL_BUDGET_MAX_USD
      ) {
        throw new BadRequestException(
          `The monthly budget must be between ${MANUAL_BUDGET_MIN_USD} and ${MANUAL_BUDGET_MAX_USD} USD.`,
        );
      }
      row.monthlyBudgetUsd = usd.toFixed(2);
    }
    row.updatedBy = userId;
    row.updatedAt = new Date();
    return toSettingsView(await this.repository.save(row));
  }

  /**
   * For the weekly agent: leave a summary of the run on the row and, when a scheduled run claims its
   * week, the IST date it ran so a week runs once.
   */
  async recordLastRun(
    lastRun: ManualLastRun,
    lastRunDate?: string | null,
  ): Promise<void> {
    const patch: Partial<ManualSettings> = { lastRun, updatedAt: new Date() };
    if (lastRunDate !== undefined) patch.lastRunDate = lastRunDate;
    await this.repository.update({ id: 1 }, patch);
  }
}
