import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { SpecialistLlmService } from '../specialist-llm.service';
import { validate as isUuid } from 'uuid';
import { courseCopilotGameOptions } from '../../../util/course-blueprint.util';
import { BlueprintPlannerSpecialist } from '../blueprint-planner.specialist';
import { BlueprintPlannerInput } from '../specialist.types';
import { fakeLlm, makeBrief } from './specialist-test.fixtures';

const input = (): BlueprintPlannerInput => ({
  sessionId: 'session-1',
  brief: makeBrief(),
  notes: 'Keep it to two sections.',
  libraryPicks: [
    { scenarioId: 42, title: 'Asha goes quiet', competency: 'Listening' },
  ],
  games: courseCopilotGameOptions(),
  usageMetadata: { courseCopilotSessionId: 'session-1' },
});

const goodPlan = {
  title: 'Staying with the texter',
  description: 'Two sentences.',
  sections: [
    {
      id: 's1',
      title: 'A cooperative texter',
      description: 'One concern.',
      purpose: 'Simplest task class',
      items: [
        {
          id: 'i1',
          type: 'ARTICLE',
          title: 'Name the feeling',
          purpose: 'p',
          objectiveRefs: [0],
          estimatedMinutes: 6,
          source: { kind: 'new' },
          spec: { outline: ['a'] },
        },
        {
          id: 'i2',
          type: 'ROLEPLAY',
          title: 'Asha',
          purpose: 'p',
          objectiveRefs: [0, 1],
          source: { kind: 'library', scenarioId: 42 },
          spec: { slot: 1 },
        },
        {
          id: 'i3',
          type: 'JOURNAL',
          title: 'Looking back',
          purpose: 'p',
          objectiveRefs: [],
          source: { kind: 'new' },
          spec: {},
        },
      ],
    },
  ],
};

const endsOnGame = {
  ...goodPlan,
  sections: [
    {
      ...goodPlan.sections[0],
      items: [
        ...goodPlan.sections[0].items,
        {
          id: 'i4',
          type: 'GAME',
          title: 'Breather',
          purpose: 'p',
          objectiveRefs: [],
          source: { kind: 'new' },
          spec: { gameKey: 'SNAKE' },
        },
      ],
    },
  ],
};

