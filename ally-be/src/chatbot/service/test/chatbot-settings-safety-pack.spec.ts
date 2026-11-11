import { BadRequestException } from '@nestjs/common';
import { DEFAULT_WHATSAPP_SETTINGS } from 'src/whatsapp/type/whatsapp-settings.type';
import { SafetyPackId } from '../../../bot-draft/enum/bot-draft.enum';
import { ChatbotSettingsService } from '../chatbot-settings.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/** Chunk 20a: a bot's safety pack is a floor its settings can't go below. */
describe('ChatbotSettingsService with a safety pack', () => {
  const global = {
    ...DEFAULT_WHATSAPP_SETTINGS,
    enabled: true,
    crisisClassifierEnabled: false,
  };
  let service: ChatbotSettingsService;
  let chatbotRepository: { update: jest.Mock };

  beforeEach(() => {
    chatbotRepository = { update: jest.fn() };
    service = new ChatbotSettingsService(
      { findOne: jest.fn().mockResolvedValue({ value: global }) } as never,
      chatbotRepository as never,
    );
  });

  it('keeps the crisis classifier on for a health pack, whatever the default', async () => {
    const effective = await service.getForChatbot({
      settings: {},
      safetyPack: SafetyPackId.MEDICAL,
    } as never);
    expect(effective.crisisClassifierEnabled).toBe(true);
  });

  it('leaves a bot without a pack exactly as before', async () => {
    const effective = await service.getForChatbot({ settings: {} } as never);
    expect(effective.crisisClassifierEnabled).toBe(false);
  });

  it('refuses to turn the classifier off for a health pack, as safety_locked', async () => {
    const attempt = service.updateChatbotSettings(
      { id: 'bot-1', safetyPack: SafetyPackId.MENTAL_HEALTH } as never,
      { crisisClassifierEnabled: false },
    );
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toMatchObject({
      response: { errorCode: 'safety_locked' },
    });
    expect(chatbotRepository.update).not.toHaveBeenCalled();
  });

  it('lets a standard-pack bot change the same setting', async () => {
    await service.updateChatbotSettings(
      { id: 'bot-1', safetyPack: SafetyPackId.STANDARD } as never,
      { crisisClassifierEnabled: false },
    );
    expect(chatbotRepository.update).toHaveBeenCalled();
  });
});
