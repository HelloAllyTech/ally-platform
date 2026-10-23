import { Injectable } from '@nestjs/common';
import { GlobalSettingsRepository } from 'src/settings/repository/global-settings.repository';
import { LoggerService } from 'src/logger/logger.service';

/** The `global_settings` row holding the Ally guide's kill switches. */
export const ALLY_GUIDE_SETTINGS_NAME = 'ally_guide';

/**
 * Kill switches (plans/ally-guide/plan.md §7.5). They sit OUTSIDE releases so
 * they act within one snapshot interval, and they fail CLOSED: a missing row,
 * a malformed value or a failed read all mean "guide off" and learners fall
 * back to the classic course experience, which is always the safety net.
 */
export interface GuideSwitches {
  /** Master switch. Off = /journey and the /course redirect serve classic. */
  enabled: boolean;
  /** Live chat for signed-out visitors (plan §2.1 decision 4). */
  anonymousChat: boolean;
  /** Voice conversations with Ally. */
  voice: boolean;
  /** Capability ids switched off everywhere (e.g. `consult_tutor`). */
  disabledCapabilities: string[];
  /** Tenants for which the guide is off. */
  disabledTenants: string[];
  /** Courses (track ids) for which the guide is off. */
  disabledCourses: string[];
}

export const DEFAULT_GUIDE_SWITCHES: GuideSwitches = {
  enabled: false,
  anonymousChat: false,
  voice: false,
  disabledCapabilities: [],
  disabledTenants: [],
  disabledCourses: [],
};

/** How long a read is reused. A flip takes effect within this window. */
export const GUIDE_SWITCHES_SNAPSHOT_MS = 30_000;

const BOOLEAN_KEYS = ['enabled', 'anonymousChat', 'voice'] as const;
const LIST_KEYS = [
  'disabledCapabilities',
  'disabledTenants',
  'disabledCourses',
] as const;

/** Keep only well-formed values; anything else falls back to the (closed) default. */
export function normaliseGuideSwitches(value: unknown): GuideSwitches {
  const source = (value && typeof value === 'object' ? value : {}) as Record<
    string,
    unknown
  >;
  const switches: GuideSwitches = { ...DEFAULT_GUIDE_SWITCHES };
  for (const key of BOOLEAN_KEYS) {
    if (typeof source[key] === 'boolean') switches[key] = source[key];
  }
  for (const key of LIST_KEYS) {
    const list = source[key];
    switches[key] = Array.isArray(list)
      ? [...new Set(list.filter((v): v is string => typeof v === 'string'))]
      : [];
  }
  return switches;
}

@Injectable()
export class GuideSettingsService {
  private readonly logger = LoggerService.getInstance(
    GuideSettingsService.name,
  );
  private cached: { value: GuideSwitches; readAt: number } | null = null;

  constructor(
    private readonly globalSettingsRepository: GlobalSettingsRepository,
  ) {}

  /** The current switches, re-read at most every GUIDE_SWITCHES_SNAPSHOT_MS. */
  async switches(): Promise<GuideSwitches> {
    if (
      this.cached &&
      Date.now() - this.cached.readAt < GUIDE_SWITCHES_SNAPSHOT_MS
    ) {
      return this.cached.value;
    }
    let value: GuideSwitches;
    try {
      const row = await this.globalSettingsRepository.findOne({
        where: { name: ALLY_GUIDE_SETTINGS_NAME },
      });
      value = normaliseGuideSwitches(row?.value);
    } catch (error) {
      // Fail closed, but do not cache the failure: the next request retries.
      this.logger.warn(
        `Ally guide switches unavailable; treating the guide as off: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { ...DEFAULT_GUIDE_SWITCHES };
    }
    this.cached = { value, readAt: Date.now() };
    return value;
  }

  /**
   * Whether the guided experience may serve this course (and, once known, this
   * tenant). Every negative answer means "show classic", never an error.
   */
  async isGuidedAvailable(
    trackId: string,
    tenantId?: string | null,
  ): Promise<boolean> {
    return (await this.unavailableReason(trackId, tenantId)) === null;
  }

  /** Why the guide is off here, or null when it is on (most general first). */
  async unavailableReason(
    trackId: string,
    tenantId?: string | null,
  ): Promise<'switched_off' | 'tenant_disabled' | 'course_disabled' | null> {
    const s = await this.switches();
    if (!s.enabled) return 'switched_off';
    if (tenantId && s.disabledTenants.includes(tenantId)) {
      return 'tenant_disabled';
    }
    if (s.disabledCourses.includes(trackId)) return 'course_disabled';
    return null;
  }

  async isCapabilityEnabled(capabilityId: string): Promise<boolean> {
    const s = await this.switches();
    return s.enabled && !s.disabledCapabilities.includes(capabilityId);
  }

  /** Merge a change over what is stored, so one switch never blanks another. */
  async update(
    patch: Partial<GuideSwitches>,
    userId: number,
  ): Promise<GuideSwitches> {
    const existing = await this.globalSettingsRepository.findOne({
      where: { name: ALLY_GUIDE_SETTINGS_NAME },
    });
    const merged = normaliseGuideSwitches({
      ...normaliseGuideSwitches(existing?.value),
      ...patch,
    });
    if (existing) {
      existing.value = merged;
      existing.updatedBy = userId;
      await this.globalSettingsRepository.save(existing);
    } else {
      await this.globalSettingsRepository.save(
        this.globalSettingsRepository.create({
          name: ALLY_GUIDE_SETTINGS_NAME,
          value: merged,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
    }
    this.logger.info(
      `Ally guide switches changed by user ${userId}: ${JSON.stringify(merged)}`,
    );
    this.cached = { value: merged, readAt: Date.now() };
    return merged;
  }
}
