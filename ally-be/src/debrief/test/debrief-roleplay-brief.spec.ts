import {
  SCENARIO_METADATA_FIELDS,
  SCENARIO_ROOT_FIELDS,
} from '../../learn/util/scenario.util';
import {
  ROLEPLAY_FIELDS,
  ROLEPLAY_FIELDS_DEFAULT,
  ROLEPLAY_FIELDS_KEY,
  ROLEPLAY_OPTIONAL_KEYS,
} from '../constants/debrief-roleplay-fields.constants';
import {
  validateDebriefBundle,
  DEBRIEF_SEED_BUNDLE,
} from '../constants/debrief-release.constants';
import {
  enabledRoleplayKeys,
  parseRoleplayFields,
  readRoleplayFields,
  roleplayBrief,
  roleplayFieldSelect,
  roleplayFieldsCatalogue,
} from '../util/debrief-roleplay-brief.util';
import { sessionForGraph } from '../service/debrief-runner.service';
import {
  settingRefusal,
  settingValueOf,
  settingValueText,
} from '../util/debrief-pm-agent-rules.util';

describe('the roleplay-field registry is the one source of what a debrief reads', () => {
  it('only names fields the roleplay really has (a rename in the creation code fails here)', () => {
    for (const f of ROLEPLAY_FIELDS) {
      if (f.source.kind === 'column') {
        expect((SCENARIO_ROOT_FIELDS as string[]).includes(f.source.name)).toBe(
          true,
        );
      } else {
        expect(
          (SCENARIO_METADATA_FIELDS as string[]).includes(f.source.name),
        ).toBe(true);
      }
    }
  });

  it('has unique keys, always-on title and description, and no configuration fields', () => {
    const keys = ROLEPLAY_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ROLEPLAY_FIELDS.filter((f) => f.alwaysOn).map((f) => f.key)).toEqual(
      ['title', 'description'],
    );
    const names = ROLEPLAY_FIELDS.map((f) => f.source.name);
    for (const config of [
      'languageVoices',
      'sttConfigByLanguage',
      'comfortAudioUrl',
      'timerMode',
      'helperAgentPrompt',
    ]) {
      expect(names).not.toContain(config);
    }
    expect(ROLEPLAY_OPTIONAL_KEYS).toEqual(
      keys.filter((k) => k !== 'title' && k !== 'description'),
    );
  });

  it('builds the SELECT from the registry, one column per field', () => {
    const sql = roleplayFieldSelect('sc');
    for (const f of ROLEPLAY_FIELDS) expect(sql).toContain(`AS "rp_${f.key}"`);
    expect(sql).toContain(`sc.metadata->'characterProfileText'`);
    expect(sql).toContain(`sc."difficultyLevel"`);
  });
});

describe('the roleplay brief', () => {
  const row = {
    rp_title: ' Intake ',
    rp_description: 'A first call.',
    rp_difficulty: 'VERY_HARD',
    rp_characterProfile: 'Lives alone.',
    rp_clientDescription: '',
    rp_stages: [
      { stateId: '1', name: 'Opening' },
      { stateId: '2', name: ' ' },
      { stateId: '3', name: 'Disclosure' },
    ],
    rp_clientInstructions: 'Hide the plan until late.',
  };
  const values = readRoleplayFields(row);

  it('sends title, description and the default optional fields when a release names none', () => {
    expect(roleplayBrief(values)).toEqual({
      title: 'Intake',
      description: 'A first call.',
      difficulty_level: 'very hard',
    });
    expect([...ROLEPLAY_FIELDS_DEFAULT]).toEqual(['difficulty']);
  });

  it('adds only the optional fields the release has on, drops empty ones, and ignores unknown keys', () => {
    const out = roleplayBrief(values, [
      'characterProfile',
      'stages',
      'clientDescription',
      'nonsense',
    ]);
    expect(out).toEqual({
      title: 'Intake',
      description: 'A first call.',
      character_profile: 'Lives alone.',
      stage_names: ['Opening', 'Disclosure'],
    });
    // Difficulty is optional too: a release that lists none of it turns it off.
    expect(out).not.toHaveProperty('difficulty_level');
    expect(enabledRoleplayKeys([])).toEqual([]);
    expect(enabledRoleplayKeys('x')).toEqual([...ROLEPLAY_FIELDS_DEFAULT]);
  });

  it('caps a long field', () => {
    const long = readRoleplayFields({ rp_characterProfile: 'x'.repeat(9000) });
    expect(
      (roleplayBrief(long, ['characterProfile']).character_profile as string)
        .length,
    ).toBe(2500);
  });
});

