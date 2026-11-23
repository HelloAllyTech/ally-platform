import { ForbiddenException } from '@nestjs/common';
import { ChatbotController } from '../../controller/chatbot.controller';
import { ChatbotMemberRole } from '../../enum/chatbot.enum';

/**
 * A1: the bot settings only platform admins could change ("Show typing" and `abilities`, so
 * `hand_over` too) now belong to the bot's owners. A platform admin who is not an owner is refused
 * like any editor; an owner who is not a platform admin may change them.
 */
describe('Settings moved from platform admins to owners (A1)', () => {
  const stored = { id: 'bot-1', settings: { showTyping: false } };

  function build(role: ChatbotMemberRole) {
    const assert = jest.fn(
      async (
        _id: string,
        min: ChatbotMemberRole = ChatbotMemberRole.VIEWER,
      ) => {
        const rank: Record<ChatbotMemberRole, number> = {
          viewer: 0,
          responder: 0,
          editor: 1,
          owner: 2,
        };
        if (rank[role] < rank[min]) throw new ForbiddenException('not owner');
        return { chatbot: stored, role };
      },
    );
    const access = {
      assert,
      assertPlatformAdmin: jest.fn(async () => {
        throw new Error('platform admin is no longer asked');
      }),
    };
    const settings = {
      updateChatbotSettings: jest.fn(async () => ({ ok: true })),
    };
    const controller = new ChatbotController(
      {} as never,
      access as never,
      {} as never,
      settings as never,
    );
    return { controller, assert, settings, access };
  }

  const changes = [
    { name: 'Show typing', settings: { showTyping: true } },
    {
      name: 'hand_over in abilities',
      settings: { showTyping: false, abilities: { hand_over: 'do_it' } },
    },
  ];

  for (const change of changes) {
    it(`lets an owner change ${change.name}`, async () => {
      const { controller, assert, settings, access } = build(
        ChatbotMemberRole.OWNER,
      );
      await expect(
        controller.updateSettings('bot-1', {
          settings: change.settings,
        } as never),
      ).resolves.toEqual({ ok: true });
      expect(assert).toHaveBeenCalledWith('bot-1', ChatbotMemberRole.OWNER);
      expect(settings.updateChatbotSettings).toHaveBeenCalled();
      expect(access.assertPlatformAdmin).not.toHaveBeenCalled();
    });

    it(`refuses an editor who changes ${change.name}`, async () => {
      const { controller, settings } = build(ChatbotMemberRole.EDITOR);
      await expect(
        controller.updateSettings('bot-1', {
          settings: change.settings,
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(settings.updateChatbotSettings).not.toHaveBeenCalled();
    });
  }

  it('lets an editor save other settings that round-trip the owner-only ones', async () => {
    const { controller, assert } = build(ChatbotMemberRole.EDITOR);
    await expect(
      controller.updateSettings('bot-1', {
        settings: { showTyping: false },
      } as never),
    ).resolves.toEqual({ ok: true });
    expect(assert).not.toHaveBeenCalledWith('bot-1', ChatbotMemberRole.OWNER);
  });
});
