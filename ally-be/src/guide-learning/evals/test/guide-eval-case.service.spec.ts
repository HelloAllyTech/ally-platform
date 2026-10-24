import { ConflictException } from '@nestjs/common';
import {
  AgentEvalCaseSource,
  AgentEvalCaseStatus,
} from 'src/llm-agent/harness/enum/eval.enum';
import { HIDDEN_FOR_PRIVACY } from 'src/guide/safety/redaction';
import { GuideEvalCaseService } from '../guide-eval-case.service';

function window(over: Record<string, any> = {}) {
  return {
    turn: {
      id: 'turn-1234567890',
      threadId: 'th1',
      tenantId: 't1',
      trackId: 'tr1',
      userId: 3,
      status: 'completed',
      summary: { modeBefore: 'CARE', replyKind: 'model' },
    },
    window: {
      channel: 'text',
      releaseWindowOpen: true,
      reply: { text: 'x', kind: 'model' },
      sentinel: { risk: 'none', about: 'course' },
      toolCalls: [],
    },
    situation: { guidance: 'lead', quizOpen: false },
    reviewable: {
      recent: [
        { role: 'ally', text: 'How did it go?' },
        { role: 'learner', text: HIDDEN_FOR_PRIVACY },
      ],
      learnerText: 'mail me at [email], that was heavy',
      reply: { text: 'x', kind: 'model' },
    },
    learnerFlagged: false,
    flags: [],
    safety: false,
    ...over,
  };
}

function setup(w: any) {
  const inserted: any[] = [];
  const cases = {
    findOne: jest.fn(async () => null),
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => {
      inserted.push(row);
      return { ...row, id: `c${inserted.length}` };
    }),
  };
  const suites = {
    findOne: jest.fn(async () => ({ id: 'suite-reg', key: 'regression' })),
  };
  const dataSource = {
    query: jest.fn(async (sql: string) =>
      sql.includes('track_item_progress') ? [{ completed: '2' }] : [],
    ),
  };
  const windows = { loadTurn: jest.fn(async () => w) };
  const service = new GuideEvalCaseService(
    cases as never,
    suites as never,
    dataSource as never,
    windows as never,
  );
  return { service, inserted };
}

describe('GuideEvalCaseService', () => {
  it('saves a turn as a redacted, replayable regression case', async () => {
    const { service, inserted } = setup(window());
    const result = await service.saveFromTurn('turn-1234567890', 9, {});
    expect(result.duplicate).toBe(false);
    expect(inserted[0]).toMatchObject({
      source: AgentEvalCaseSource.TRACE,
      status: AgentEvalCaseStatus.ACTIVE,
      sourceThreadId: 'th1',
      input: {
        trackId: 'tr1',
        tenantId: 't1',
        progress: 2,
        mode: 'CARE',
        guidance: 'lead',
        releaseWindowOpen: true,
        message: 'mail me at [email], that was heavy',
        history: [{ role: 'ally', text: 'How did it go?' }],
      },
      expectations: { noPromptLeak: true, mustNotPresent: true },
    });
    expect(inserted[0].title).toBe('regression · turn turn-123');
  });

  it('refuses a turn whose learner message named a real person', async () => {
    const { service } = setup(window({ learnerFlagged: true }));
    await expect(service.saveFromTurn('turn-1', 9, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('expects a crisis response on a regression of a crisis verdict', () => {
    const { service } = setup(window());
    const w = window();
    w.window.sentinel = { risk: 'crisis', about: 'self' };
    expect(
      service.expectationsFromWindow(w as never, 'regression').crisis,
    ).toBe(true);
  });

  it('proposes failed turns, never activating them', async () => {
    const { service, inserted } = setup(window());
    const failing = window();
    (failing.window as any) = {
      ...failing.window,
      reply: { text: 'Great job!', kind: 'model' },
      learnerText: 'done',
      recent: [],
      quizKeys: [],
      approvedCrisisTexts: [],
      praiseEveryTurns: 4,
      mode: 'NORMAL',
      budget: null,
    };
    expect(await service.proposeFromWindows([failing as never])).toBe(1);
    expect(inserted[0]).toMatchObject({
      source: AgentEvalCaseSource.FAILED_TURN,
      status: AgentEvalCaseStatus.PROPOSED,
    });
    expect(inserted[0].title).toMatch(/^generic_praise/);
  });
});
