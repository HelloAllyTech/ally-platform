import { BadRequestException } from '@nestjs/common';
import { BuilderSessionStatus } from 'src/builder/enum/builder.enum';
import { PmAgentBuildService } from '../service/pm-agent-build.service';
import {
  PmCardStatus,
  PmOutboxStatus,
  PmOutboxStep,
} from '../enum/pm-agent.enum';
import {
  FakeCardRepository,
  FakeClock,
  FakeOutboxRepository,
  makeCard,
} from './pm-agent.fakes';

/**
 * Accept → Builder: the outbox worker's chain, its idempotency, the drain when Builder is
 * full, the pause controls, the status reconcile and the circuit breaker.
 */
describe('PmAgentBuildService', () => {
  let clock: FakeClock;
  let cards: FakeCardRepository;
  let outbox: FakeOutboxRepository;
  let outcomes: { flag: jest.Mock };
  let laneStats: { bump: jest.Mock };
  let settingsRow: Record<string, any>;
  let settings: Record<string, jest.Mock>;
  let builder: Record<string, jest.Mock>;
  let events: { cardUpdated: jest.Mock; stateUpdated: jest.Mock };
  let slack: { sendMessage: jest.Mock };
  let service: PmAgentBuildService;
  const ADMIN = 7;

  beforeEach(() => {
    clock = new FakeClock();
    cards = new FakeCardRepository(clock);
    outbox = new FakeOutboxRepository(clock);
    outcomes = { flag: jest.fn() };
    laneStats = { bump: jest.fn().mockResolvedValue(undefined) };
    settingsRow = {
      pauseAutoBuild: false,
      autoBuildPaused: false,
      autoBuildPausedReason: null,
      consecutiveBuildFailures: 0,
      slackNotify: true,
    };
    settings = {
      getSingleton: jest.fn(async () => settingsRow),
      incrementBuildFailures: jest.fn(async () => {
        settingsRow.consecutiveBuildFailures += 1;
        return settingsRow.consecutiveBuildFailures;
      }),
      resetBuildFailures: jest.fn(async () => {
        settingsRow.consecutiveBuildFailures = 0;
      }),
      tripBreaker: jest.fn(async (reason: string) => {
        if (settingsRow.autoBuildPaused) return false;
        settingsRow.autoBuildPaused = true;
        settingsRow.autoBuildPausedReason = reason;
        return true;
      }),
    };
    builder = {
      builderSettings: jest
        .fn()
        .mockResolvedValue({ enabled: true, maxConcurrentBuilds: 3 }),
      findSessionForCard: jest.fn().mockResolvedValue(null),
      createSession: jest.fn().mockResolvedValue('sess-1'),
      fileRoadmapItem: jest.fn().mockResolvedValue('opp-1'),
      patchPrd: jest.fn().mockResolvedValue({ ready: true, blockers: [] }),
      setRepos: jest.fn(),
      designStatus: jest
        .fn()
        .mockResolvedValue({ status: null, error: null, openDecisions: [] }),
      startDesign: jest.fn(),
      approveDesign: jest.fn(),
      startBuild: jest.fn(),
      getSession: jest.fn(),
      listPullRequests: jest.fn().mockResolvedValue([]),
    };
    events = { cardUpdated: jest.fn(), stateUpdated: jest.fn() };
    slack = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    service = new PmAgentBuildService(
      cards as never,
      outbox as never,
      outcomes as never,
      laneStats as never,
      settings as never,
      builder as never,
      events as never,
      slack as never,
    );
  });

  afterEach(() => clock.restore());

  /** An accepted card whose undo window has closed. */
  const accepted = async (over: Record<string, any> = {}) => {
    const card = cards.add(
      makeCard({
        status: PmCardStatus.ACCEPTED_PENDING,
        undoUntil: new Date(clock.now - 1),
        decidedBy: ADMIN,
        ...over,
      }),
    );
    await outbox.insertWith(null, {
      cardId: card.id,
      dueAt: new Date(clock.now - 1),
      createdBy: ADMIN,
    });
    return card;
  };

  /** Run the worker until nothing is due (bounded). */
  const drainAll = async () => {
    for (let i = 0; i < 12; i += 1) {
      if (!(await service.drain())) break;
    }
  };

  describe('the outbox chain', () => {
    it('does nothing before the undo window closes', async () => {
      const card = cards.add(
        makeCard({
          status: PmCardStatus.ACCEPTED_PENDING,
          undoUntil: new Date(clock.now + 10_000),
        }),
      );
      await outbox.insertWith(null, {
        cardId: card.id,
        dueAt: new Date(clock.now + 10_000),
        createdBy: ADMIN,
      });

      expect(await service.drain()).toBe(0);
      expect(builder.createSession).not.toHaveBeenCalled();
    });

    it('runs create → roadmap → PRD → repos → design, then approves and builds', async () => {
      builder.startDesign.mockImplementation(async () =>
        builder.designStatus.mockResolvedValue({
          status: 'drafting',
          error: null,
          openDecisions: [],
        }),
      );
      const card = await accepted();

      await drainAll();
      // The designer run is drafting: the card waits in `designing`.
      expect(cards.get(card.id).status).toBe(PmCardStatus.DESIGNING);
      expect(builder.createSession).toHaveBeenCalledWith(
        ADMIN,
        card.id,
        card.title,
      );
      expect(builder.fileRoadmapItem).toHaveBeenCalledWith(
        ADMIN,
        'sess-1',
        expect.stringContaining(card.title),
      );
      expect(builder.patchPrd).toHaveBeenCalledWith(
        'sess-1',
        ADMIN,
        expect.arrayContaining([
          expect.objectContaining({ path: '/title', value: card.title }),
        ]),
        'Compiled from PM Agent card v1',
      );
      expect(builder.setRepos).toHaveBeenCalledWith('sess-1', ADMIN, [
        'ally-web',
      ]);
      expect(builder.startDesign).toHaveBeenCalledTimes(1);
      expect(cards.get(card.id).builderSessionId).toBe('sess-1');
      expect(cards.get(card.id).roadmapOpportunityId).toBe('opp-1');
      expect(cards.get(card.id).compiledPrdHash).toMatch(/^[a-f0-9]{64}$/);

      // The designer submits for review; the next tick approves (as the platform) and builds.
      builder.designStatus.mockResolvedValue({
        status: 'review',
        error: null,
        openDecisions: [],
      });
      clock.advance(5 * 60 * 1000 + 1);
      await drainAll();

      expect(builder.approveDesign).toHaveBeenCalledWith('sess-1', 0);
      expect(builder.startBuild).toHaveBeenCalledWith('sess-1', ADMIN);
      expect(cards.get(card.id).status).toBe(PmCardStatus.BUILDING);
      expect(outbox.forCard(card.id)).toMatchObject({
        status: PmOutboxStatus.DONE,
        step: PmOutboxStep.DONE,
      });
    });

    it('cancels the row instead of building when the card was undone', async () => {
      const card = await accepted({ status: PmCardStatus.OPEN });

      await service.drain();

      expect(builder.createSession).not.toHaveBeenCalled();
      expect(outbox.forCard(card.id)!.status).toBe(PmOutboxStatus.CANCELLED);
    });

    it('reuses a session already created for the card (crash between create and record)', async () => {
      builder.findSessionForCard.mockResolvedValue('sess-earlier');
      const card = await accepted();

      await service.drain();

      expect(builder.createSession).not.toHaveBeenCalled();
      expect(cards.get(card.id).builderSessionId).toBe('sess-earlier');
    });

    it('skips steps already done when a row is retaken after a crash', async () => {
      const card = await accepted({
        status: PmCardStatus.QUEUED,
        builderSessionId: 'sess-1',
        roadmapOpportunityId: 'opp-1',
      });
      outbox.forCard(card.id)!.step = PmOutboxStep.CREATE_SESSION;

      await service.drain(); // create_session → already has one
      await service.drain(); // file_roadmap → already filed

      expect(builder.createSession).not.toHaveBeenCalled();
      expect(builder.fileRoadmapItem).not.toHaveBeenCalled();
      expect(outbox.forCard(card.id)!.step).toBe(PmOutboxStep.PATCH_PRD);
    });

    it('two workers draining at once run each step once (row leases)', async () => {
      await accepted();

      await Promise.all([service.drain(), service.drain()]);

      expect(builder.createSession).toHaveBeenCalledTimes(1);
    });

    it('a roadmap failure does not block the build', async () => {
      builder.fileRoadmapItem.mockRejectedValue(new Error('no goals'));
      builder.startDesign.mockImplementation(async () =>
        builder.designStatus.mockResolvedValue({
          status: 'drafting',
          error: null,
          openDecisions: [],
        }),
      );
      const card = await accepted();

      await drainAll();

      expect(builder.patchPrd).toHaveBeenCalled();
      expect(cards.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'roadmap_filing_failed' }),
        ]),
      );
      expect(cards.get(card.id).status).toBe(PmCardStatus.DESIGNING);
    });

    it("a PRD Builder's reviewer will not pass puts the card in needs_attention with the reason", async () => {
      builder.patchPrd.mockResolvedValue({
        ready: false,
        blockers: ['Name the success metric.'],
      });
      const card = await accepted();

      await drainAll();

      const stored = cards.get(card.id);
      expect(stored.status).toBe(PmCardStatus.NEEDS_ATTENTION);
      expect(stored.needsYouReason).toContain('Name the success metric.');
      expect(outbox.forCard(card.id)).toMatchObject({
        status: PmOutboxStatus.FAILED,
        step: PmOutboxStep.PATCH_PRD,
      });
      expect(builder.startDesign).not.toHaveBeenCalled();
    });

    it('a design with open decisions is not auto-approved', async () => {
      builder.designStatus.mockResolvedValue({
        status: 'review',
        error: null,
        openDecisions: ['Which table owns the streak?'],
      });
      const card = await accepted({
        status: PmCardStatus.QUEUED,
        builderSessionId: 'sess-1',
      });
      outbox.forCard(card.id)!.step = PmOutboxStep.AWAIT_DESIGN;

      await service.drain();

      expect(builder.approveDesign).not.toHaveBeenCalled();
      expect(cards.get(card.id).status).toBe(PmCardStatus.NEEDS_ATTENTION);
    });
  });

  describe('drain when Builder is full or paused', () => {
    const atBuild = async () => {
      const card = await accepted({
        status: PmCardStatus.DESIGNING,
        builderSessionId: 'sess-1',
      });
      outbox.forCard(card.id)!.step = PmOutboxStep.START_BUILD;
      return card;
    };

    it('waits in its status and retries when Builder is at its concurrency limit', async () => {
      builder.startBuild.mockRejectedValueOnce(
        new BadRequestException(
          '3 builds are already running, which is the current limit. Wait for one to finish.',
        ),
      );
      const card = await atBuild();

      await service.drain();
      expect(outbox.forCard(card.id)!.status).toBe(PmOutboxStatus.WAITING);
      expect(cards.get(card.id).status).toBe(PmCardStatus.DESIGNING);
      expect(await service.drain()).toBe(0); // not due yet

      clock.advance(5 * 60 * 1000 + 1);
      await service.drain();
      expect(builder.startBuild).toHaveBeenCalledTimes(2);
      expect(cards.get(card.id).status).toBe(PmCardStatus.BUILDING);
    });

    it.each([
      ['pauseAutoBuild', () => (settingsRow.pauseAutoBuild = true)],
      ['the circuit breaker', () => (settingsRow.autoBuildPaused = true)],
      [
        "Builder's kill switch",
        () =>
          builder.builderSettings.mockResolvedValue({
            enabled: false,
            maxConcurrentBuilds: 3,
          }),
      ],
    ])('%s stops starting builds', async (_label, pause) => {
      pause();
      const card = await atBuild();

      await service.drain();

      expect(builder.startBuild).not.toHaveBeenCalled();
      expect(outbox.forCard(card.id)!.status).toBe(PmOutboxStatus.WAITING);
    });
  });

  const pr = (over: Record<string, any> = {}) => ({
    merged: false,
    state: 'open',
    releaseState: null,
    ...over,
  });

  describe('status reconcile', () => {
    const building = { status: BuilderSessionStatus.BUILDING };

    it.each([
      ['a running build', building, [], PmCardStatus.BUILDING],
      ['an open PR', building, [pr()], PmCardStatus.PR_OPEN],
      [
        'merged, release pending',
        building,
        [pr({ merged: true, state: 'closed', releaseState: 'releasing' })],
        PmCardStatus.MERGED,
      ],
      [
        'merged and released',
        building,
        [pr({ merged: true, releaseState: 'released' })],
        PmCardStatus.RELEASED,
      ],
      [
        'merged, no pipeline (skipped)',
        building,
        [pr({ merged: true, releaseState: 'skipped' })],
        PmCardStatus.RELEASED,
      ],
      [
        'a failed release',
        building,
        [pr({ merged: true, releaseState: 'failed' })],
        PmCardStatus.MERGED_NOT_RELEASED,
      ],
      [
        'an unhealthy release',
        building,
        [pr({ merged: true, releaseState: 'unhealthy' })],
        PmCardStatus.MERGED_NOT_RELEASED,
      ],
      [
        'a PR closed unmerged',
        building,
        [pr({ state: 'closed' })],
        PmCardStatus.NEEDS_ATTENTION,
      ],
      [
        'a failed build',
        { status: BuilderSessionStatus.FAILED },
        [],
        PmCardStatus.FAILED,
      ],
      [
        'Builder asking a question',
        { status: BuilderSessionStatus.WAITING_FOR_INPUT },
        [],
        PmCardStatus.NEEDS_ATTENTION,
      ],
      [
        'completed with no PR',
        { status: BuilderSessionStatus.COMPLETED },
        [],
        PmCardStatus.NEEDS_ATTENTION,
      ],
    ])('maps %s', (_label, session, prs, expected) => {
      expect(PmAgentBuildService.deriveStatus(session, prs)?.status).toBe(
        expected,
      );
    });

    it('leaves a card still in design to the outbox', () => {
      expect(
        PmAgentBuildService.deriveStatus(
          { status: BuilderSessionStatus.PRD_READY },
          [],
        ),
      ).toBeNull();
    });

    it('records outcomes as delivery moves', async () => {
      const card = cards.add(
        makeCard({ status: PmCardStatus.BUILDING, builderSessionId: 'sess-1' }),
      );
      builder.getSession.mockResolvedValue({
        ...building,
        totalCostUsd: '1.2300',
      });
      builder.listPullRequests.mockResolvedValue([
        pr({ merged: true, releaseState: 'released' }),
      ]);

      await service.reconcile();

      expect(cards.get(card.id).status).toBe(PmCardStatus.RELEASED);
      expect(outcomes.flag).toHaveBeenCalledWith(
        card.id,
        expect.objectContaining({
          merged: true,
          released: true,
          buildCostUsd: '1.2300',
        }),
      );
      expect(settings.resetBuildFailures).toHaveBeenCalled();
    });
  });

  describe('circuit breaker', () => {
    const failOne = async () => {
      const card = cards.add(
        makeCard({ status: PmCardStatus.BUILDING, builderSessionId: 'sess-x' }),
      );
      builder.getSession.mockResolvedValue({
        status: BuilderSessionStatus.FAILED,
      });
      await service.reconcile();
      return card;
    };

    it('pauses auto-build after 3 consecutive failed builds, and says so once', async () => {
      await failOne();
      await failOne();
      expect(settingsRow.autoBuildPaused).toBe(false);

      await failOne();

      expect(settingsRow.autoBuildPaused).toBe(true);
      expect(settingsRow.autoBuildPausedReason).toContain('3 builds failed');
      expect(slack.sendMessage).toHaveBeenCalledTimes(1);
      expect(events.stateUpdated).toHaveBeenCalled();
    });

    it('counts a failure once even when reconcile sees it again', async () => {
      await failOne();
      await service.reconcile(); // same FAILED card, same FAILED session

      expect(settings.incrementBuildFailures).toHaveBeenCalledTimes(1);
    });

    it('a success in between resets the count', async () => {
      await failOne();
      await failOne();
      const ok = cards.add(
        makeCard({ status: PmCardStatus.PR_OPEN, builderSessionId: 'sess-ok' }),
      );
      builder.getSession.mockImplementation(async (id: string) =>
        id === 'sess-ok'
          ? { status: BuilderSessionStatus.COMPLETED }
          : { status: BuilderSessionStatus.FAILED },
      );
      builder.listPullRequests.mockImplementation(async (id: string) =>
        id === 'sess-ok'
          ? [pr({ merged: true, releaseState: 'released' })]
          : [],
      );
      await service.reconcile();
      expect(cards.get(ok.id).status).toBe(PmCardStatus.RELEASED);

      await failOne();
      expect(settingsRow.autoBuildPaused).toBe(false);
    });

    it('a failed release health check pauses at once', async () => {
      cards.add(
        makeCard({ status: PmCardStatus.MERGED, builderSessionId: 'sess-h' }),
      );
      builder.getSession.mockResolvedValue({
        status: BuilderSessionStatus.COMPLETED,
      });
      builder.listPullRequests.mockResolvedValue([
        pr({ merged: true, state: 'closed', releaseState: 'unhealthy' }),
      ]);

      await service.reconcile();

      expect(settingsRow.autoBuildPaused).toBe(true);
      expect(settingsRow.autoBuildPausedReason).toContain('health check');
      expect(outcomes.flag).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ healthCheckFailed: true }),
      );
    });
  });
});
