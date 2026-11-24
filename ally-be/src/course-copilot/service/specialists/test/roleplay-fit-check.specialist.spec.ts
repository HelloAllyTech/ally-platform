import { readFileSync } from 'fs';
import { join } from 'path';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { COURSE_COPILOT_AI_TASKS } from '../../../constants/course-copilot.constants';
import { StructuredRoleplayBrief } from '../../../type/roleplay-brief.type';
import { CharacterProfile } from '../../course-copilot-library.service';
import {
  RoleplayFitCheckSpecialist,
  parseFitCheck,
} from '../roleplay-fit-check.specialist';

/** The real prompt file, so a renamed or dropped variable shows up here. */
const TEMPLATE = readFileSync(
  join(process.cwd(), 'src/prompts/course_copilot/roleplay_fit_check.txt'),
  'utf8',
);

const profile = (
  id: string,
  name: string,
  extra: Partial<CharacterProfile> = {},
): CharacterProfile => ({
  id,
  name,
  summary: '52, female, farmer, Mandya',
  profileText: `${name} profile`,
  hasVoices: true,
  ...extra,
});

const brief = (
  extra: Partial<StructuredRoleplayBrief> = {},
): StructuredRoleplayBrief => ({
  mode: 'practice',
  outcomes: ['Ask directly about suicide'],
  competencies: ['Suicide risk enquiry'],
  behaviours: {
    helpful: ['Asks directly about suicide'],
    unhelpful: ['Brushes off a mention of suicide'],
  },
  opportunities: ['Hints at not wanting to wake up'],
  learnerGoal: 'Find out whether she is thinking of ending her life',
  setting: 'A home visit in a village near Mandya',
  condition: { taskClass: 'guarded, one concern', difficulty: 'MEDIUM' },
  character: { characterId: 'gowramma' },
  gate: { minScore: 60 },
  lengthMinutes: 10,
  ...extra,
});

const scope = {
  sessionId: 'session-1',
  tenantId: 'tenant-1',
  competencyIds: ['c-1'],
  usageMetadata: { courseCopilotSessionId: 'session-1', jobId: 'job-1' },
};

