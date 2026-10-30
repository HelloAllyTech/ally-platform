import {
  STAGE_DIRECTOR_MAIN_PROMPT_CODE,
  StageDirectorMemoriesService,
  WORKING_MEMORY_MAIN_PROMPT_CODE,
} from '../stage-director-memories.service';

const STATES = [
  { id: 's1', name: 'Guarded', guidelines: 'Defensive.' },
  { id: 's2', name: 'Opening up', guidelines: 'Talks about his father.' },
];
const SOURCES = [
  { id: 'k1', title: 'Job', content: 'Factory shifts.' },
  { id: 'k2', title: 'My father', content: 'He drank every night.' },
  { id: 'k3', title: 'Money', content: 'Debts.', unlocksFromStateId: 's2' },
];

function build(llmText: string | Error) {
  const promptSharedService = {
    getPromptByCode: jest.fn().mockResolvedValue('{{states}}\n{{memories}}'),
  };
  const llmCompletion = {
    complete:
      llmText instanceof Error
        ? jest.fn().mockRejectedValue(llmText)
        : jest.fn().mockResolvedValue({ text: llmText }),
  };
  const scenariosRepository = { find: jest.fn() };
  const scenarioService = { updateScenario: jest.fn().mockResolvedValue({}) };
  const service = new StageDirectorMemoriesService(
    promptSharedService as any,
    llmCompletion as any,
    scenariosRepository as any,
    scenarioService as any,
  );
  return { service, llmCompletion, scenariosRepository, scenarioService };
}

describe('StageDirectorMemoriesService.mapMemories', () => {
  it('assigns memories to the stage the model picks, keeping author locks', async () => {
    const { service } = build(
      JSON.stringify({
        assignments: [
          { id: 'k1', stateId: null },
          { id: 'k2', stateId: 's2' },
          { id: 'k3', stateId: null },
        ],
      }),
    );
    const { memories, mapped } = await service.mapMemories({
      knowledgeSources: SOURCES,
      states: STATES,
    });
    expect(mapped).toBe(true);
    expect(memories).toEqual([
      { id: 'k1', title: 'Job', content: 'Factory shifts.' },
      {
        id: 'k2',
        title: 'My father',
        content: 'He drank every night.',
        unlocksInStateIds: ['s2'],
      },
      // The author's own lock wins over the model's null.
      {
        id: 'k3',
        title: 'Money',
        content: 'Debts.',
        unlocksInStateIds: ['s2'],
      },
    ]);
  });

  it('keeps a plain fact from a held-back memory available from the start', async () => {
    const { service } = build(
      JSON.stringify({
        assignments: [
          {
            id: 'k2',
            stateId: 's2',
            publicFact:
              "I'm not married yet; my family is looking for a match.",
          },
          { id: 'k1', stateId: null, publicFact: 'ignored when not locked' },
        ],
      }),
    );
    const { memories } = await service.mapMemories({
      knowledgeSources: SOURCES.slice(0, 2),
      states: STATES,
    });
    expect(memories.map((m) => [m.title, m.unlocksInStateIds ?? null])).toEqual(
      [
        ['Job', null],
        ['My father (the basics)', null],
        ['My father', ['s2']],
      ],
    );
    expect(memories[1].content).toBe(
      "I'm not married yet; my family is looking for a match.",
    );
    expect(memories[1].id).not.toBe('k2');
  });

  it('ignores unknown and first-stage assignments', async () => {
    const { service } = build(
      JSON.stringify({
        assignments: [
          { id: 'k1', stateId: 's1' },
          { id: 'k2', stateId: 'nope' },
        ],
      }),
    );
    const { memories } = await service.mapMemories({
      knowledgeSources: SOURCES.slice(0, 2),
      states: STATES,
    });
    expect(memories.every((m) => !m.unlocksInStateIds)).toBe(true);
  });

  it('writes "from this stage on" out as every stage from there', async () => {
    const { service } = build(
      JSON.stringify({ assignments: [{ id: 'k2', stateId: 's2' }] }),
    );
    const { memories } = await service.mapMemories({
      knowledgeSources: SOURCES.slice(0, 2),
      states: [...STATES, { id: 's3', name: 'Trusting' }],
    });
    expect(memories[1].unlocksInStateIds).toEqual(['s2', 's3']);
  });

  it('copies knowledge sources as they are when the model fails', async () => {
    const { service } = build(new Error('timeout'));
    const { memories, mapped } = await service.mapMemories({
      knowledgeSources: SOURCES,
      states: STATES,
    });
    expect(mapped).toBe(false);
    expect(memories.map((m) => m.id)).toEqual(['k1', 'k2', 'k3']);
    expect(memories[2].unlocksFromStateId).toBe('s2');
  });

  it('does not call the model with fewer than two states', async () => {
    const { service, llmCompletion } = build('{}');
    const { memories } = await service.mapMemories({
      knowledgeSources: SOURCES,
      states: [STATES[0]],
    });
    expect(llmCompletion.complete).not.toHaveBeenCalled();
    expect(memories).toHaveLength(3);
  });
});

