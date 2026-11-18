import { DebriefRoleplayDriftService } from '../service/debrief-roleplay-drift.service';
import {
  driftCountsSql,
  driftFindings,
  driftMessage,
  populatedSql,
} from '../util/debrief-roleplay-drift.util';
import { ROLEPLAY_FIELDS } from '../constants/debrief-roleplay-fields.constants';
import {
  roleplayFieldProblems,
  readRoleplayFields,
} from '../util/debrief-roleplay-brief.util';

/** A counts row: every field filled in on `earlier` of 100 earlier and `recent` of 40 recent. */
const row = (over: Record<string, number> = {}) => {
  const r: Record<string, number> = { earlier_total: 100, recent_total: 40 };
  for (const f of ROLEPLAY_FIELDS) {
    r[`e_${f.key}`] = 100;
    r[`r_${f.key}`] = 40;
  }
  return { ...r, ...over };
};

describe('roleplay-field drift', () => {
  it('finds nothing when recent roleplays fill the fields as earlier ones did', () => {
    expect(driftFindings(row())).toEqual([]);
  });

  it('finds a field that was common and newly saved roleplays stopped filling in', () => {
    const found = driftFindings(
      row({ e_characterProfile: 60, r_characterProfile: 1 }),
    );
    expect(found).toEqual([
      {
        key: 'characterProfile',
        label: 'Character profile',
        earlierShare: 0.6,
        recentShare: 0.025,
      },
    ]);
  });

  it('ignores a field that was rare, a small drop, and too small a sample', () => {
    expect(driftFindings(row({ e_stages: 10, r_stages: 0 }))).toEqual([]);
    expect(driftFindings(row({ e_stages: 60, r_stages: 20 }))).toEqual([]);
    expect(
      driftFindings(row({ earlier_total: 5, e_stages: 5, r_stages: 0 })),
    ).toEqual([]);
    expect(driftFindings(row({ recent_total: 3, r_stages: 0 }))).toEqual([]);
  });

  it('says what it saw and where to look, in plain words', () => {
    const m = driftMessage(
      driftFindings(row({ e_characterProfile: 60, r_characterProfile: 1 })),
    );
    expect(m.title).toMatch(/renamed or reshaped/);
    expect(m.body).toContain(
      'Character profile: filled in on 60% of earlier roleplays, 3% of those saved in the last 30 days',
    );
    expect(m.body).toContain('debrief-roleplay-fields.constants.ts');
  });

  it('builds the counts query from the registry: one pair of counts per field', () => {
    const sql = driftCountsSql();
    for (const f of ROLEPLAY_FIELDS) {
      expect(sql).toContain(`AS "r_${f.key}"`);
      expect(sql).toContain(`AS "e_${f.key}"`);
    }
    expect(
      populatedSql(ROLEPLAY_FIELDS.find((f) => f.key === 'stages')!),
    ).toContain('jsonb_array_length');
    expect(sql).toContain('"deletedAt" IS NULL');
  });
});

describe('the daily check', () => {
  const build = (r: Record<string, number>) => {
    const dataSource = { query: jest.fn(async () => [r]) } as any;
    const notifier = { team: jest.fn(async () => 1) } as any;
    return {
      svc: new DebriefRoleplayDriftService(dataSource, notifier),
      notifier,
    };
  };
  const drifted = row({ e_characterProfile: 60, r_characterProfile: 1 });

  it('tells the team once about a drifted field, not every day', async () => {
    const { svc, notifier } = build(drifted);
    expect(await svc.check(1_000)).toBe(1);
    expect(notifier.team).toHaveBeenCalledTimes(1);
    expect(notifier.team.mock.calls[0][0].title).toMatch(/renamed or reshaped/);
    expect(await svc.check(1_000 + 86_400_000)).toBe(1);
    expect(notifier.team).toHaveBeenCalledTimes(1);
    // A week later it is still drifted, so it is said again.
    await svc.check(1_000 + 8 * 86_400_000);
    expect(notifier.team).toHaveBeenCalledTimes(2);
  });

  it('says nothing when nothing drifted', async () => {
    const { svc, notifier } = build(row());
    expect(await svc.check()).toBe(0);
    expect(notifier.team).not.toHaveBeenCalled();
  });
});

describe('a roleplay field in the wrong shape', () => {
  it('is named, with what was expected, and only for fields the release reads', () => {
    const values = readRoleplayFields({
      rp_title: 'T',
      rp_description: 5,
      rp_characterProfile: { text: 'x' },
      rp_stages: [{ stateId: '1' }],
      rp_difficulty: 'EASY',
    });
    expect(
      roleplayFieldProblems(values, ['characterProfile', 'stages']),
    ).toEqual([
      { key: 'description', label: 'Description', why: 'expected text' },
      {
        key: 'characterProfile',
        label: 'Character profile',
        why: 'expected text',
      },
      {
        key: 'stages',
        label: 'Stages of the roleplay',
        why: 'expected a list of stages, each with a name',
      },
    ]);
    // A field the release does not read is not checked, and an empty one is fine.
    expect(
      roleplayFieldProblems(
        readRoleplayFields({ rp_title: 'T', rp_description: 'd' }),
        [],
      ),
    ).toEqual([]);
  });
});