describe('RoleplayFitCheckSpecialist', () => {
  let getPromptByCode: jest.Mock;
  let complete: jest.Mock;
  let characterProfiles: jest.Mock;
  let search: jest.Mock;
  let specialist: RoleplayFitCheckSpecialist;

  beforeEach(() => {
    getPromptByCode = jest.fn().mockResolvedValue(TEMPLATE);
    complete = jest.fn().mockResolvedValue({
      text: JSON.stringify({ fits: true, reason: 'ok' }),
    });
    characterProfiles = jest.fn(async (ids: string[]) =>
      ids.map((id) =>
        profile(id, id[0].toUpperCase() + id.slice(1), {
          hasVoices: id !== 'silent',
        }),
      ),
    );
    search = jest.fn().mockResolvedValue({
      hits: [{ id: 'gowramma' }, { id: 'silent' }, { id: 'lakshmamma' }],
      noConfidentMatch: false,
    });
    specialist = new RoleplayFitCheckSpecialist(
      { getPromptByCode } as any,
      { complete } as any,
      { characterProfiles, search } as any,
    );
  });

  describe('suggest (Agent Builder wizard)', () => {
    const wizardBrief = brief({
      character: { personaBrief: 'A 52-year-old farmer near Mandya' },
    });

    it('recommends the top hit when it fits, and says who the client should be', async () => {
      const result = await specialist.suggest(wizardBrief, scope);

      expect(result.characters.map((c) => c.id)).toEqual([
        'gowramma',
        'silent',
        'lakshmamma',
      ]);
      expect(result).toMatchObject({ recommendedId: 'gowramma', reason: 'ok' });
      expect(complete.mock.calls[0][0].prompt).toContain(
        'Who the client should be: A 52-year-old farmer near Mandya',
      );
    });

    it('recommends the best alternative, or none, when the top hit does not fit', async () => {
      complete.mockResolvedValueOnce({
        text: JSON.stringify({
          fits: false,
          reason: 'never discloses',
          alternativeIds: ['lakshmamma'],
        }),
      });
      expect((await specialist.suggest(wizardBrief, scope)).recommendedId).toBe(
        'lakshmamma',
      );

      complete.mockResolvedValueOnce({
        text: JSON.stringify({ fits: false, reason: 'no', alternativeIds: [] }),
      });
      expect(
        (await specialist.suggest(wizardBrief, scope)).recommendedId,
      ).toBeNull();
    });

    it('reports a failed search, and gives hits without a verdict when the check fails', async () => {
      search.mockRejectedValueOnce(new Error('index down'));
      expect(await specialist.suggest(wizardBrief, scope)).toMatchObject({
        characters: [],
        searchFailed: true,
      });

      complete.mockRejectedValueOnce(new Error('rate limited'));
      const result = await specialist.suggest(wizardBrief, scope);
      expect(result.characters).toHaveLength(3);
      expect(result.recommendedId).toBeNull();
    });
  });

  it('skips the check for a generated persona', async () => {
    const result = await specialist.cast(
      brief({ character: { personaBrief: 'An older farmer' } }),
      scope,
    );

    expect(result).toEqual({});
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps a character that fits, with the verdict', async () => {
    const result = await specialist.cast(brief(), scope);

    expect(result).toEqual({
      characterId: 'gowramma',
      fitCheck: {
        characterId: 'gowramma',
        fits: true,
        reason: 'ok',
        alternatives: [],
      },
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: COURSE_COPILOT_AI_TASKS.ROLEPLAY_FIT_CHECK,
        task: LlmTask.COURSE_COPILOT_ROLEPLAY_FIT_CHECK,
        jsonMode: true,
      }),
    );
  });

  it('renders the brief, the chosen character and the voiced alternatives first', async () => {
    await specialist.cast(brief(), scope);

    const prompt: string = complete.mock.calls[0][0].prompt;
    expect(prompt).toContain('Hints at not wanting to wake up');
    expect(prompt).toContain('id: gowramma');
    expect(prompt.indexOf('id: lakshmamma')).toBeLessThan(
      prompt.indexOf('id: silent'),
    );
    expect(prompt).not.toContain('{{');
    // The chosen character is never offered as its own alternative.
    expect(characterProfiles).toHaveBeenLastCalledWith([
      'silent',
      'lakshmamma',
    ]);
  });

  it('swaps in the best alternative when the character does not fit', async () => {
    complete.mockResolvedValue({
      text: JSON.stringify({
        fits: false,
        reason: 'Gowramma almost never discloses.',
        alternativeIds: ['lakshmamma', 'silent'],
      }),
    });

    const result = await specialist.cast(brief(), scope);

    expect(result.characterId).toBe('lakshmamma');
    expect(result.swapped).toEqual({
      fromCharacterId: 'gowramma',
      fromName: 'Gowramma',
      toCharacterId: 'lakshmamma',
      toName: 'Lakshmamma',
      reason: 'Gowramma almost never discloses.',
    });
  });

  it('keeps the character when it does not fit but nothing better exists', async () => {
    complete.mockResolvedValue({
      text: JSON.stringify({ fits: false, reason: 'No.', alternativeIds: [] }),
    });

    const result = await specialist.cast(brief(), scope);

    expect(result.characterId).toBe('gowramma');
    expect(result.swapped).toBeUndefined();
    expect(result.fitCheck?.fits).toBe(false);
  });

  it('still checks when the library search fails', async () => {
    search.mockRejectedValue(new Error('retrieval down'));

    const result = await specialist.cast(brief(), scope);

    expect(result.characterId).toBe('gowramma');
    expect(complete.mock.calls[0][0].prompt).toContain('(none)');
  });

  it('never fails the build: a model error keeps the chosen character', async () => {
    complete.mockRejectedValue(new Error('rate limited'));

    expect(await specialist.cast(brief(), scope)).toEqual({
      characterId: 'gowramma',
    });
  });

  it('drops a character the trainer can no longer see, so a new one is written', async () => {
    characterProfiles.mockResolvedValue([]);

    expect(await specialist.cast(brief(), scope)).toEqual({});
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('parseFitCheck', () => {
  const candidates = [profile('a', 'Asha'), profile('b', 'Bhavya')];

  it('drops alternatives it was not offered', () => {
    expect(
      parseFitCheck(
        JSON.stringify({
          fits: false,
          reason: 'r',
          alternativeIds: ['made-up', 'b', 'chosen'],
        }),
        'chosen',
        candidates,
      ).alternatives,
    ).toEqual([{ characterId: 'b', name: 'Bhavya' }]);
  });

  it('reads an unreadable answer as a fit, so nothing is swapped', () => {
    expect(parseFitCheck('not json', 'chosen', candidates)).toEqual({
      characterId: 'chosen',
      fits: true,
      reason: 'The character fits this roleplay.',
      alternatives: [],
    });
  });

  it('keeps at most two alternatives', () => {
    const three = [...candidates, profile('c', 'Chaya')];
    expect(
      parseFitCheck(
        JSON.stringify({ fits: false, alternativeIds: ['a', 'b', 'c'] }),
        'chosen',
        three,
      ).alternatives.map((a) => a.characterId),
    ).toEqual(['a', 'b']);
  });
});