describe('StageDirectorMemoriesService.bulkSwitch', () => {
  const scenario = (id: number, metadata: Record<string, any>) => ({
    id,
    title: `S${id}`,
    prompt: 'role',
    metadata,
  });

  it('reports without writing on a dry run, and switches otherwise', async () => {
    const { service, scenariosRepository, scenarioService } = build(
      JSON.stringify({ assignments: [{ id: 'k2', stateId: 's2' }] }),
    );
    scenariosRepository.find.mockResolvedValue([
      scenario(1, {
        selectedMainPromptCode: WORKING_MEMORY_MAIN_PROMPT_CODE,
        states: STATES,
        knowledgeSources: SOURCES.slice(0, 2),
      }),
      scenario(2, { selectedMainPromptCode: 'other', states: STATES }),
      scenario(3, {
        selectedMainPromptCode: WORKING_MEMORY_MAIN_PROMPT_CODE,
        states: [STATES[0]],
      }),
    ]);

    const dry = await service.bulkSwitch({ userId: 9, dryRun: true });
    expect(scenarioService.updateScenario).not.toHaveBeenCalled();
    expect(dry.map((r) => [r.scenarioId, r.outcome])).toEqual([
      [1, 'would-switch'],
      [3, 'skipped'],
    ]);
    expect(dry[0].memories).toEqual([
      { title: 'Job', unlocksAt: null },
      { title: 'My father', unlocksAt: 'Opening up' },
    ]);

    await service.bulkSwitch({ userId: 9, dryRun: false });
    expect(scenarioService.updateScenario).toHaveBeenCalledTimes(1);
    const [id, dto, userId] = scenarioService.updateScenario.mock.calls[0];
    expect(id).toBe(1);
    expect(userId).toBe(9);
    expect(dto.selectedMainPromptCode).toBe(STAGE_DIRECTOR_MAIN_PROMPT_CODE);
    expect(dto.memories[1].unlocksInStateIds).toEqual(['s2']);
  });

  it('keeps memories a scenario already has instead of mapping again', async () => {
    const { service, scenariosRepository, llmCompletion, scenarioService } =
      build('{}');
    const tested = [{ id: 'k1', title: 'Job', unlocksFromStateId: 's2' }];
    scenariosRepository.find.mockResolvedValue([
      scenario(1, {
        selectedMainPromptCode: WORKING_MEMORY_MAIN_PROMPT_CODE,
        states: STATES,
        knowledgeSources: SOURCES,
        memories: tested,
      }),
    ]);
    await service.bulkSwitch({ userId: 1, dryRun: false });
    expect(llmCompletion.complete).not.toHaveBeenCalled();
    expect(scenarioService.updateScenario.mock.calls[0][1].memories).toBe(
      tested,
    );
  });
});