describe('the roleplayFields setting the PM agent may propose', () => {
  it('accepts a list of known optional fields (or its JSON), and nothing else', () => {
    expect(parseRoleplayFields(['characterProfile', 'stages'])).toEqual([
      'characterProfile',
      'stages',
    ]);
    expect(parseRoleplayFields('["stages","stages"]')).toEqual(['stages']);
    expect(parseRoleplayFields([])).toEqual([]);
    for (const bad of [
      ['title'],
      ['made_up'],
      'not json',
      { a: 1 },
      5,
      null,
      undefined,
    ]) {
      expect(parseRoleplayFields(bad)).toBeNull();
    }
    expect(settingRefusal(ROLEPLAY_FIELDS_KEY, ['stages'])).toBeNull();
    expect(settingValueOf(ROLEPLAY_FIELDS_KEY, '["stages"]')).toEqual([
      'stages',
    ]);
    expect(settingValueText(ROLEPLAY_FIELDS_KEY, ['stages'])).toBe(
      '["stages"]',
    );
  });

  it('refuses a bad value with the catalogue so the PM agent can learn what exists', () => {
    const r = settingRefusal(ROLEPLAY_FIELDS_KEY, undefined);
    expect(r?.reason).toContain('characterProfile');
    expect(r?.reason).toContain('always read');
    expect(roleplayFieldsCatalogue()).toContain('difficulty (on by default)');
  });

  it('lists the setting among the ones the PM agent may change', () => {
    expect(settingRefusal('nonsense', 1)?.reason).toContain(
      ROLEPLAY_FIELDS_KEY,
    );
  });

  it('is checked in a release bundle', () => {
    const b = JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));
    b.settings.roleplayFields = ['stages'];
    expect(
      validateDebriefBundle(b).filter((p) => p.includes('roleplayFields')),
    ).toEqual([]);
    b.settings.roleplayFields = ['title'];
    expect(
      validateDebriefBundle(b).some((p) => p.includes('roleplayFields')),
    ).toBe(true);
  });
});

describe('what the graph is sent', () => {
  const session = {
    id: 's',
    tenantId: null,
    counselorId: 1,
    status: 'ENDED',
    language: 'en',
    learnerLevel: 'x',
    learnerTurns: 3,
    scenarioId: 5,
    scenario: { title: 'Old', description: 'Old' },
    roleplayFields: readRoleplayFields({
      rp_title: 'New',
      rp_description: 'A call.',
      rp_characterProfile: 'Lives alone.',
    }),
    expectedBehaviours: [],
    helpfulBehaviours: [],
    unhelpfulBehaviours: [],
    competencies: [],
    assessment: false,
    inCase: false,
    languageRecorded: true,
  } as any;

  it('builds the scenario block from the registry and the release’s setting', () => {
    expect(sessionForGraph(session).scenario).toEqual({
      title: 'New',
      description: 'A call.',
    });
    expect(sessionForGraph(session, ['characterProfile']).scenario).toEqual({
      title: 'New',
      description: 'A call.',
      character_profile: 'Lives alone.',
    });
  });

  it('keeps the old scenario block for a session read without the registry', () => {
    expect(
      sessionForGraph({ ...session, roleplayFields: undefined }).scenario,
    ).toEqual({ title: 'Old', description: 'Old' });
  });
});
