import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  RoleplayAgentRequest,
  RoleplayAgentRun,
  RoleplayAgentService,
} from '../roleplay-agent.service';
import { SpecialistValidationError } from '../specialists/specialist.types';

const request: RoleplayAgentRequest = {
  learners: 'Secondary-school teachers new to mental health',
  goal: 'Ask a withdrawn student about suicide and refer them',
  competencyIds: ['11111111-1111-1111-1111-111111111111'],
  mode: 'learning',
  difficulty: 'EASY',
  clientDescription: 'Aarav, 15, quiet, wrote something worrying in a notebook',
  minScore: 60,
  lengthMinutes: 6,
};

function setup(overrides: { write?: jest.Mock; build?: jest.Mock } = {}) {
  const store = new Map<string, string>();
  const redis = {
    set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
  };
  const library = {
    competencyNames: jest.fn(
      async () => new Map([[request.competencyIds[0], 'Suicide risk']]),
    ),
    getBehaviours: jest.fn(async () => ({
      helpful: ['Asks directly'],
      unhelpful: ['Minimises'],
      unknownIds: [],
    })),
    stateAwareMainPrompt: jest.fn(
      async () => 'ally_ai_learn_system_main_agent_prompt_full',
    ),
    listCompetencies: jest.fn(async () => []),
    listLanguages: jest.fn(async () => [
      { id: '1', name: 'English', code: 'en', voiceCount: 3 },
      { id: '2', name: 'Silent', code: 'xx', voiceCount: 0 },
    ]),
    listTriggerWarnings: jest.fn(async () => []),
  };
  const write: jest.Mock =
    overrides.write ??
    jest.fn(async () => ({
      actorDescription: 'Aarav is 15…',
      agentTestCases: 'Asks directly',
      title: 'Aarav: a quiet worry',
      difficultyLevel: 'EASY',
      structured: {
        mode: 'learning',
        learnerGoal: 'Ask about suicide and refer',
        setting: 'After class',
        character: {},
      },
    }));
  const fitCheck = { cast: jest.fn(async () => ({})) };
  const build: jest.Mock =
    overrides.build ??
    jest.fn(async () => ({
      scenarioId: 77,
      title: 'Aarav: a quiet worry',
      summary: 'Created roleplay',
      states: [{ name: 'Pulling away' }, { name: 'Guarded' }],
      checks: [],
    }));
  const service = new RoleplayAgentService(
    redis as any,
    library as any,
    { write } as any,
    fitCheck as any,
    { buildScenarioFromBrief: build } as any,
  );
  return { service, redis, library, write, fitCheck, build, store };
}

const newRun = (): RoleplayAgentRun => ({
  id: 'run-1',
  status: 'running',
  step: 'brief',
  createdBy: '42',
  tenantId: 'tenant-1',
  request,
  startedAt: new Date().toISOString(),
  heartbeatAt: new Date().toISOString(),
});

describe('RoleplayAgentService', () => {
  it('lays the request out as a one-item course the brief writer reads', () => {
    const { service } = setup();
    const ctx = service.contextFor(newRun(), {
      competencyNames: ['Suicide risk'],
      behaviours: { helpful: ['Asks directly'], unhelpful: [] },
      usageMetadata: { roleplayAgentRunId: 'run-1' },
    });
    expect(ctx.brief.audience?.who).toBe(request.learners);
    expect(ctx.brief.outcomes?.terminal).toBe(request.goal);
    expect(ctx.blueprint.sections).toHaveLength(1);
    expect(ctx.item).toMatchObject({
      type: 'ROLEPLAY',
      estimatedMinutes: 6,
      completionCriteria: { minScore: 60 },
      spec: {
        mode: 'learning',
        taskClass: 'cooperative client, one concern',
        personaBrief: request.clientDescription,
      },
    });
  });

  it('builds the roleplay with the design for its mode, as the run owner', async () => {
    const { service, build, store } = setup();
    let ownerSeen: string | undefined;
    build.mockImplementationOnce(async () => {
      ownerSeen = ExecutionManager.getUserId();
      return {
        scenarioId: 77,
        title: 'Aarav',
        summary: 'Created',
        states: [{ name: 'Pulling away' }],
        checks: ['reminders hidden (none were written)'],
      };
    });
    const run = newRun();
    await service.execute(run);

    expect(ownerSeen).toBe('42');
    const [input, ctx] = build.mock.calls[0];
    expect(input.design.settings).toMatchObject({
      supervisorNotesEnabled: true,
      remindersEnabled: true,
      selectedMainPromptCode: 'ally_ai_learn_system_main_agent_prompt_full',
    });
    expect(input.design.states.bandWidth).toBe(50);
    expect(ctx).toMatchObject({
      userId: 42,
      usageMetadata: { roleplayAgentRunId: 'run-1' },
    });
    const saved = JSON.parse(store.get('roleplay-agent:run:run-1')!);
    expect(saved).toMatchObject({
      status: 'done',
      step: 'done',
      result: {
        scenarioId: 77,
        card: {
          mode: 'learning',
          states: ['Pulling away'],
          supports: { supervisorNotes: true, reminders: true },
          checks: ['reminders hidden (none were written)'],
        },
      },
    });
  });

  it('gives the brief one repair pass, then records a failure in words', async () => {
    const write = jest
      .fn()
      .mockRejectedValueOnce(new SpecialistValidationError(['no title']))
      .mockRejectedValueOnce(new Error('model down'));
    const { service, store } = setup({ write });
    await service.execute(newRun());

    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].repairErrors).toEqual(['no title']);
    expect(JSON.parse(store.get('roleplay-agent:run:run-1')!)).toMatchObject({
      status: 'failed',
      error: 'model down',
    });
  });

  it('shows a run only to its owner, and a dead run as failed', async () => {
    const { service, store } = setup();
    const stale = {
      ...newRun(),
      heartbeatAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };
    store.set('roleplay-agent:run:run-1', JSON.stringify(stale));

    await expect(service.get('run-1', '7')).rejects.toThrow('No such');
    expect((await service.get('run-1', '42')).status).toBe('failed');
  });

  it('refuses a request without a competency, and offers only voiced languages', async () => {
    const { service } = setup();
    await expect(
      service.start({ id: 42 }, { ...request, competencyIds: [] }),
    ).rejects.toThrow('competency');
    expect((await service.options()).languages.map((l) => l.id)).toEqual(['1']);
  });
});
