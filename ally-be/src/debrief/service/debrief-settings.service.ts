import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../../audit/service/audit-log.service';
import {
  defaultOwnerSettings,
  OWNER_SETTING_KEYS,
  OWNER_SETTINGS_SPEC,
  OwnerSettingKey,
  ownerSettingProblem,
  OwnerSettings,
  OwnerSettingsBaseline,
} from '../constants/debrief-owner-settings.constants';
import { DebriefOwnerSettings } from '../entity/debrief-owner-settings.entity';

/**
 * The debrief owner settings (v9 FR-60): every threshold of the PM agent's
 * test ladder and the learning budget. A person changes them, or accepts the
 * baseline job's proposal; nothing else does. Every change is audited with
 * its before and after (`DEBRIEF_SETTINGS_CHANGED`) and takes effect on the
 * next run that reads it.
 */
@Injectable()
export class DebriefSettingsService {
  constructor(
    @InjectRepository(DebriefOwnerSettings)
    private readonly rows: Repository<DebriefOwnerSettings>,
    private readonly audit: AuditLogService,
  ) {}

  private async row(): Promise<DebriefOwnerSettings> {
    const found = await this.rows.findOne({ where: { id: 1 } });
    if (found) return found;
    return this.rows.save(this.rows.create({ id: 1, values: {} }));
  }

  /** The settings in force: a person's values over the defaults. Never throws for a bad stored value. */
  async get(): Promise<OwnerSettings> {
    const stored = (await this.row()).values ?? {};
    const out = defaultOwnerSettings() as Record<string, number | boolean>;
    for (const key of OWNER_SETTING_KEYS) {
      if (key in stored && ownerSettingProblem(key, stored[key]) === null) {
        out[key] = stored[key];
      }
    }
    return out as OwnerSettings;
  }

  /** Everything the Console's settings page shows. */
  async view(): Promise<{
    values: OwnerSettings;
    defaults: OwnerSettings;
    spec: typeof OWNER_SETTINGS_SPEC;
    changed: OwnerSettingKey[];
    baseline: OwnerSettingsBaseline | null;
    updatedAt: Date;
    updatedBy: number | null;
  }> {
    const row = await this.row();
    return {
      values: await this.get(),
      defaults: defaultOwnerSettings(),
      spec: OWNER_SETTINGS_SPEC,
      changed: OWNER_SETTING_KEYS.filter((k) => k in (row.values ?? {})),
      baseline: (row.proposal as OwnerSettingsBaseline | null) ?? null,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? null,
    };
  }

  /**
   * A person changes settings. Every value is checked first and nothing is
   * written when any is refused. `null` returns a key to its default.
   */
  async update(
    changes: Record<string, number | boolean | null>,
    userId: number,
    source: 'edit' | 'baseline' = 'edit',
  ): Promise<OwnerSettings> {
    const entries = Object.entries(changes ?? {});
    if (entries.length === 0) {
      throw new BadRequestException('change at least one setting');
    }
    const problems = entries
      .filter(([, v]) => v !== null)
      .map(([k, v]) => ownerSettingProblem(k, v))
      .filter((p): p is string => !!p);
    const unknown = entries
      .filter(([k]) => !(k in OWNER_SETTINGS_SPEC))
      .map(([k]) => `${k} is not a setting`);
    if (problems.length || unknown.length) {
      throw new BadRequestException([...unknown, ...problems].join('; '));
    }
    const row = await this.row();
    const before = await this.get();
    const values = { ...(row.values ?? {}) };
    for (const [k, v] of entries) {
      if (v === null) delete values[k];
      else values[k] = v;
    }
    row.values = values;
    row.updatedBy = userId;
    await this.rows.save(row);
    const after = await this.get();
    const diff = Object.fromEntries(
      entries.map(([k]) => [
        k,
        {
          before: (before as Record<string, unknown>)[k],
          after: (after as Record<string, unknown>)[k],
        },
      ]),
    );
    await this.audit.log({
      eventType: 'DEBRIEF_SETTINGS_CHANGED',
      userId,
      details: { source, changes: diff },
    });
    return after;
  }

  /** The baseline job's latest proposal, stored beside the settings; never applied here. */
  async saveBaseline(baseline: OwnerSettingsBaseline): Promise<void> {
    const row = await this.row();
    row.proposal = baseline as unknown as Record<string, any>;
    row.proposedAt = new Date(baseline.ranAt);
    await this.rows.save(row);
  }

  /** A person accepts some of the baseline's proposed values. */
  async acceptBaseline(keys: string[], userId: number): Promise<OwnerSettings> {
    const baseline = (await this.row())
      .proposal as OwnerSettingsBaseline | null;
    if (!baseline) throw new BadRequestException('there is no proposal yet');
    const changes: Record<string, number | boolean> = {};
    for (const k of keys ?? []) {
      const p = baseline.proposals?.[k as OwnerSettingKey];
      if (!p) throw new BadRequestException(`${k} has no proposed value`);
      changes[k] = p.value;
    }
    return this.update(changes, userId, 'baseline');
  }
}
