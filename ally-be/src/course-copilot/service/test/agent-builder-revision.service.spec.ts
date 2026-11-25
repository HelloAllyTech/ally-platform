import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AgentBuilderRevisionService,
  parseRevisionPlan,
  withDependentFields,
} from '../agent-builder-revision.service';

const TEMPLATE = readFileSync(
  join(process.cwd(), 'src/prompts/agent_builder_wizard/revise_plan.txt'),
  'utf8',
);

const fields = [
  { id: 'roleInstruction', label: 'Role instruction', value: 'Be open.' },
  { id: 'openingStatements', label: 'Opening lines', value: 'Hi, I am fine.' },
  { id: 'title', label: 'Title', value: 'A quiet worry' },
];

describe('AgentBuilderRevisionService', () => {
  it('asks for a plan over the current fields and keeps it to them', async () => {
    const complete = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        fields: [
          { id: 'roleInstruction', change: 'Make him more guarded.' },
          { id: 'invented', change: 'x' },
        ],
        reply: 'I will make him more guarded.',
      }),
    });
    const service = new AgentBuilderRevisionService(
      { getPromptByCode: jest.fn().mockResolvedValue(TEMPLATE) } as any,
      { complete } as any,
    );

    const plan = await service.plan('make him more guarded', fields);

    expect(plan).toEqual({
      fields: [{ id: 'roleInstruction', change: 'Make him more guarded.' }],
      reply: 'I will make him more guarded.',
    });
    const prompt = complete.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('make him more guarded');
    expect(prompt).toContain(
      '[openingStatements] Opening lines:\nHi, I am fine.',
    );
    expect(complete.mock.calls[0][0]).toMatchObject({ jsonMode: true });
  });

  it('makes no call when there is nothing to change yet', async () => {
    const complete = jest.fn();
    const service = new AgentBuilderRevisionService(
      { getPromptByCode: jest.fn() } as any,
      { complete } as any,
    );
    expect(
      (await service.plan('x', [{ id: 'title', label: 'Title', value: ' ' }]))
        .fields,
    ).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('parseRevisionPlan', () => {
  it('reads an unreadable answer as no change, never everything', () => {
    expect(parseRevisionPlan('not json', ['title'])).toEqual({
      fields: [],
      reply: 'Nothing in this roleplay needs to change for that.',
    });
  });

  it('keeps a field listed twice once', () => {
    const plan = parseRevisionPlan(
      JSON.stringify({
        fields: [
          { id: 'title', change: 'a' },
          { id: 'title', change: 'b' },
        ],
      }),
      ['title'],
    );
    expect(plan.fields).toEqual([{ id: 'title', change: 'a' }]);
  });
});

describe('withDependentFields', () => {
  const offered = [
    'roleInstruction',
    'title',
    'characterProfileText',
    'openingStatements',
    'state:s1',
    'characterDetails',
  ];

  it('rewrites every field once the character details change', () => {
    const plan = withDependentFields(
      {
        fields: [
          { id: 'characterProfileText', change: 'Make the client a girl.' },
          { id: 'characterDetails', change: 'Make the client female.' },
        ],
        reply: 'I will make the client a girl.',
      },
      'Change the client from a boy to a girl',
      offered,
    );
    expect(plan.fields.map((f) => f.id)).toEqual([
      'characterDetails',
      'characterProfileText',
      'roleInstruction',
      'title',
      'openingStatements',
      'state:s1',
    ]);
    expect(plan.fields[0].change).toBe('Make the client female.');
    expect(plan.fields[1].change).toContain('Make the client a girl.');
    expect(plan.fields[2].change).toContain(
      'Keep this consistent with the change to the client (Make the client female.)',
    );
    expect(plan.reply).toBe('I will make the client a girl.');
  });

  it('adds the character details when the request is about gender and the planner left them out', () => {
    const plan = withDependentFields(
      {
        fields: [{ id: 'characterProfileText', change: 'She is a girl now.' }],
        reply: 'ok',
      },
      'make him a girl instead of a boy',
      offered,
    );
    expect(plan.fields[0]).toEqual({
      id: 'characterDetails',
      change: 'make him a girl instead of a boy',
    });
    expect(plan.fields).toHaveLength(offered.length);
  });

  it('leaves a request about how the client talks alone', () => {
    const plan = {
      fields: [{ id: 'roleInstruction', change: 'More guarded.' }],
      reply: 'ok',
    };
    expect(withDependentFields(plan, 'make her more guarded', offered)).toBe(
      plan,
    );
  });

  it('does nothing when the form offers no character details', () => {
    const plan = { fields: [], reply: 'nothing' };
    expect(
      withDependentFields(plan, 'make him a girl', ['roleInstruction']),
    ).toBe(plan);
  });
});

describe('withDependentFields and settings', () => {
  it('never rewrites the settings for a change to the client', () => {
    const plan = withDependentFields(
      {
        fields: [{ id: 'characterDetails', change: 'Make her a girl.' }],
        reply: 'ok',
      },
      'make him a girl',
      ['characterDetails', 'roleInstruction', 'settings'],
    );
    expect(plan.fields.map((f) => f.id)).toEqual([
      'characterDetails',
      'roleInstruction',
    ]);
  });
});
