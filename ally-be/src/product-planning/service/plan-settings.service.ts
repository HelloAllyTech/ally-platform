import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuilderSettings } from 'src/builder/entity/builder-settings.entity';
import {
  AUTO_RELEASE_HELD_PATHS_DEFAULT,
  PLANNING_DEFAULTS,
  ROADMAP_V2_DEFAULTS,
  RoadmapReleaseWindow,
} from '../constants/product-planning.constants';

export interface PlanSettings {
  enabled: boolean;
  ceilingUsd: number;
  ideaCeilingUsd: number;
  closeConfirmVotes: number;
}

/** The Roadmap v2 flag and the switches it brings (plans/roadmap-builder-merge). */
export interface RoadmapV2Settings {
  enabled: boolean;
  /** The plan ceiling every new idea starts with (planCeilingUsd). */
  ceilingUsd: number;
  maxLeadCeilingUsd: number;
  inProgressLimit: number;
  awaitingReviewAmberDays: number;
  /** Null means any time. */
  releaseWindow: RoadmapReleaseWindow | null;
  autoReleaseHeldPaths: string[];
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

  /**
   * Kept apart from `get()` on purpose: that one is the first plan flow's
   * settings (it was served as `GET product-roadmap/plans/settings`, since
   * retired), and its shape must not change while the flag is off.
   */
  async getRoadmapV2(): Promise<RoadmapV2Settings> {
    const row = await this.repository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    const positive = (value: unknown, fallback: number): number => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    return {
      enabled: row?.roadmapV2Enabled === true,
      ceilingUsd: positive(
        row?.planCeilingUsd,
        PLANNING_DEFAULTS.PLAN_CEILING_USD,
      ),
      maxLeadCeilingUsd: positive(
        row?.maxLeadCeilingUsd,
        ROADMAP_V2_DEFAULTS.MAX_LEAD_CEILING_USD,
      ),
      inProgressLimit: positive(
        row?.inProgressLimit,
        ROADMAP_V2_DEFAULTS.IN_PROGRESS_LIMIT,
      ),
      awaitingReviewAmberDays: positive(
        row?.awaitingReviewAmberDays,
        ROADMAP_V2_DEFAULTS.AWAITING_REVIEW_AMBER_DAYS,
      ),
      releaseWindow: row?.releaseWindow ?? null,
      autoReleaseHeldPaths: row?.autoReleaseHeldPaths?.length
        ? [...row.autoReleaseHeldPaths]
        : [...AUTO_RELEASE_HELD_PATHS_DEFAULT],
    };
  }

  /** Every `/v1/roadmap/*` route calls this first: 404 while the flag is off. */
  async assertRoadmapV2(): Promise<RoadmapV2Settings> {
    const settings = await this.getRoadmapV2();
    if (!settings.enabled) throw new NotFoundException();
    return settings;
  }

  async assertEnabled(): Promise<PlanSettings> {
    const settings = await this.get();
    if (!settings.enabled) {
      throw new NotFoundException('Planning is not switched on yet.');
    }
    return settings;
  }
}
