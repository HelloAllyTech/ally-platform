import { DEFAULT_WHATSAPP_SETTINGS } from 'src/whatsapp/type/whatsapp-settings.type';
import {
  ChatbotSettingsService,
  cleanOverride,
} from '../chatbot-settings.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * A bot's settings are the defaults with its changes on top. Wording is the bot's to choose; the
 * safety and cost levers only tighten, so a bot's settings screen is never a way round the
 * platform's crisis safety net or its rate limits.
 */
describe('ChatbotSettingsService', () => {
  const global = { ...DEFAULT_WHATSAPP_SETTINGS, enabled: true };
  let service: ChatbotSettingsService;
  let chatbotRepository: { update: jest.Mock };

  beforeEach(() => {
    chatbotRepository = { update: jest.fn() };
    service = new ChatbotSettingsService(
      {
        findOne: jest.fn().mockResolvedValue({ value: global }),
      } as never,
      chatbotRepository as never,
    );
  });

  it('uses the bot’s wording', () => {
    const merged = service.applyOverride(global, { declineText: 'Ask HR.' });
    expect(merged.declineText).toBe('Ask HR.');
  });

  it('never lets a bot switch the crisis classifier or consent off', () => {
    const merged = service.applyOverride(
      { ...global, crisisClassifierEnabled: true, consentRequired: true },
      { crisisClassifierEnabled: false, consentRequired: false },
    );
    expect(merged.crisisClassifierEnabled).toBe(true);
    expect(merged.consentRequired).toBe(true);
  });

  it('lets a bot be stricter than the platform', () => {
    const merged = service.applyOverride(
      { ...global, crisisClassifierEnabled: false },
      { crisisClassifierEnabled: true },
    );
    expect(merged.crisisClassifierEnabled).toBe(true);
  });

  it('only ever lowers rate limits', () => {
    const merged = service.applyOverride(global, {
      rateLimit: { perMinute: 2, perHour: 10_000 },
    });
    expect(merged.rateLimit.perMinute).toBe(2);
    expect(merged.rateLimit.perHour).toBe(global.rateLimit.perHour);
  });

  it('cannot switch a bot on against the platform switch', () => {
    const merged = service.applyOverride(
      { ...global, enabled: false },
      { enabled: true },
    );
    expect(merged.enabled).toBe(false);
  });

  it('never lets a bot turn the new engine on past the platform kill switch', () => {
    const off = service.applyOverride(
      { ...global, agentRuntimeAllowed: false },
      { agentRuntimeAllowed: true } as never,
    );
    expect(off.agentRuntimeAllowed).toBe(false);

    const on = service.applyOverride({ ...global, agentRuntimeAllowed: true }, {
      agentRuntimeAllowed: false,
      declineText: 'x',
    } as never);
    expect(on.agentRuntimeAllowed).toBe(true);
  });

  it('treats a cleared field as "follow the default"', () => {
    expect(
      cleanOverride({
        declineText: '  ',
        helplineNumbers: '112',
        rateLimit: {},
      }),
    ).toEqual({ helplineNumbers: '112' });
  });

  it('shows defaults, changes and the result for the settings screen', async () => {
    const view = await service.getChatbotView({
      id: 'bot-1',
      settings: { declineText: 'Ask HR.' },
    });
    expect(view.defaults.declineText).toBe(global.declineText);
    expect(view.overrides).toEqual({ declineText: 'Ask HR.' });
    expect(view.effective.declineText).toBe('Ask HR.');
  });

  it('stores the cleaned changes on the bot', async () => {
    await service.updateChatbotSettings({ id: 'bot-1' }, { declineText: '' });
    expect(chatbotRepository.update).toHaveBeenCalledWith(
      { id: 'bot-1' },
      { settings: {}, updatedBy: 7 },
    );
  });
});
