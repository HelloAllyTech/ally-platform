import { BadRequestException } from '@nestjs/common';
import { HOME_FIELDS, HomeState } from 'src/bot-draft/home/home-fields';
import { DEFAULT_WHATSAPP_SETTINGS } from 'src/whatsapp/type/whatsapp-settings.type';
import { ChatbotSettingsService } from '../chatbot-settings.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * `abilities` (chunk 3b): what the agent may do, per bot, set by platform admins. It lives on the
 * bot's stored override only, so a platform-wide save can't turn a tool on for every bot, and an
 * owner's save from any screen keeps it as stored.
 */
describe('ChatbotSettingsService: abilities', () => {
  const global = { ...DEFAULT_WHATSAPP_SETTINGS };
  const make = () => {
    const chatbotRepository = { update: jest.fn() };
    const globalSettingsRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 1, value: global }),
      update: jest.fn(),
      save: jest.fn(),
      create: jest.fn((row) => row),
    };
    const service = new ChatbotSettingsService(
      globalSettingsRepository as never,
      chatbotRepository as never,
    );
    return { service, chatbotRepository, globalSettingsRepository };
  };

  it('stores do_it and never on the bot', async () => {
    const { service, chatbotRepository } = make();
    const view = await service.updateChatbotSettings(
      { id: 'bot-1' },
      { abilities: { hand_over: 'do_it', other: 'never' } },
    );
    expect(chatbotRepository.update).toHaveBeenCalledWith(
      { id: 'bot-1' },
      expect.objectContaining({
        settings: { abilities: { hand_over: 'do_it', other: 'never' } },
      }),
    );
    expect(view.overrides.abilities).toEqual({
      hand_over: 'do_it',
      other: 'never',
    });
  });

  it.each([
    [{ hand_over: 'ask_me_first' }],
    [{ hand_over: true }],
    [['hand_over']],
    ['do_it'],
  ])('refuses abilities %j', async (abilities) => {
    const { service, chatbotRepository } = make();
    await expect(
      service.updateChatbotSettings({ id: 'bot-1' }, {
        abilities,
      } as never),
    ).rejects.toThrow(BadRequestException);
    expect(chatbotRepository.update).not.toHaveBeenCalled();
  });

  it('refuses abilities in the platform-wide settings (400), and writes nothing', async () => {
    const { service, globalSettingsRepository } = make();
    await expect(
      service.update({ abilities: { hand_over: 'do_it' } } as never),
    ).rejects.toThrow(BadRequestException);
    expect(globalSettingsRepository.update).not.toHaveBeenCalled();
    expect(globalSettingsRepository.save).not.toHaveBeenCalled();
  });

  it('keeps abilities out of the effective settings', () => {
    const { service } = make();
    const effective = service.applyOverride(global, {
      declineText: 'Ask us.',
      abilities: { hand_over: 'do_it' },
    });
    expect(effective).not.toHaveProperty('abilities');
    expect(effective.declineText).toBe('Ask us.');
  });

  describe("an owner's save from the assistant home keeps them", () => {
    const abilities = { hand_over: 'do_it' as const };
    const state = {
      chatbot: {
        name: 'Bot',
        description: '',
        persona: {},
        settings: { abilities, declineText: 'Old.' },
        safetyPack: null,
        rules: null,
        accessMode: 'anyone',
      },
      page: { branding: { disclaimer: '' } },
      pageRow: {},
      publicAllowed: false,
    } as unknown as HomeState;

    it.each([
      ['declineText', 'Ask the front desk.'],
      ['crisisText', 'Call 14416.'],
      ['busyText', 'One moment.'],
      ['disclaimer', 'Not medical advice.'],
    ] as const)('%s', (field, value) => {
      const written = (HOME_FIELDS[field] as any).write(value, state);
      expect(written.chatbot.settings.abilities).toEqual(abilities);
      const cleared = (HOME_FIELDS[field] as any).write('', state);
      expect(cleared.chatbot.settings.abilities).toEqual(abilities);
    });

    it('handover', () => {
      const value = HOME_FIELDS.handover.read(state);
      const written = HOME_FIELDS.handover.write(value, state);
      expect(written.chatbot?.settings?.abilities).toEqual(abilities);
    });
  });
});
