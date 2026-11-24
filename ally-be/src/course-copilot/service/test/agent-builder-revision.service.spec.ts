import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AgentBuilderRevisionService,
  parseRevisionPlan,
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
