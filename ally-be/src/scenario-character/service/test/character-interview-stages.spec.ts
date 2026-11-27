import {
  languagesNotNamed,
  handsRestToAgent,
  CHARACTER_PILOT_MAX_QUESTIONS,
  characterQuestionRefusal,
  characterSaveRefusal,
  countCharacterStageQuestions,
  draftAgainstBrief,
  renderCharacterPilotStage,
  resolveCharacterPilotStage,
} from '../../util/character-pilot-stages.util';
import {
  characterPilotPosition,
  CharacterInterviewToolsService,
} from '../character-interview-tools.service';

const FULL = {
  kind: 'A college student overwhelmed by exams, for anxiety practice roleplays',
  name: 'Priya',
  age: 20,
  gender: 'female',
  profession: 'Engineering student',
  currentLocation: 'Pune',
  languageIds: ['1'],
  voices: { '1': 'voice-en' },
};

describe('resolveCharacterPilotStage', () => {
  it('walks kind → identity → life → voice → draft as the record fills', () => {
    expect(resolveCharacterPilotStage({}, {}).stage.id).toBe('kind');
    expect(resolveCharacterPilotStage({ kind: FULL.kind }, {}).stage.id).toBe(
      'identity',
    );
    const identity = {
      kind: FULL.kind,
      name: 'Priya',
      age: 20,
      gender: 'female',
    };
    expect(resolveCharacterPilotStage(identity, {}).stage.id).toBe('life');
    const life = {
      ...identity,
      profession: 'Student',
      currentLocation: 'Pune',
    };
    expect(resolveCharacterPilotStage(life, {}).stage.id).toBe('voice');
    expect(resolveCharacterPilotStage(FULL, {}).stage.id).toBe('draft');
  });

  it('holds the voice stage until every language has a voice', () => {
    const position = resolveCharacterPilotStage(
      { ...FULL, languageIds: ['1', '2'] },
      {},
    );
    expect(position.stage.id).toBe('voice');
    expect(position.missing).toEqual(['a voice for language 2']);
  });

  it('caps questions per stage and across the interview', () => {
    expect(resolveCharacterPilotStage({}, { kind: 2 }).questionsLeft).toBe(0);
    expect(
      resolveCharacterPilotStage(FULL, {
        kind: 2,
        identity: 3,
        life: 3,
        voice: 2,
      }).questionsLeft,
    ).toBe(Math.min(1, CHARACTER_PILOT_MAX_QUESTIONS - 10));
  });
});

describe('refusals, draft check and stage block', () => {
  it('refuses a question past the limit and a save before the end', () => {
    expect(
      characterQuestionRefusal(resolveCharacterPilotStage({}, {})),
    ).toBeNull();
    expect(
      characterQuestionRefusal(resolveCharacterPilotStage({}, { kind: 2 })),
    ).toMatch(/2-question limit for "Kind of character"/);
    expect(
      characterSaveRefusal(resolveCharacterPilotStage({ kind: 'x' }, {})),
    ).toMatch(/Identity/);
    expect(
      characterSaveRefusal(resolveCharacterPilotStage(FULL, {})),
    ).toBeNull();
  });

  it('requires the draft to carry every recorded language with its voice', () => {
    expect(
      draftAgainstBrief(
        { voices: { '1': 'voice-en' }, languageCharacteristics: { '1': 'x' } },
        FULL,
      ),
    ).toEqual([]);
    expect(
      draftAgainstBrief(
        { voices: {}, languageCharacteristics: {} },
        { ...FULL, languageIds: ['1'] },
      ),
    ).toEqual([
      'voices must include language 1 (recorded voice voice-en)',
      'languageCharacteristics must include language 1',
    ]);
  });

  it('shows the record and the stage to the agent', () => {
    const block = renderCharacterPilotStage(
      resolveCharacterPilotStage({ kind: 'x' }, {}),
      {
        kind: 'x',
      },
    );
    expect(block).toContain(
      '<character_stage id="identity" step="2 of 5" questions_left="3">',
    );
    expect(block).toContain('Recorded so far: {"kind":"x"}');
    expect(block).toContain('save_character_draft is not available yet');
  });

  it('counts tagged question cards per stage', () => {
    expect(
      countCharacterStageQuestions([
        { metadata: { questions: [{ stage: 'kind' }, { stage: 'identity' }] } },
        { metadata: { questions: [{ stage: 'kind' }, { id: 'old' }] } },
        { metadata: null },
      ]),
    ).toEqual({ kind: 2, identity: 1 });
  });
});

