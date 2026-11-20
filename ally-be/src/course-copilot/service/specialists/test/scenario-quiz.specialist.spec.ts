import { validateTrackItemContent } from 'src/track/service/track-structure.validator';
import { TrackItemType } from 'src/track/type/track.type';
import {
  normaliseScenarioQuizOutput,
  ScenarioQuizSpecialist,
} from '../scenario-quiz.specialist';
import { SpecialistValidationError } from '../specialist.types';
import {
  fakeLlm,
  makeBlueprint,
  makeContext,
} from './specialist-test.fixtures';

const opts = {
  title: 'Priya after class',
  passScore: 0,
  keepIds: new Set<string>(),
};

/** Scenes keyed by the model's own ids, choices pointing forward with assorted key names. */
const SCENARIO = {
  scenes: [
    {
      id: 's1',
      title: 'After class',
      text: 'Priya: "I don\'t really see the point of coming any more."',
      choices: [
        { text: '"What do you mean by no point?"', next: 's2' },
        { label: '"Everyone feels like that sometimes."', nextSceneId: 's3' },
      ],
    },
    {
      id: 's2',
      text: 'Priya: "Like… nothing would change if I wasn\'t here."',
      choices: [
        { text: '"Are you thinking about ending your life?"', leadsTo: 'good' },
        { text: '"Let\'s talk about your exams."', goto: 'mixed' },
      ],
    },
    {
      id: 's3',
      text: 'Priya goes quiet and looks at her phone.',
      choices: [
        { text: '"Sorry — I brushed that off. Tell me more?"', next: 's2' },
      ],
    },
    {
      id: 'good',
      text: 'Priya tells you the truth, and you call Tele-MANAS together.',
      outcome: 'positive',
    },
    {
      id: 'mixed',
      text: 'Priya answers, but the moment has passed.',
      score: 50,
    },
  ],
};

describe('normaliseScenarioQuizOutput', () => {
  it('turns a scene list into valid scenario quiz content', () => {
    const { content, summary } = normaliseScenarioQuizOutput(SCENARIO, opts);

    expect(() =>
      validateTrackItemContent({
        type: TrackItemType.BRANCHING_SCENARIO,
        content,
      }),
    ).not.toThrow();
    expect(summary).toBe('5 scenes (2 endings)');
  });

  it('resolves every choice to a scene that exists, including a recovery loop', () => {
    const { content } = normaliseScenarioQuizOutput(SCENARIO, opts);
    const nodes: any[] =
      (content as any).nodes ?? (content as any).scenes ?? [];
    const ids = new Set(nodes.map((n) => n.id));
    const targets = nodes.flatMap((n) =>
      (n.choices ?? []).map((c: any) => c.nextNodeId ?? c.next),
    );
    expect(targets.length).toBe(5);
    expect(targets.every((t) => ids.has(t))).toBe(true);
  });

  it('sends back a choice that leads nowhere', () => {
    const broken = {
      scenes: [
        {
          id: 's1',
          text: 'Hi.',
          choices: [
            { text: 'Go', next: 'missing' },
            { text: 'Stay', next: 'end' },
          ],
        },
        { id: 'end', text: 'Done.', outcome: 'positive' },
      ],
    };
    expect(() => normaliseScenarioQuizOutput(broken, opts)).toThrow(
      SpecialistValidationError,
    );
  });

  it('sends back an ending with no outcome', () => {
    const broken = {
      scenes: [
        {
          id: 's1',
          text: 'Hi.',
          choices: [
            { text: 'A', next: 'e1' },
            { text: 'B', next: 'e2' },
          ],
        },
        { id: 'e1', text: 'One.', outcome: 'positive' },
        { id: 'e2', text: 'Two.' },
      ],
    };
    expect(() => normaliseScenarioQuizOutput(broken, opts)).toThrow(
      /no outcome/,
    );
  });
});

describe('ScenarioQuizSpecialist', () => {
  const blueprint = makeBlueprint();
  const base = makeContext(blueprint.sections[0].items[0].id, {}, blueprint);
  const context = {
    ...base,
    item: {
      ...base.item,
      type: 'BRANCHING_SCENARIO',
      title: 'Priya after class',
    } as any,
    referenceMaterial: 'REFERENCE MATERIAL\n[1] Deck.pptx, slide 1\nPriya.',
  };

  it('writes from the brief and passes reference passages through', async () => {
    const llm = fakeLlm([SCENARIO]);
    const output = await new ScenarioQuizSpecialist(llm.service).generate(
      context,
    );

    expect(output.summary).toBe('5 scenes (2 endings)');
    expect(llm.complete.mock.calls[0][0].prompt).toContain(
      'Deck.pptx, slide 1',
    );
  });
});
