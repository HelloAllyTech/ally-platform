import { validateSimulationStates } from '../validate-simulation-states.util';
import {
  checkBuiltRoleplay,
  layOutRoleplayStates,
  MIN_STATE_BAND,
  repairBuiltRoleplay,
} from '../roleplay-design.util';

const rupture = { name: 'Pulling away', guidelines: 'Withdraw.' };
const positive = [
  { name: 'Guarded', guidelines: 'Short answers.', ragEnabled: false },
  { name: 'Opening up', guidelines: 'Share more.', ragEnabled: true },
  { name: 'Trusting', guidelines: 'Say the real worry.', ragEnabled: true },
];

describe('layOutRoleplayStates', () => {
  it('puts a rupture state below 0, the opening state at 0, and contiguous bands', () => {
    const states = layOutRoleplayStates(positive, { bandWidth: 70, rupture });

    expect(states.map((s) => [s.name, s.scoreLower, s.scoreUpper])).toEqual([
      ['Pulling away', -140, 0],
      ['Guarded', 0, 70],
      ['Opening up', 70, 140],
      ['Trusting', 140, 210],
    ]);
    expect(validateSimulationStates(states)).toEqual([]);
    expect(states[0].ragEnabled).toBe(false);
    expect(new Set(states.map((s) => s.id)).size).toBe(4);
  });

  it('never makes a band narrower than the Studio allows', () => {
    const states = layOutRoleplayStates(positive, { bandWidth: 10, rupture });
    expect(states[1].scoreUpper! - states[1].scoreLower!).toBe(MIN_STATE_BAND);
  });

  it('returns nothing when there are no usable states', () => {
    expect(
      layOutRoleplayStates([{ name: ' ', guidelines: 'x', ragEnabled: true }], {
        bandWidth: 50,
        rupture,
      }),
    ).toEqual([]);
  });
});

describe('checkBuiltRoleplay / repairBuiltRoleplay', () => {
  const complete = {
    title: 'T',
    prompt: 'Role',
    competencyId: 'c1',
    languageVoices: [{}],
    openingStatements: ['Hi'],
    reminders: ['Listen'],
    remindersEnabled: true,
    states: layOutRoleplayStates(positive, { bandWidth: 50, rupture }),
    selectedMainPromptCode: 'ally_ai_learn_system_main_agent_prompt_full',
  };

  it('passes a complete roleplay', () => {
    expect(checkBuiltRoleplay(complete)).toEqual({ fixable: [], reported: [] });
  });

  it('hides reminders that are switched on but empty', () => {
    const dto = { ...complete, reminders: [] };
    const { fixable } = checkBuiltRoleplay(dto);
    expect(fixable).toEqual(['reminders_empty']);
    expect(repairBuiltRoleplay(dto, fixable)).toEqual([
      'reminders hidden (none were written)',
    ]);
    expect(dto.remindersEnabled).toBe(false);
  });

  it('drops states that no main prompt will read', () => {
    const dto = { ...complete, selectedMainPromptCode: undefined };
    const { fixable } = checkBuiltRoleplay(dto);
    expect(fixable).toEqual(['states_without_prompt']);
    repairBuiltRoleplay(dto, fixable);
    expect(dto.states).toEqual([]);
  });

  it('accepts voices as a language → voice map and opening lines in another language', () => {
    expect(
      checkBuiltRoleplay({
        ...complete,
        languageVoices: { '13': 'voice-1' } as any,
        openingStatements: undefined,
        translationOpeningStatements: { '13': ['Hi.'] },
      }).reported,
    ).toEqual([]);
  });

  it('reports what it cannot repair', () => {
    expect(
      checkBuiltRoleplay({
        ...complete,
        openingStatements: [],
        languageVoices: [],
      }).reported,
    ).toEqual(['no voiced language', 'no opening lines']);
  });
});

describe('mode rules', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const util = require('../roleplay-design.util');

  it('fades supports from learning to practice to performance', () => {
    const p = 'ally_ai_learn_system_main_agent_prompt_full';
    expect(util.roleplaySettingsForMode('learning', p)).toEqual({
      experienceMode: 'FEEDBACK',
      remindersEnabled: true,
      currentState: true,
      supervisorNotesEnabled: true,
      selectedMainPromptCode: p,
    });
    expect(util.roleplaySettingsForMode('practice', p)).toMatchObject({
      remindersEnabled: true,
      supervisorNotesEnabled: false,
    });
    expect(util.roleplaySettingsForMode('post_assessment', null)).toEqual({
      experienceMode: 'NONE',
      remindersEnabled: false,
      currentState: false,
      supervisorNotesEnabled: false,
    });
  });

  it('widens the bands as the mode gets harder, with a rupture state', () => {
    expect(util.stateDesignForMode('learning').bandWidth).toBe(50);
    expect(util.stateDesignForMode('practice').bandWidth).toBe(70);
    expect(util.stateDesignForMode('performance').bandWidth).toBe(100);
    expect(util.stateDesignForMode('learning').rupture.name).toBe(
      'Pulling away',
    );
  });
});