describe('BlueprintPlannerSpecialist', () => {
  it('returns a normalised blueprint from one call when it has no problems', async () => {
    const llm = fakeLlm(
      [goodPlan],
      'Notes: {{trainer_notes}}\nObjectives:\n{{objectives_list}}\nGames: {{games_json}}\nMax new {{max_new_roleplays}}',
    );
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      input(),
    );

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(llm.complete.mock.calls[0][0]).toMatchObject({
      promptCode: 'course_copilot_blueprint_planner',
      taskId: 'course-copilot-blueprint',
      jsonMode: true,
      usageMetadata: {
        courseCopilotSessionId: 'session-1',
        specialist: 'blueprint_planner',
      },
    });
    const prompt = llm.promptOf(0);
    expect(prompt).toContain('Notes: Keep it to two sections.');
    expect(prompt).toContain('0: Reflect the feeling behind a message');
    expect(prompt).toContain('"key": "TREX_RUNNER"');
    expect(prompt).toContain('Max new 100');

    expect(blueprint.sections[0].items.map((entry) => entry.type)).toEqual([
      'ARTICLE',
      'ROLEPLAY',
      'JOURNAL',
    ]);
    expect(blueprint.sections[0].items.every((entry) => isUuid(entry.id))).toBe(
      true,
    );
    // Slot 1 has no minScore and the roleplay is the capstone → assessment threshold.
    expect(blueprint.sections[0].items[1].completionCriteria).toEqual({
      completionLogic: 'SCORE_AND_DURATION',
      minScore: 65,
    });
    expect(blueprint.estimatedDurationMinutes).toBe(6 + 12 + 4);
    expect(blueprint.competencyIds).toEqual(['c-1', 'c-2']);
  });

  it('adds the matched learner profile to the reference block, after the trainer files', async () => {
    const llm = fakeLlm([goodPlan], 'Brief: {{brief_json}}');
    await new BlueprintPlannerSpecialist(llm.service).plan({
      ...input(),
      brief: {
        ...makeBrief(),
        learnerProfileId: 'teachers',
        skillTargets: [{ skill: 'Listening', a: 'A2', b: 'B2' }],
      },
      referenceMaterial: 'REFERENCE FILES\nManual.pdf, p. 1',
    });
    const prompt = llm.promptOf(0);
    expect(prompt).toContain('"a": "A2"');
    expect(prompt.indexOf('REFERENCE FILES')).toBeLessThan(
      prompt.indexOf('LEARNER PROFILE'),
    );
    expect(prompt).toContain('"Teachers"');
    expect(prompt).toContain('Draft profile');
  });

  it('adds no learner profile block when the brief names none', async () => {
    const llm = fakeLlm([goodPlan], 'Brief: {{brief_json}}');
    await new BlueprintPlannerSpecialist(llm.service).plan(input());
    expect(llm.promptOf(0)).not.toContain('LEARNER PROFILE');
  });

  it('makes one repair call with the problems and keeps the better plan', async () => {
    const llm = fakeLlm([endsOnGame, goodPlan]);
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      input(),
    );
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.promptOf(1)).toContain(
      'Your previous output was rejected for these reasons:',
    );
    expect(llm.promptOf(1)).toContain("The course ends on a game ('Breather')");
    expect(blueprint.sections[0].items).toHaveLength(3);
  });

  it('keeps the first plan when the repair is no better', async () => {
    const llm = fakeLlm([endsOnGame, endsOnGame]);
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      input(),
    );
    expect(blueprint.sections[0].items).toHaveLength(4);
  });

  it('keeps a repair that comes closer to the asked length', async () => {
    const withArticle = (minutes: number) => ({
      ...goodPlan,
      sections: [
        {
          ...goodPlan.sections[0],
          items: goodPlan.sections[0].items.map((item) =>
            item.id === 'i1' ? { ...item, estimatedMinutes: minutes } : item,
          ),
        },
      ],
    });
    const brief = makeBrief();
    brief.shape = { ...(brief.shape ?? {}), durationMinutes: 20 } as any;
    const llm = fakeLlm([withArticle(40), withArticle(30)]);
    const report: any = {};
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      { ...input(), brief, checkTransfer: true },
      report,
    );
    expect(llm.promptOf(0)).toContain('LENGTH BUDGET');
    expect(llm.promptOf(1)).toContain('20-minute course');
    expect(blueprint.sections[0].items[0].estimatedMinutes).toBe(30);
    expect(report.repairKept).toBe(true);
    expect(report.remaining).toHaveLength(1);
  });

  it('repairs the plan correctly with sufficient token limit', async () => {
    const completeMock = jest
      .fn()
      .mockResolvedValueOnce({
        text: JSON.stringify(endsOnGame),
        model: 'fake-model',
        provider: 'fake',
      })
      .mockImplementation(async ({ maxTokens }: { maxTokens: number }) => {
        // This logic simulates the bug and the fix.
        // The real maxTokens is 16_000, so this will trigger truncation.
        // After the fix (24_000), it will not.
        if (maxTokens < 20000) {
          return {
            text: JSON.stringify(goodPlan).slice(0, -20), // truncated
            model: 'fake-model',
            provider: 'fake',
          };
        }
        return {
          text: JSON.stringify(goodPlan), // full
          model: 'fake-model',
          provider: 'fake',
        };
      });

    const llmCompletionService = {
      complete: completeMock,
    } as unknown as LlmCompletionService;

    const promptSharedService = {
      getPromptByCode: jest.fn().mockResolvedValue('template'),
    } as unknown as PromptSharedService;

    const specialistLlmService = new SpecialistLlmService(
      promptSharedService,
      llmCompletionService,
    );

    const specialist = new BlueprintPlannerSpecialist(specialistLlmService);
    const logger = { warn: jest.fn() };
    (specialist as any).logger = logger;

    const blueprint = await specialist.plan(input());

    // With current code, maxTokens is 16000, so we get truncated JSON.
    // The repair fails, we keep the first plan (4 items) and a warning is logged.
    // This assertion will fail, expecting the repaired plan (3 items).
    expect(blueprint.sections[0].items).toHaveLength(3);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('spends its one retry on unparseable output', async () => {
    const llm = fakeLlm(['not json', goodPlan]);
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      input(),
    );
    expect(llm.promptOf(1)).toContain('- The model did not return JSON');
    expect(blueprint.sections).toHaveLength(1);
  });

  it('keeps a plan with many new roleplays: there is no roleplay limit', async () => {
    const roleplay = (index: number) => ({
      id: `r${index}`,
      type: 'ROLEPLAY',
      title: `Roleplay ${index}`,
      purpose: 'p',
      source: { kind: 'new' },
      spec: {},
    });
    const sixNew = {
      ...goodPlan,
      sections: [
        {
          ...goodPlan.sections[0],
          items: [
            ...Array.from({ length: 6 }, (_, index) => roleplay(index)),
            {
              id: 'j',
              type: 'JOURNAL',
              title: 'Reflect',
              purpose: 'p',
              source: { kind: 'new' },
              spec: {},
            },
          ],
        },
      ],
    };
    const llm = fakeLlm([sixNew]);
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      input(),
    );
    // One call: nothing to repair.
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(
      blueprint.sections[0].items.filter((item) => item.type === 'ROLEPLAY'),
    ).toHaveLength(6);
  });
});
