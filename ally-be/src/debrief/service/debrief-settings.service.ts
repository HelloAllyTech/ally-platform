import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from '../../audit/service/audit-log.service';
import {
  defaultOwnerSettings,
  OWNER_SETTING_KEYS,
  OWNER_SETTINGS_SPEC,
  OwnerSettingChange,
  OwnerSettingKey,
  ownerSettingProblem,
  OwnerSettings,
  OwnerSettingsBaseline,
} from '../constants/debrief-owner-settings.constants';

/** A value a setting can hold. */
export type OwnerSettingValue = number | boolean | string;

/** Who made a change: a person, or the PM agent (v2 A10) with its reason. */
export interface OwnerSettingsChangeSource {
  source?: 'edit' | 'baseline' | 'pm_agent' | 'undo';
  /** Why, in words (the PM agent's reason; a person's note). */
  why?: string | null;
  /** The change (idea) the values belong to. */
  changeId?: string | null;
}
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
    const out = defaultOwnerSettings() as Record<string, OwnerSettingValue>;
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
    /** Settings › Tests: who last changed each setting, when, why, and its change. */
    lastChanges: Partial<Record<OwnerSettingKey, OwnerSettingChange>>;
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
      lastChanges: await this.withNames(lastChangesOf(row.changes)),
    };
  }

  /** A person's change shows their name ("PM agent" for the agent's). */
  private async withNames(
    changes: Partial<Record<OwnerSettingKey, OwnerSettingChange>>,
  ): Promise<Partial<Record<OwnerSettingKey, OwnerSettingChange>>> {
    const ids = [
      ...new Set(
        Object.values(changes)
          .filter(
            (c) => c && c.lastChangedBy === 'A person' && c.lastChangedById,
          )
          .map((c) => c!.lastChangedById as number),
      ),
    ];
    if (!ids.length) return changes;
    try {
      const users: Array<{ id: number; name: string | null }> =
        await this.rows.manager.query(
          `SELECT id, COALESCE(NULLIF(TRIM(name), ''), email) AS name FROM users WHERE id = ANY($1::int[])`,
          [ids],
        );
      const names = new Map(users.map((u) => [Number(u.id), u.name]));
      for (const c of Object.values(changes)) {
        if (c && c.lastChangedBy === 'A person' && c.lastChangedById) {
          c.lastChangedBy = names.get(c.lastChangedById) ?? 'A person';
        }
      }
    } catch {
      // Names are a nicety: the change is still shown.
    }
    return changes;
  }

  /**
   * A person changes settings. Every value is checked first and nothing is
   * written when any is refused. `null` returns a key to its default.
   */
  async update(
    changes: Record<string, OwnerSettingValue | null>,
    userId: number | null,
    from:
      | OwnerSettingsChangeSource['source']
      | OwnerSettingsChangeSource = 'edit',
  ): Promise<OwnerSettings> {
    const by: OwnerSettingsChangeSource =
      typeof from === 'string' || from == null ? { source: from } : from;
    const source = by.source ?? 'edit';
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
    const at = new Date().toISOString();
    const name = source === 'pm_agent' ? 'Debrief PM agent' : null;
    row.changes = {
      ...(row.changes ?? {}),
      ...Object.fromEntries(
        entries.map(([k]) => [
          k,
          {
            by: name,
            byId: userId,
            at,
            why: by.why ?? null,
            changeId: by.changeId ?? null,
          },
        ]),
      ),
    };
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
      userId: userId ?? undefined,
      details: {
        source,
        changes: diff,
        ...(by.why ? { why: by.why } : {}),
        ...(by.changeId ? { changeId: by.changeId } : {}),
      },
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
    const changes: Record<string, OwnerSettingValue> = {};
    for (const k of keys ?? []) {
      const p = baseline.proposals?.[k as OwnerSettingKey];
      if (!p) throw new BadRequestException(`${k} has no proposed value`);
      changes[k] = p.value;
    }
    return this.update(changes, userId, 'baseline');
  }
}

/** The stored change log, read leniently; a person's name is filled in by the view. */
export function lastChangesOf(
  stored: Record<string, any> | null | undefined,
): Partial<Record<OwnerSettingKey, OwnerSettingChange>> {
  const out: Partial<Record<OwnerSettingKey, OwnerSettingChange>> = {};
  for (const key of OWNER_SETTING_KEYS) {
    const c = stored?.[key];
    if (!c || typeof c.at !== 'string') continue;
    out[key] = {
      lastChangedBy: c.by ?? 'A person',
      lastChangedById: c.byId != null ? Number(c.byId) : null,
      lastChangedAt: c.at,
      why: c.why ?? null,
      changeId: c.changeId ?? null,
    };
  }
  return out;
}