describe('CharacterInterviewToolsService with stages', () => {
  let update: jest.Mock;
  let service: CharacterInterviewToolsService;
  const context = (brief: any = {}, asked: Record<string, number> = {}) =>
    ({
      session: { id: 's1', metadata: { characterBrief: brief } },
      userId: 1,
      pilot: { asked },
    }) as any;

  beforeEach(() => {
    update = jest.fn().mockResolvedValue(undefined);
    service = new CharacterInterviewToolsService(
      { update } as any,
      {} as any,
      {} as any,
    );
  });

  it('adds record_character and keeps save_character_draft back until the end', () => {
    const names = (brief: any) =>
      service
        .getToolDefinitions({
          validatedTurns: true,
          position: characterPilotPosition(context(brief)),
        })
        .map((tool: any) => tool.name);
    expect(names({})).toContain('record_character');
    expect(names({})).not.toContain('save_character_draft');
    expect(names(FULL)).toContain('save_character_draft');
    // Stages off: the belt is as before.
    const off = service
      .getToolDefinitions({ validatedTurns: true })
      .map((t: any) => t.name);
    expect(off).toContain('save_character_draft');
    expect(off).not.toContain('record_character');
  });

  it('records several fields at once, rejects bad ones, and reports the next stage', async () => {
    const ctx = context();
    const out = await service.execute(
      'record_character',
      { kind: FULL.kind, name: 'Priya', age: 20, gender: 'woman' },
      ctx,
    );
    expect(out.modelResult.recorded).toEqual(['kind', 'name', 'age']);
    expect(out.modelResult.errors[0]).toMatch(/gender must be one of/);
    expect(out.modelResult.stage).toBe('Identity');
    expect(out.modelResult.stillNeeded).toEqual(['the gender']);
    expect(ctx.session.metadata.characterBrief).toMatchObject({
      name: 'Priya',
      age: 20,
    });
    expect(update).toHaveBeenCalledWith(
      { id: 's1' },
      {
        metadata: expect.objectContaining({
          characterBrief: expect.any(Object),
        }),
      },
    );
  });

  it('tags a question with its stage, refuses one past the limit, and refuses an early save', async () => {
    const ctx = context();
    const asked = await service.execute(
      'ask_question',
      { prompt: 'What kind of character?', kind: 'freeText' },
      ctx,
    );
    expect(asked.events?.[0].data.stage).toBe('kind');
    expect(ctx.pilot.asked).toEqual({ kind: 1 });

    const limited = await service.execute(
      'ask_question',
      { prompt: 'Another?', kind: 'freeText' },
      context({}, { kind: 2 }),
    );
    expect(limited.modelResult).toMatchObject({
      ok: false,
      error: 'question_limit',
    });

    const early = await service.execute(
      'save_character_draft',
      {},
      context({ kind: 'x' }),
    );
    expect(early.modelResult).toMatchObject({
      ok: false,
      error: 'stage_not_ready',
    });
  });
});

describe('languages without voices, and "you decide"', () => {
  it('lets a language with no catalogue voice through the voice stage and the draft check', () => {
    const urduOnly = {
      ...FULL,
      languageIds: ['9'],
      voices: {},
      unvoicedLanguageIds: ['9'],
    };
    expect(resolveCharacterPilotStage(urduOnly, {}).stage.id).toBe('draft');
    expect(
      draftAgainstBrief(
        { voices: {}, languageCharacteristics: { '9': 'x' } },
        urduOnly,
      ),
    ).toEqual([]);
  });

  it('spots the admin handing the rest to the agent', () => {
    for (const text of [
      'You decide.',
      "Use your defaults, don't ask me much.",
      'Decide anything else yourself.',
      'Just build it',
    ]) {
      expect(handsRestToAgent(text)).toBe(true);
    }
    expect(handsRestToAgent('She is 28 and a nurse.')).toBe(false);
  });

  it('refuses every question once the admin said to decide', () => {
    const position = resolveCharacterPilotStage({ kind: 'x' }, {});
    expect(position.questionsLeft).toBe(3);
    expect(
      characterQuestionRefusal(position, { kind: 'x', decideRest: true }),
    ).toMatch(/asked you to decide the rest yourself/);
  });
});

describe('languagesNotNamed', () => {
  const labels = new Map([
    ['1', 'English (India)'],
    ['2', 'Hindi (India)'],
    ['5', 'Marathi (India)'],
    ['13', 'English (US)'],
  ]);

  it('drops languages the admin never named', () => {
    expect(
      languagesNotNamed(
        ['1', '5', '2'],
        labels,
        'A student in Pune who speaks English.',
      ),
    ).toEqual(['5', '2']);
  });

  it('keeps languages typed or picked on a card', () => {
    expect(
      languagesNotNamed(['1', '2'], labels, 'English (India) — Hindi (India)'),
    ).toEqual([]);
  });

  it('allows one default language when none was named, and one variant per language', () => {
    expect(
      languagesNotNamed(['13', '2'], labels, 'A teen boy, bullied.'),
    ).toEqual(['2']);
    // None named: English is the default even when listed second.
    expect(
      languagesNotNamed(['2', '1'], labels, 'A grieving widower.'),
    ).toEqual(['2']);
    expect(
      languagesNotNamed(['1', '13'], labels, 'She speaks English.'),
    ).toEqual(['13']);
  });
});

describe('draft languages must be the recorded ones', () => {
  it('rejects a draft that adds a language the interview never recorded', () => {
    expect(
      draftAgainstBrief(
        {
          voices: { '1': 'v-en', '9': 'v-ml' },
          languageCharacteristics: { '1': 'x', '9': 'y' },
        },
        { ...FULL, languageIds: ['1'] },
      ),
    ).toEqual([
      'language 9 is not recorded: use only the recorded languages (1) in voices and languageCharacteristics',
    ]);
  });
});
