import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BugHunterBoardService } from 'src/bug-hunter-approvals/service/bug-hunter-board.service';
import { BugFindingSeverity } from 'src/bug-hunter/enum/bug-finding.enum';
import { PmAgentSignal } from 'src/pm-agent/entity/pm-agent-signal.entity';

import { UxSignalWriterService } from '../ux-signal-writer.service';
import { UxSignalKind } from '../../enum/ux-signal.enum';
import { TriagedItem } from '../../ux-signals.types';

/**
 * The writer is the pipeline's only mutation point, and its dedupe behaviour is
 * what decides whether a daily scan is useful or is a machine for generating the
 * same ticket forever.
 */
describe('UxSignalWriterService', () => {
  let service: UxSignalWriterService;
  /** Bug Hunter's queue: true for a new key, false for one already queued. */
  let enqueueSignal: jest.Mock;
  /** Every (sql, params) the signal repository ran, in order. */
  let signalQuery: jest.Mock;

  const scan = {
    windowFrom: '2026-08-20',
    windowTo: '2026-08-27',
    model: 'claude-test',
  };

  const bug = (over: Partial<TriagedItem> = {}): TriagedItem => ({
    kind: UxSignalKind.BUG,
    title: 'Retry button on /inbox does nothing',
    body: 'Rage clicks cluster on the Retry control while sending fails.',
    severity: BugFindingSeverity.HIGH,
    rationale: 'Blocks a send while a caller waits.',
    evidence: ['9 rage clicks across 5 sessions'],
    route: '/inbox',
    target: 'element "Retry"',
    suggestedGoal: null,
    confidence: 'high — errors corroborate the clicks',
    ...over,
  });

  const improvement = (over: Partial<TriagedItem> = {}): TriagedItem => ({
    ...bug(),
    kind: UxSignalKind.IMPROVEMENT,
    title: 'Resources page loses most visitors',
    suggestedGoal: 'Improve learner engagement',
    ...over,
  });

  beforeEach(async () => {
    const queued = new Set<string>();
    enqueueSignal = jest.fn(async (input: { key: string }) => {
      const fresh = !queued.has(input.key);
      queued.add(input.key);
      return fresh;
    });
    // Stands in for Postgres' ON CONFLICT (source, key): the first insert of a
    // key reports inserted=true, a repeat reports inserted=false.
    const keys = new Set<string>();
    signalQuery = jest.fn(async (_sql: string, params: unknown[]) => {
      const key = `${params[0]}:${params[2]}`;
      const inserted = !keys.has(key);
      keys.add(key);
      return [{ inserted }];
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UxSignalWriterService,
        { provide: BugHunterBoardService, useValue: { enqueueSignal } },
        {
          provide: getRepositoryToken(PmAgentSignal),
          useValue: { query: signalQuery },
        },
      ],
    }).compile();

    service = module.get(UxSignalWriterService);
  });

  afterEach(() => jest.clearAllMocks());

  it("files a bug into Bug Hunter's queue with the route as its symbol", async () => {
    const result = await service.write([bug()], scan);

    expect(result.findingsCreated).toBe(1);
    const queued = enqueueSignal.mock.calls[0][0];
    expect(queued).toMatchObject({
      source: 'ux_signal',
      // the app has to be set outright: every UX signal is the helpline frontend's
      app: 'ally-web',
      symbol: '/inbox|element "Retry"',
      severity: BugFindingSeverity.HIGH,
    });
    expect(queued.key).toEqual(expect.any(String));
  });

  it('counts an already-queued bug as a skipped duplicate instead of re-filing', async () => {
    await service.write([bug()], scan);
    const result = await service.write([bug()], scan);

    expect(result.findingsCreated).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
  });

  it('derives the same dedupe key from a reworded description of one bug', async () => {
    // The model rewords freely between runs. Two descriptions of the same
    // route+control must collapse, or the queue grows a row a night.
    await service.write([bug()], scan);
    const firstKey = enqueueSignal.mock.calls[0][0].key;

    await service.write(
      [
        bug({
          title: 'Send retry unresponsive on inbox',
          body: 'Users repeatedly click Retry; the send never completes.',
        }),
      ],
      scan,
    );

    expect(enqueueSignal.mock.calls[1][0].key).toBe(firstKey);
  });

  it('files an improvement as a new ux_signals signal', async () => {
    const result = await service.write([improvement()], scan);

    expect(result.suggestionsCreated).toBe(1);
    const [sql, params] = signalQuery.mock.calls[0];
    expect(sql).toContain('pm_agent_signals');
    expect(sql).toContain('ON CONFLICT');
    expect(params[0]).toBe('ux_signals');
    expect(params[3]).toBe('Resources page loses most visitors');
    const metrics = JSON.parse(params[5]);
    expect(metrics.suggestedGoal).toBe('Improve learner engagement');
    expect(metrics.model).toBe('claude-test');
    expect(metrics.route).toBe('/inbox');
  });

  it('skips an improvement already stored under the same key', async () => {
    await service.write([improvement()], scan);

    const result = await service.write([improvement()], scan);

    expect(result.suggestionsCreated).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
  });

  it('keys a signal on route, target and normalised title', () => {
    const a = UxSignalWriterService.signalKey(improvement());
    const b = UxSignalWriterService.signalKey(
      improvement({ title: '  resources PAGE loses most   visitors ' }),
    );
    const c = UxSignalWriterService.signalKey(improvement({ route: '/other' }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.length).toBeLessThanOrEqual(160);
  });

  it('keeps filing the rest of a scan when one row fails', async () => {
    // One malformed item must not discard the whole scan's work — the queues
    // are the deliverable, and a scan is not cheap to re-run.
    enqueueSignal.mockRejectedValueOnce(new Error('constraint violation'));

    const result = await service.write([bug(), improvement()], scan);

    expect(result.findingsCreated).toBe(0);
    expect(result.suggestionsCreated).toBe(1);
  });

  it('puts the route and the model confidence into the bug description', async () => {
    // An admin reading the bug should see how sure the pipeline was; hiding
    // it would invite more trust than the finding earned.
    await service.write([bug()], scan);

    const evidence: string = enqueueSignal.mock.calls[0][0].description;
    expect(evidence).toContain('Route: /inbox');
    expect(evidence).toContain('Confidence: high');
    expect(evidence).toContain('9 rage clicks across 5 sessions');
  });
});
