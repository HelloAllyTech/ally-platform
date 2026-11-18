import {
  BuilderHistoryService,
  historyFieldsFromDecision,
} from '../builder-history.service';

/**
 * History is what the scoreboard will read, so the fields frozen here are the
 * definitions: what "agreed with the recommendation" means, and that a failed
 * write never fails the action it was recording.
 */
describe('BuilderHistoryService', () => {
  const decision = (over: Record<string, any> = {}): any => ({
    id: 'question:sess-1:q-1',
    kind: 'question',
    category: 'what',
    sessionId: 'sess-1',
    sessionTitle: 'Weekly digest email',
    questionType: 'behaviour',
    prompt: 'Monday or Friday?',
    options: [
      { id: 'mon', label: 'Monday', recommended: true },
      { id: 'fri', label: 'Friday' },
    ],
    waitingSince: '2026-10-28T09:00:00.000Z',
    ...over,
  });
  const now = new Date('2026-10-28T09:10:00.000Z');
  const context = { surface: 'now' as const, actorUserId: 42 };

  describe('historyFieldsFromDecision', () => {
    it('freezes the card and counts agreement with the recommendation', () => {
      const row = historyFieldsFromDecision(
        decision(),
        { selectedOptionIds: ['mon'] },
        { ...context, client: 'phone', msToDecide: 1834.4 },
        now,
      );

      expect(row).toMatchObject({
        entryType: 'decision',
        decisionId: 'question:sess-1:q-1',
        prompt: 'Monday or Friday?',
        chosenOptionIds: ['mon'],
        chosenLabel: 'Monday',
        recommendedOptionId: 'mon',
        matchedRecommendation: true,
        oneWay: false,
        surface: 'now',
        client: 'phone',
        actorUserId: 42,
        waitSeconds: 600,
        msToDecide: 1834,
      });
    });

    it('is not agreement when the person picked otherwise or added words', () => {
      expect(
        historyFieldsFromDecision(
          decision(),
          { selectedOptionIds: ['fri'] },
          context,
          now,
        ).matchedRecommendation,
      ).toBe(false);
      expect(
        historyFieldsFromDecision(
          decision(),
          { selectedOptionIds: ['mon'], customText: 'but only in term time' },
          context,
          now,
        ).matchedRecommendation,
      ).toBe(false);
    });

    it('has no agreement to count for a one-option or unrecommended card', () => {
      const merge = decision({
        id: 'pr_merge:sess-1:pr-1',
        kind: 'pr_merge',
        options: [
          { id: 'merge', label: 'Merge', recommended: true, oneWay: true },
        ],
      });
      const row = historyFieldsFromDecision(
        merge,
        { selectedOptionIds: ['merge'] },
        context,
        now,
      );
      expect(row.matchedRecommendation).toBeNull();
      expect(row.oneWay).toBe(true);
      expect(row.pullRequestId).toBe('pr-1');

      expect(
        historyFieldsFromDecision(
          decision({
            options: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          }),
          { selectedOptionIds: ['a'] },
          context,
          now,
        ).matchedRecommendation,
      ).toBeNull();
    });

    it('treats the legacy confirm flag as one-way', () => {
      const row = historyFieldsFromDecision(
        decision({
          options: [{ id: 'stop', label: 'Stop', confirm: true }],
        }),
        { selectedOptionIds: ['stop'] },
        context,
        now,
      );
      expect(row.oneWay).toBe(true);
    });

    it('uses the typed words as the label when nothing was picked', () => {
      const row = historyFieldsFromDecision(
        decision(),
        { customText: 'Wednesday' },
        context,
        now,
      );
      expect(row.chosenLabel).toBe('Wednesday');
      expect(row.chosenOptionIds).toBeNull();
    });
  });

  describe('record', () => {
    it('never throws when the insert fails', async () => {
      const repository = {
        create: jest.fn((value) => value),
        save: jest.fn().mockRejectedValue(new Error('db down')),
      };
      const service = new BuilderHistoryService(
        repository as never,
        {} as never,
      );

      await expect(
        service.recordDecision(
          decision(),
          { selectedOptionIds: ['mon'] },
          context,
        ),
      ).resolves.toBeNull();
    });
  });
});
