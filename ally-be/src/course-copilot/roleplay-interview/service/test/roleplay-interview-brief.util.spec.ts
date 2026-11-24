import {
  applyBriefPatch,
  buildQuestion,
  composeGeneration,
  shapeBriefPatch,
  stillNeeded,
  validatePlan,
} from '../../util/roleplay-interview-brief.util';
import { roleplayInterviewQuestionProblems } from '../../util/roleplay-interview-turn.util';
import { COMPLETE_BRIEF, PLAN_INPUT } from './roleplay-interview-fixtures';

describe('roleplay interview brief', () => {
  describe('stillNeeded', () => {
    it('lists every required field of an empty brief', () => {
      expect(stillNeeded({})).toEqual([
        'who the learners are',
        'what the learner should be able to do',
        'a competency',
        'the mode',
        'the client',
      ]);
    });

    it('is empty for a complete brief', () => {
      expect(stillNeeded(COMPLETE_BRIEF)).toEqual([]);
    });

    it('does not count a competency id the server has not named', () => {
      expect(
        stillNeeded({
          ...COMPLETE_BRIEF,
          competencyIds: ['x'],
          competencyNames: [],
        }),
      ).toEqual(['a competency']);
    });

    it('accepts a library character as the client', () => {
      expect(
        stillNeeded({ ...COMPLETE_BRIEF, client: { characterId: 'ch-1' } }),
      ).toEqual([]);
    });
  });

  describe('shapeBriefPatch', () => {
    it('merges learners and keeps the current character when only the description changes', () => {
      const current = {
        learners: { who: 'Nurses', priorExperience: 'some' },
        client: {
          description: 'old',
          characterId: 'ch-1',
          characterName: 'Asha',
        },
      };
      const shaped = shapeBriefPatch(
        { learners: { who: 'ASHA workers' }, client: { description: 'new' } },
        current,
      );
      expect(shaped.errors).toEqual([]);
      expect(shaped.fields.learners).toEqual({
        who: 'ASHA workers',
        priorExperience: 'some',
      });
      expect(shaped.fields.client).toEqual({
        description: 'new',
        characterId: 'ch-1',
        characterName: 'Asha',
      });
    });

    it('rejects a bad mode and a bad score, and reports unknown keys', () => {
      const shaped = shapeBriefPatch(
        { mode: 'expert', minScore: 140, colour: 'blue' },
        {},
      );
      expect(shaped.errors).toHaveLength(2);
      expect(shaped.ignoredKeys).toEqual(['colour']);
    });

    it('appends notes and clears a field set to null', () => {
      const current = { notes: ['a'], setting: 'clinic' };
      const shaped = shapeBriefPatch(
        { notes: ['b', 'a'], setting: null },
        current,
      );
      const next = applyBriefPatch(current, shaped.fields, shaped.clear);
      expect(next.notes).toEqual(['a', 'b']);
      expect(next.setting).toBeUndefined();
    });
  });

  describe('validatePlan', () => {
    it('accepts a complete plan and derives supports from the mode', () => {
      const result = validatePlan(PLAN_INPUT, COMPLETE_BRIEF, 3);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.version).toBe(3);
      expect(result.plan.supports).toEqual({
        experienceMode: 'FEEDBACK',
        remindersEnabled: true,
        currentState: true,
        supervisorNotesEnabled: false,
      });
    });

    it('gives an assessment no supports', () => {
      const result = validatePlan(
        PLAN_INPUT,
        { ...COMPLETE_BRIEF, mode: 'post_assessment' },
        1,
      );
      expect(result.ok && result.plan.supports.experienceMode).toBe('NONE');
    });

    it('uses the library character name over the model one', () => {
      const result = validatePlan(
        PLAN_INPUT,
        {
          ...COMPLETE_BRIEF,
          client: { characterId: 'ch-1', characterName: 'Asha' },
        },
        1,
      );
      expect(result.ok && result.plan.characterSheet.name).toBe('Asha');
    });

    it('lists what is wrong with a thin plan', () => {
      const result = validatePlan(
        { ...PLAN_INPUT, moments: ['one'], states: [], openingLine: '' },
        COMPLETE_BRIEF,
        1,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'moments needs 2-5 entries',
          'states needs 3-5 entries',
          'openingLine is required',
        ]),
      );
    });
  });

  describe('composeGeneration', () => {
    it('composes the actor description and test cases from the brief and plan', () => {
      const result = validatePlan(PLAN_INPUT, COMPLETE_BRIEF, 1);
      if (!result.ok) throw new Error('plan invalid');
      const generation = composeGeneration(COMPLETE_BRIEF, result.plan);
      expect(generation.competencyId).toBe(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(generation.competencyName).toBe('Risk assessment');
      expect(generation.mode).toBe('practice');
      expect(generation.minScore).toBe(60);
      expect(generation.states).toHaveLength(3);
      expect(generation.languages).toEqual(COMPLETE_BRIEF.languages);
      expect(generation.actorDescription).toContain(
        'A student who hints at not wanting to wake up',
      );
      expect(generation.actorDescription).toContain(
        'Setting: A late-night helpline call',
      );
      expect(generation.actorDescription).toContain(
        '- Hints at not wanting to wake up',
      );
      expect(generation.actorDescription).toContain(
        `Opening line: "I don't really know why I called."`,
      );
      expect(generation.actorDescription).toContain(
        '- Keep it under ten minutes',
      );
      expect(generation.agentTestCases).toBe(
        'Helpful behaviours:\n- Asks directly about suicide\n\nUnhelpful behaviours:\n- Changes the subject',
      );
    });
  });

  describe('question cards', () => {
    it('keeps one recommendation, drops duplicate ids and always allows a typed answer', () => {
      const question = buildQuestion({
        prompt: 'Which mode?',
        kind: 'singleSelect',
        allowCustom: false,
        options: [
          { id: 'learning', label: 'Learning', recommended: true },
          { id: 'practice', label: 'Practice', recommended: true },
          { id: 'practice', label: 'Duplicate' },
          'Performance',
        ],
      });
      expect(question.id).toEqual(expect.any(String));
      expect(question.allowCustom).toBe(true);
      expect(question.options).toEqual([
        { id: 'learning', label: 'Learning', recommended: true },
        { id: 'practice', label: 'Practice' },
        { id: 'Performance', label: 'Performance' },
      ]);
    });

    it('turns a select with no usable options into free text', () => {
      expect(
        buildQuestion({ prompt: 'x', kind: 'singleSelect', options: [] }).kind,
      ).toBe('freeText');
    });

    it('sends back an open question, too many options and a missing recommendation', () => {
      const keys = (input: Record<string, any>) =>
        roleplayInterviewQuestionProblems({
          name: 'ask_trainer',
          input,
          message: '',
        }).map((p) => p.key);
      expect(keys({ prompt: 'Who?', kind: 'freeText' })).toContain(
        'choice_only',
      );
      expect(
        keys({
          prompt: 'Which?',
          kind: 'singleSelect',
          options: [1, 2, 3, 4, 5].map((n) => ({ id: `${n}`, label: `${n}` })),
        }),
      ).toEqual(
        expect.arrayContaining(['too_many_options', 'no_recommendation']),
      );
      expect(
        keys({
          prompt: 'Which?',
          kind: 'singleSelect',
          options: [
            { id: 'a', label: 'A', recommended: true },
            { id: 'b', label: 'B' },
          ],
        }),
      ).toEqual([]);
      expect(
        roleplayInterviewQuestionProblems({
          name: 'finish_turn',
          input: {},
          message: 'x',
        }),
      ).toEqual([]);
    });
  });
});

