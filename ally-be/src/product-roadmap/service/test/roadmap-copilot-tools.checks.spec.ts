import { RoadmapCopilotToolsService } from '../roadmap-copilot-tools.service';

describe('RoadmapCopilotToolsService — Check my idea schema', () => {
  const service = new (RoadmapCopilotToolsService as any)(
    ...new Array(12).fill({}),
  ) as RoadmapCopilotToolsService;
  const submitOf = (tools: any[]) =>
    tools.find((t) => t.name === 'submit_turn').input_schema;

  it('is unchanged for every caller that does not ask for checks', () => {
    const base = submitOf(service.getToolDefinitions());
    expect(base.properties.suggestedGoal).toBeUndefined();
    expect(base.properties.gates.items.properties.evidence).toBeUndefined();
    expect(service.getToolDefinitions().map((t) => t.name)).toEqual(
      service.getToolDefinitions({ checks: true }).map((t) => t.name),
    );
  });

  it('asks for a verbatim quote per check and a goal suggestion', () => {
    const schema = submitOf(service.getToolDefinitions({ checks: true }));
    expect(schema.properties.gates.items.properties.evidence.type).toBe(
      'string',
    );
    expect(schema.properties.suggestedGoal.nullable).toBe(true);
    expect(schema.required).toEqual([
      'reply',
      'gates',
      'quality',
      'draft',
      'brief',
    ]);
  });
});
