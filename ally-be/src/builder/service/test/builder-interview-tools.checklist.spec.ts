import { BuilderInterviewToolsService } from '../builder-interview-tools.service';

describe('BuilderInterviewToolsService — checklist tools', () => {
  const build = (checklist?: any) =>
    new BuilderInterviewToolsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { recordToolResult: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      checklist,
    );

  it('offers record_coverage and mark_principle in both tool belts', () => {
    const service = build({ execute: jest.fn() });
    for (const validatedTurns of [false, true]) {
      const names = service
        .getToolDefinitions({ validatedTurns })
        .map((tool: any) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining(['record_coverage', 'mark_principle']),
      );
    }
  });

  it('leaves them out where the service is not wired (the eval sandbox)', () => {
    const names = build()
      .getToolDefinitions()
      .map((tool: any) => tool.name);
    expect(names).not.toContain('record_coverage');
  });

  it('hands their calls to the checklist service', async () => {
    const execute = jest.fn(async () => ({
      modelResult: { ok: true },
      summary: 'done',
    }));
    const service = build({ execute });
    const context: any = { session: { id: 's1' }, doc: {}, userId: 1 };
    await service.execute('mark_principle', { marks: [] }, context);
    expect(execute).toHaveBeenCalledWith(
      'mark_principle',
      { marks: [] },
      context,
    );
  });
});
