import { BadRequestException } from '@nestjs/common';
import { RoadmapOpportunityStage } from 'src/product-roadmap/enum/roadmap-opportunity.enum';
import { PmAgentFilingService } from '../service/pm-agent-filing.service';
import { PM_ROADMAP_READINESS_IDS } from '../gate/pm-critic';
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
 * Accept → roadmap: the outbox worker files an accepted card as a Product Manager Agent
 * opportunity, stops in front of a person when it should, never files twice, and the
 * reconcile follows the opportunity's roadmap stage afterwards.
 */
describe('PmAgentFilingService', () => {
  let clock: FakeClock;
  let cards: FakeCardRepository;
  let outbox: FakeOutboxRepository;
  let outcomes: { flag: jest.Mock };
  let laneStats: { bump: jest.Mock };
  let roadmap: Record<string, jest.Mock>;
  let events: { cardUpdated: jest.Mock };
  let impact: { onReleased: jest.Mock };
  let service: PmAgentFilingService;
  const ADMIN = 7;
  const graded = {
    readiness: {
      criteria: [...PM_ROADMAP_READINESS_IDS],
      failed: [],
      gradedAt: '2026-11-17T00:00:00.000Z',
    },
  };

  beforeEach(() => {
    clock = new FakeClock();
    cards = new FakeCardRepository(clock);
    outbox = new FakeOutboxRepository(clock);
    outcomes = { flag: jest.fn() };
    laneStats = { bump: jest.fn().mockResolvedValue(undefined) };
    roadmap = {
      findFiledForCard: jest.fn().mockResolvedValue(null),
      productGoalExists: jest.fn().mockResolvedValue(true),
      findDuplicates: jest.fn().mockResolvedValue([]),
      file: jest.fn().mockResolvedValue({ id: 'opp-1', code: 'OPP-0901' }),
      getOpportunities: jest.fn().mockResolvedValue(new Map()),
    };
    events = { cardUpdated: jest.fn() };
    impact = { onReleased: jest.fn().mockResolvedValue(undefined) };
    service = new PmAgentFilingService(
      cards as never,
      outbox as never,
      outcomes as never,
      laneStats as never,
      roadmap as never,
      events as never,
      impact as never,
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
        roadmapFiling: graded,
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

  describe('filing', () => {
    it('does nothing before the undo window closes', async () => {
      const card = cards.add(
        makeCard({
          status: PmCardStatus.ACCEPTED_PENDING,
          undoUntil: new Date(clock.now + 10_000),
          roadmapFiling: graded,
        }),
      );
      await outbox.insertWith(null, {
        cardId: card.id,
        dueAt: new Date(clock.now + 10_000),
        createdBy: ADMIN,
      });

      expect(await service.drain()).toBe(0);
      expect(roadmap.file).not.toHaveBeenCalled();
    });

    it('files the drafted entry as written, by the accepting admin, and marks the card filed', async () => {
      const card = await accepted();

      await service.drain();

      const opportunity = card.payload.opportunity;
      expect(roadmap.findDuplicates).toHaveBeenCalledWith(
        opportunity.description,
        opportunity.productGoal,
      );
      expect(roadmap.file).toHaveBeenCalledWith({
        userId: ADMIN,
        cardId: card.id,
        description: opportunity.description,
        productGoal: opportunity.productGoal,
        effort: opportunity.effort,
      });
      expect(cards.get(card.id)).toMatchObject({
        status: PmCardStatus.FILED,
        roadmapOpportunityId: 'opp-1',
      });
      expect(outbox.forCard(card.id)).toMatchObject({
        status: PmOutboxStatus.DONE,
        step: PmOutboxStep.DONE,
      });
      expect(events.cardUpdated).toHaveBeenCalledWith(card.id);
    });

    it('adopts an opportunity already filed for the card instead of filing it twice', async () => {
      const card = await accepted();
      roadmap.findFiledForCard.mockResolvedValue('opp-earlier');

      await service.drain();

      expect(roadmap.file).not.toHaveBeenCalled();
      expect(cards.get(card.id)).toMatchObject({
        status: PmCardStatus.FILED,
        roadmapOpportunityId: 'opp-earlier',
      });
    });

    it('stops on a roadmap duplicate, keeps what matched, and files after File anyway', async () => {
      const card = await accepted();
      const duplicates = [
        { id: 'opp-7', code: 'OPP-0007', reason: 'Same streak chip' },
      ];
      roadmap.findDuplicates.mockResolvedValue(duplicates);

      await service.drain();

      expect(roadmap.file).not.toHaveBeenCalled();
      expect(cards.get(card.id)).toMatchObject({
        status: PmCardStatus.NEEDS_ATTENTION,
        roadmapFiling: { ...graded, duplicates },
      });
      expect(cards.get(card.id).needsYouReason).toContain('OPP-0007');
      expect(outbox.forCard(card.id)!.status).toBe(PmOutboxStatus.FAILED);

      // File anyway (PmAgentCardService.fileAnyway): override recorded, row reopened.
      await cards.transition({
        cardId: card.id,
        from: [PmCardStatus.NEEDS_ATTENTION],
        to: PmCardStatus.QUEUED,
        patch: {
          roadmapFiling: {
            ...cards.get(card.id).roadmapFiling,
            fileAnyway: { by: ADMIN, at: clock.date().toISOString() },
          },
        },
        event: { type: 'file_anyway', actorUserId: ADMIN },
      });
      await outbox.reopen(card.id, PmOutboxStep.FILE_ROADMAP, ADMIN);
      roadmap.findDuplicates.mockClear();

      await service.drain();

      expect(roadmap.findDuplicates).not.toHaveBeenCalled();
      expect(roadmap.file).toHaveBeenCalledTimes(1);
      expect(cards.get(card.id).status).toBe(PmCardStatus.FILED);
    });

    it.each([
      [
        'a checklist that changed after grading',
        {
          roadmapFiling: {
            readiness: { criteria: ['pain_or_gain'], failed: [] },
          },
        },
        /checklist changed/,
      ],
      ['a card never graded', { roadmapFiling: null }, /checklist changed/],
    ])('stops for %s', async (_label, over, reason) => {
      const card = await accepted(over);

      await service.drain();

      expect(roadmap.file).not.toHaveBeenCalled();
      expect(cards.get(card.id).status).toBe(PmCardStatus.NEEDS_ATTENTION);
      expect(cards.get(card.id).needsYouReason).toMatch(reason);
    });

    it('stops when the product goal is no longer on the roadmap', async () => {
      const card = await accepted();
      roadmap.productGoalExists.mockResolvedValue(false);

      await service.drain();

      expect(cards.get(card.id).needsYouReason).toMatch(
        /no longer on the roadmap/,
      );
    });

    it("stops with the roadmap's own reason when it refuses the filing", async () => {
      const card = await accepted();
      roadmap.file.mockRejectedValue(
        new BadRequestException(
          'This opportunity is not ready to file yet (size).',
        ),
      );

      await service.drain();

      expect(cards.get(card.id)).toMatchObject({
        status: PmCardStatus.NEEDS_ATTENTION,
      });
      expect(cards.get(card.id).needsYouReason).toContain(
        'not ready to file yet',
      );
    });

    it('parks a transient failure for a retry instead of stopping', async () => {
      const card = await accepted();
      roadmap.file.mockRejectedValue(new Error('connection reset'));

      await service.drain();

      expect(cards.get(card.id).status).toBe(PmCardStatus.QUEUED);
      expect(outbox.forCard(card.id)).toMatchObject({
        status: PmOutboxStatus.WAITING,
        lastError: 'connection reset',
      });
    });

    it('cancels the row when the card was undone in the meantime', async () => {
      const card = await accepted({ status: PmCardStatus.OPEN });

      await service.drain();

      expect(roadmap.file).not.toHaveBeenCalled();
      expect(outbox.forCard(card.id)!.status).toBe(PmOutboxStatus.CANCELLED);
    });
  });

  describe('reconcile', () => {
    const filed = (over: Record<string, any> = {}) =>
      cards.add(
        makeCard({
          status: PmCardStatus.FILED,
          roadmapOpportunityId: 'opp-1',
          ...over,
        }),
      );
    const view = (over: Record<string, any>) =>
      new Map([
        [
          'opp-1',
          {
            id: 'opp-1',
            code: 'OPP-0901',
            stage: RoadmapOpportunityStage.NEW,
            releasedAt: null,
            deleted: false,
            ...over,
          },
        ],
      ]);

    it('leaves a card filed while its opportunity is new or prioritised', async () => {
      const card = filed();
      roadmap.getOpportunities.mockResolvedValue(
        view({ stage: RoadmapOpportunityStage.PRIORITISED }),
      );

      expect(await service.reconcile()).toBe(0);
      expect(cards.get(card.id).status).toBe(PmCardStatus.FILED);
    });

    it('a release counts as shipped and starts the impact checks at the release time', async () => {
      const card = filed();
      const releasedAt = new Date('2026-12-01T10:00:00Z');
      roadmap.getOpportunities.mockResolvedValue(
        view({ stage: RoadmapOpportunityStage.RELEASED, releasedAt }),
      );

      expect(await service.reconcile()).toBe(1);

      expect(cards.get(card.id).status).toBe(PmCardStatus.RELEASED);
      expect(outcomes.flag).toHaveBeenCalledWith(card.id, { released: true });
      expect(laneStats.bump).toHaveBeenCalledWith(
        'category',
        card.category,
        'shipped',
      );
      expect(impact.onReleased).toHaveBeenCalledWith(
        expect.objectContaining({ id: card.id }),
        releasedAt,
      );
    });

    it.each([
      ['archived', view({ stage: RoadmapOpportunityStage.ARCHIVED })],
      ['removed', view({ deleted: true })],
      ['gone', new Map()],
    ])(
      'an opportunity %s on the roadmap is a soft negative',
      async (_l, rows) => {
        const card = filed();
        roadmap.getOpportunities.mockResolvedValue(rows);

        await service.reconcile();

        expect(cards.get(card.id).status).toBe(PmCardStatus.ROADMAP_ARCHIVED);
        expect(outcomes.flag).toHaveBeenCalledWith(card.id, {
          roadmapArchived: true,
        });
        expect(impact.onReleased).not.toHaveBeenCalled();
      },
    );
  });
});
