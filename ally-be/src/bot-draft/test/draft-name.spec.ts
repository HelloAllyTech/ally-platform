import { BotDraftService } from '../service/bot-draft.service';
import type { BotDraftEntity } from '../entity/bot-draft.entity';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

/**
 * TF1 F12: Try it and the checkup said "Answers from Your assistant's own information" and "you
 * can reach Your assistant on…" while the working copy was named Saathi Youth Helpline.
 */
describe('the name typed in setup names the not-yet-live assistant', () => {
  const setup = () => {
    const query = jest.fn().mockResolvedValue([]);
    const builder = {
      update: () => builder,
      set: () => builder,
      where: () => builder,
      setParameter: () => builder,
      execute: async () => ({ affected: 1 }),
    };
    const service = new BotDraftService(
      { createQueryBuilder: () => builder, manager: { query } } as never,
      {} as never,
      { isPlatformAdmin: async () => false } as never,
      { publish: jest.fn() } as never,
      { emit: jest.fn() } as never,
    );
    const draft = (name: string) =>
      ({
        id: 'd1',
        chatbotId: 'bot-1',
        source: {},
        learned: { facts: [], dropped: 0 },
        answers: {},
        design: {},
        draftConfig: BotDraftService.defaultDraft(name),
        transcript: [],
        events: [],
        version: 1,
      }) as unknown as BotDraftEntity;
    return { service, query, draft };
  };

  it('writes it to the chatbot row while that is still a draft', async () => {
    const h = setup();
    await h.service.update(h.draft('Saathi Youth Helpline'), {});
    expect(h.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE chatbots SET name = \$2::text,[\s\S]*WHERE id = \$1 AND status = 'draft'/,
      ),
      ['bot-1', 'Saathi Youth Helpline'],
    );
  });

  it('never a placeholder', async () => {
    const h = setup();
    await h.service.update(h.draft('Your assistant'), {});
    expect(h.query).not.toHaveBeenCalled();
  });

  // TF1 N3: the card and the chat label said "Your assistant" after the owner had named it.
  it('the chat name follows the name while it is still the default', async () => {
    const h = setup();
    const draft = h.draft('Saathi Youth Helpline');
    draft.draftConfig.assistantName = 'Your assistant';
    const saved = await h.service.update(draft, {});
    expect(saved.draftConfig.assistantName).toBe('Saathi Youth Helpline');
  });

  it('never touches a chat name the owner chose', async () => {
    const h = setup();
    const draft = h.draft('Saathi Youth Helpline');
    draft.draftConfig.assistantName = 'Saathi';
    const saved = await h.service.update(draft, {});
    expect(saved.draftConfig.assistantName).toBe('Saathi');
  });
});
