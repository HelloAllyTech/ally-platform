import { ConflictException } from '@nestjs/common';
import { BotPageStatus } from '../../chatbot/enum/bot-page.enum';
import {
  ChatbotMemberRole,
  ChatbotStatus,
} from '../../chatbot/enum/chatbot.enum';
import { ChatbotService } from '../../chatbot/service/chatbot.service';
import { BotDraftStatus, BotDraftStep } from '../enum/bot-draft.enum';
import { AssistantHomeService } from '../home/assistant-home.service';
import { BotDraftPublishService } from '../service/bot-draft-publish.service';

/**
 * Stage 4 (D10): the go-live gate on every path that makes a chatbot live. Each path refuses before
 * it writes anything when the gate says something is missing.
 */
const refusal = () =>
  new ConflictException({
    errorCode: 'go_live_incomplete',
    details: { missing: [{ item: 'safety_terms' }] },
  });

const MISSING = [
  'audience_age',
  'human_contact',
  'purpose',
  'safety_terms',
  'crisis_check',
] as const;

describe.each(MISSING)('the go-live gate refuses without %s', (item) => {
  const gate = () => ({
    assertCanGoLive: jest.fn().mockRejectedValue(
      new ConflictException({
        errorCode: 'go_live_incomplete',
        details: { missing: [{ item }] },
      }),
    ),
  });

  it('on the status switch', async () => {
    const repo = { update: jest.fn(), manager: { query: jest.fn() } };
    const goLive = gate();
    const service = new ChatbotService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assert: jest.fn().mockResolvedValue({}) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      goLive as never,
    );
    const error = await service
      .setStatus('bot-1', ChatbotStatus.LIVE)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().details.missing[0].item).toBe(item);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.manager.query).not.toHaveBeenCalled();
  });

  it('on publish', async () => {
    const chatbots = { update: jest.fn() };
    const settings = {
      getForChatbot: jest.fn(),
      updateChatbotSettings: jest.fn(),
    };
    const goLive = gate();
    const service = new BotDraftPublishService(
      {} as never,
      {} as never,
      {
        assert: jest.fn().mockResolvedValue({ chatbot: { id: 'bot-1' } }),
      } as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
      chatbots as never,
      undefined,
      goLive as never,
    );
    const error = await service
      .publish(
        {
          id: 'draft-1',
          chatbotId: 'bot-1',
          step: BotDraftStep.SHARE,
          status: BotDraftStatus.ACTIVE,
          draftConfig: { purpose: 'answer' },
        } as never,
        { access: 'invite' } as never,
      )
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(goLive.assertCanGoLive).toHaveBeenCalledWith('bot-1', {
      purpose: 'answer',
    });
    expect(chatbots.update).not.toHaveBeenCalled();
    expect(settings.updateChatbotSettings).not.toHaveBeenCalled();
  });

  it('on the bot page toggle', async () => {
    const dataSource = { transaction: jest.fn(), query: jest.fn() };
    const goLive = gate();
    const service = new AssistantHomeService(
      dataSource as never,
      {
        assert: jest.fn().mockResolvedValue({ role: ChatbotMemberRole.OWNER }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      goLive as never,
    );
    const error = await service
      .saveField('bot-1', {
        field: 'pageStatus',
        value: BotPageStatus.ON,
        version: 'x',
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe('the go-live gate is not asked when nothing goes live', () => {
  it('pausing and turning the page off pass straight through', async () => {
    const goLive = { assertCanGoLive: jest.fn().mockRejectedValue(refusal()) };
    const repo = {
      update: jest.fn(),
      manager: { query: jest.fn() },
    };
    const service = new ChatbotService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { assert: jest.fn().mockResolvedValue({}) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      goLive as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({} as never);
    await service.setStatus('bot-1', ChatbotStatus.PAUSED);
    expect(goLive.assertCanGoLive).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });
});