describe('checks found in local test runs', () => {
  it('refuses a pass mark out of 10', () => {
    expect(shapeBriefPatch({ minScore: 4 }, {}).errors[0]).toMatch(
      /percentage out of 100/,
    );
    expect(shapeBriefPatch({ minScore: 60 }, {}).fields.minScore).toBe(60);
    expect(shapeBriefPatch({ minScore: 0 }, {}).fields.minScore).toBe(0);
  });

  it('refuses a character who is more than one person', () => {
    for (const name of [
      'Anita / Adit',
      'Anita or Adit',
      'Anita (gender-flexible)',
    ]) {
      const result = validatePlan(
        {
          ...PLAN_INPUT,
          characterSheet: { ...PLAN_INPUT.characterSheet, name },
        },
        { ...COMPLETE_BRIEF, client: { description: 'a caller' } },
        1,
      );
      expect(result.ok).toBe(false);
    }
  });

  it('refuses a summary posing as a moment, and a plan pass mark out of 10', () => {
    const summary = validatePlan(
      {
        ...PLAN_INPUT,
        moments: [...PLAN_INPUT.moments.slice(0, 2), 'Practises: asking'],
      },
      COMPLETE_BRIEF,
      1,
    );
    expect(summary.ok).toBe(false);
    const outOfTen = validatePlan(
      {
        ...PLAN_INPUT,
        passCriteria: { ...PLAN_INPUT.passCriteria, minScore: 7 },
      },
      COMPLETE_BRIEF,
      1,
    );
    expect(outOfTen.ok).toBe(false);
  });
});

describe('the language question', () => {
  it('may list the whole catalog and recommend several languages', () => {
    const options = Array.from({ length: 13 }, (_, i) => ({
      id: `l${i + 1}`,
      label: `Language ${i + 1}`,
      value: String(i + 1),
      recommended: i < 2,
    }));
    const question = buildQuestion({
      kind: 'multiSelect',
      prompt: 'Choose the languages and a voice for each',
      field: 'languageIds',
      options,
    });
    expect(question.field).toBe('languageIds');
    expect(question.options).toHaveLength(13);
    expect(question.options!.filter((o) => o.recommended)).toHaveLength(2);
    expect(
      roleplayInterviewQuestionProblems({
        name: 'ask_trainer',
        input: {
          kind: 'multiSelect',
          prompt: 'Choose',
          field: 'languageIds',
          options,
        },
        message: 'Pick the languages.',
      }).map((p) => p.key),
    ).not.toContain('too_many_options');
  });
});
