import { createEmptyPrdDocument } from '../../type/builder-prd.type';
import { BuilderPrdChecklistToolsService } from '../builder-prd-checklist-tools.service';

const readiness = {
  score: 50,
  ready: false,
  sections: [],
  blockers: ['something'],
};

function setup(draft = createEmptyPrdDocument(), shown = ['FP-0142']) {
  let stored = draft;
  const prdService = {
    applyMutation: jest.fn(async (doc, mutate) => {
      stored = mutate(stored);
      return { doc: { ...doc, draft: stored, versionNumber: 2 } };
    }),
  };
  const readinessService = { settle: jest.fn(async () => readiness) };
  const principles = { shownCodes: jest.fn(async () => new Set(shown)) };
  const service = new BuilderPrdChecklistToolsService(
    prdService as any,
    readinessService as any,
    principles as any,
  );
  const context: any = {
    session: { id: 's1' },
    doc: { id: 'd1', draft, versionNumber: 1 },
    userId: 7,
  };
  return { service, prdService, context, stored: () => stored };
}

describe('BuilderPrdChecklistToolsService', () => {
  it('records valid coverage items and refuses the rest, in one write', async () => {
    const { service, context } = setup();
    const outcome = await service.execute(
      'record_coverage',
      {
        items: [
          {
            key: 'translations',
            status: 'not_applicable',
            note: 'No new user-facing text.',
          },
          { key: 'mobile_app', status: 'not_applicable', note: 'n/a' },
          {
            key: 'admin_web',
            status: 'asked',
            note: 'Should admins see the score?',
          },
        ],
      },
      context,
    );
    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.refused).toEqual([
      'mobile_app: say why it does not apply',
    ]);
  });

  it('adds an asked question to the open questions', async () => {
    const { service, context, stored } = setup();
    await service.execute(
      'record_coverage',
      {
        items: [
          { key: 'admin_web', status: 'asked', note: 'Should admins see it?' },
        ],
      },
      context,
    );
    expect(stored().openQuestions).toEqual(['Should admins see it?']);
    expect(stored().coverage).toEqual([
      expect.objectContaining({ key: 'admin_web', status: 'asked' }),
    ]);
  });

  it('writes nothing when every item is refused', async () => {
    const { service, context, prdService } = setup();
    const outcome = await service.execute(
      'record_coverage',
      { items: [{ key: 'success_metric', status: 'answered', note: 'x' }] },
      context,
    );
    expect(outcome.modelResult.ok).toBe(false);
    expect(prdService.applyMutation).not.toHaveBeenCalled();
  });

  it('marks an applied principle only when its section cites it', async () => {
    const draft = {
      ...createEmptyPrdDocument(),
      goals: 'Name every platform [FP-0142].',
    };
    const { service, context, stored } = setup(draft);
    const outcome = await service.execute(
      'mark_principle',
      {
        marks: [
          { code: 'FP-0142', mark: 'applied', section: 'goals' },
          {
            code: 'FP-9999',
            mark: 'not_relevant',
            reason: 'Never shown here.',
          },
        ],
      },
      context,
    );
    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.refused).toEqual([
      'FP-9999: not a principle this session was shown',
    ]);
    expect(stored().principleMarks).toEqual([
      expect.objectContaining({
        code: 'FP-0142',
        mark: 'applied',
        section: 'goals',
      }),
    ]);
  });

  it('refuses an applied mark whose section does not cite the code', async () => {
    const { service, context } = setup();
    const outcome = await service.execute(
      'mark_principle',
      { marks: [{ code: 'FP-0142', mark: 'applied', section: 'goals' }] },
      context,
    );
    expect(outcome.modelResult.ok).toBe(false);
    expect(String(outcome.modelResult.message)).toContain(
      'does not cite [FP-0142]',
    );
  });
});
