import { BadRequestException, Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import { PmCardCategory } from '../enum/pm-agent.enum';
import { PM_SETTINGS_LIMITS } from '../constants/pm-agent.constants';
import {
  PmSettingsResponse,
  UpdatePmAgentSettingsDto,
} from '../dto/pm-agent.dto';
import { PmAgentSettingsRepository } from '../repository/pm-agent.repositories';
import { PmAgentEventsService } from './pm-agent-events.service';

const CATEGORY_KEYS = new Set<string>(Object.values(PmCardCategory));

/**
 * The PM Agent's settings singleton. Validation lives here as well as on the DTO so a
 * caller that skips the ValidationPipe (a script, another service) gets the same rules:
 * queueCap 1..10, runHourIst 0..23, budget >= 0, weights only for known categories.
 */
@Injectable()
export class PmAgentSettingsService {
  private readonly logger = LoggerService.getInstance(
    PmAgentSettingsService.name,
  );

  constructor(
    private readonly repository: PmAgentSettingsRepository,
    private readonly events: PmAgentEventsService,
  ) {}

  get(): Promise<PmAgentSettings> {
    return this.repository.getSingleton();
  }

  async getResponse(): Promise<PmSettingsResponse> {
    return PmAgentSettingsService.toResponse(await this.get());
  }

  async update(
    userId: number,
    dto: UpdatePmAgentSettingsDto,
  ): Promise<PmSettingsResponse> {
    const patch = PmAgentSettingsService.validate(dto);
    if (!Object.keys(patch).length) return this.getResponse();
    const saved = await this.repository.patch({ ...patch, updatedBy: userId });
    this.logger.info(
      `[PM_AGENT] Settings changed by user ${userId}: ${Object.keys(patch).join(', ')}`,
    );
    this.events.stateUpdated();
    return PmAgentSettingsService.toResponse(saved);
  }

  /** Pure: the validated column patch, or a 400 naming the first bad field. */
  static validate(dto: UpdatePmAgentSettingsDto): Partial<PmAgentSettings> {
    const patch: Partial<PmAgentSettings> = {};
    const fail = (message: string): never => {
      throw new BadRequestException(message);
    };

    if (dto.enabled !== undefined) {
      if (typeof dto.enabled !== 'boolean') fail('enabled must be a boolean');
      patch.enabled = dto.enabled;
    }
    if (dto.monthlyBudgetUsd !== undefined) {
      const value = Number(dto.monthlyBudgetUsd);
      if (!Number.isFinite(value) || value < 0) {
        fail('monthlyBudgetUsd must be a number >= 0');
      }
      patch.monthlyBudgetUsd = value.toFixed(2);
    }
    if (dto.queueCap !== undefined) {
      const value = dto.queueCap;
      if (
        !Number.isInteger(value) ||
        value < PM_SETTINGS_LIMITS.QUEUE_CAP_MIN ||
        value > PM_SETTINGS_LIMITS.QUEUE_CAP_MAX
      ) {
        fail(
          `queueCap must be a whole number from ${PM_SETTINGS_LIMITS.QUEUE_CAP_MIN} to ${PM_SETTINGS_LIMITS.QUEUE_CAP_MAX}`,
        );
      }
      patch.queueCap = value;
    }
    if (dto.runHourIst !== undefined) {
      const value = dto.runHourIst;
      if (
        !Number.isInteger(value) ||
        value < PM_SETTINGS_LIMITS.RUN_HOUR_MIN ||
        value > PM_SETTINGS_LIMITS.RUN_HOUR_MAX
      ) {
        fail('runHourIst must be a whole hour from 0 to 23');
      }
      patch.runHourIst = value;
    }
    if (dto.mandate !== undefined) {
      if (typeof dto.mandate !== 'string') fail('mandate must be text');
      if (dto.mandate.length > PM_SETTINGS_LIMITS.MANDATE_MAX) {
        fail(
          `mandate must be at most ${PM_SETTINGS_LIMITS.MANDATE_MAX} characters`,
        );
      }
      patch.mandate = dto.mandate.trim();
    }
    if (dto.pauseAutoBuild !== undefined) {
      patch.pauseAutoBuild = Boolean(dto.pauseAutoBuild);
    }
    if (dto.slackNotify !== undefined) {
      patch.slackNotify = Boolean(dto.slackNotify);
    }
    if (dto.categoryWeights !== undefined) {
      if (dto.categoryWeights === null) {
        patch.categoryWeights = null;
      } else {
        const weights: Record<string, number> = {};
        for (const [key, raw] of Object.entries(dto.categoryWeights)) {
          if (!CATEGORY_KEYS.has(key)) fail(`Unknown category "${key}"`);
          const value = Number(raw);
          if (!Number.isFinite(value) || value < 0 || value > 10) {
            fail(`categoryWeights.${key} must be from 0 to 10`);
          }
          weights[key] = value;
        }
        patch.categoryWeights = weights;
      }
    }
    if (dto.autoBuildPaused !== undefined) {
      // Only the circuit breaker pauses; a person resumes.
      if (dto.autoBuildPaused) {
        fail(
          'autoBuildPaused can only be cleared here; use pauseAutoBuild to pause',
        );
      }
      Object.assign(patch, PmAgentSettingsService.resumePatch());
    }
    return patch;
  }

  /** Clearing the circuit breaker also resets its counter. */
  static resumePatch(): Partial<PmAgentSettings> {
    return {
      autoBuildPaused: false,
      autoBuildPausedReason: null,
      autoBuildPausedAt: null,
      consecutiveBuildFailures: 0,
    };
  }

  static toResponse(row: PmAgentSettings): PmSettingsResponse {
    return {
      enabled: row.enabled,
      monthlyBudgetUsd: Number(row.monthlyBudgetUsd),
      queueCap: row.queueCap,
      runHourIst: row.runHourIst,
      mandate: row.mandate ?? '',
      pauseAutoBuild: row.pauseAutoBuild,
      slackNotify: row.slackNotify,
      categoryWeights: row.categoryWeights ?? null,
      autoBuildPaused: row.autoBuildPaused,
      autoBuildPausedReason: row.autoBuildPausedReason ?? null,
      autoBuildPausedAt: row.autoBuildPausedAt
        ? new Date(row.autoBuildPausedAt).toISOString()
        : null,
      updatedAt: new Date(row.updatedAt ?? Date.now()).toISOString(),
    };
  }
}
