import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FeatureToggleKey } from '../../../authorization/constants/admin-feature-toggle.constants';
import { ChatbotMemberRole } from '../../enum/chatbot.enum';
import { ChatbotAccessService } from '../chatbot-access.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * A1: everyone, platform admins included, sees exactly the bots they are members of, at the role
 * they were given. A bot you are not on answers like one that does not exist.
 */
describe('ChatbotAccessService', () => {
  const BOT = { id: 'bot-1', name: 'Bot' };
  let bot: { id: string; name: string; archivedAt?: Date | null };
  let platformWide: boolean;
  let chatbotsFeature: boolean;
  let membership: { role: ChatbotMemberRole } | null;
  let memberRows: { chatbotId: string }[];
  let hasToggle: jest.Mock;
  let service: ChatbotAccessService;

  beforeEach(() => {
    bot = BOT;
    platformWide = false;
    chatbotsFeature = false;
    membership = null;
    memberRows = [{ chatbotId: 'bot-1' }];
    hasToggle = jest.fn(
      async (_userId: number, key: string) =>
        key === FeatureToggleKey.WHATSAPP_BOT && chatbotsFeature,
    );
    service = new ChatbotAccessService(
      { findOne: jest.fn(async () => bot) } as never,
      {
        findOne: jest.fn(async () => membership),
        find: jest.fn(async () => memberRows),
      } as never,
      {
        resolveTenantIds: jest.fn(async () =>
          platformWide ? null : ['org-a'],
        ),
      } as never,
      { hasToggle } as never,
    );
  });

  it('hides a bot from a platform admin who is not on it (404)', async () => {
    platformWide = true;
    for (const role of Object.values(ChatbotMemberRole)) {
      await expect(service.assert('bot-1', role)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
  });

  it('gives a platform admin who is on a bot exactly their role there', async () => {
    platformWide = true;
    membership = { role: ChatbotMemberRole.VIEWER };
    await expect(service.assert('bot-1')).resolves.toMatchObject({
      role: ChatbotMemberRole.VIEWER,
    });
    await expect(
      service.assert('bot-1', ChatbotMemberRole.EDITOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hides a bot from someone who is not on it', async () => {
    await expect(service.assert('bot-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets a viewer look but not change', async () => {
    membership = { role: ChatbotMemberRole.VIEWER };
    await expect(service.assert('bot-1')).resolves.toBeTruthy();
    await expect(
      service.assert('bot-1', ChatbotMemberRole.EDITOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps members and connectors to owners', async () => {
    membership = { role: ChatbotMemberRole.EDITOR };
    await expect(
      service.assert('bot-1', ChatbotMemberRole.OWNER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    membership = { role: ChatbotMemberRole.OWNER };
    await expect(
      service.assert('bot-1', ChatbotMemberRole.OWNER),
    ).resolves.toBeTruthy();
  });

  it('lets a removed bot be read, by its members only, and never changed', async () => {
    bot = { ...BOT, archivedAt: new Date('2026-11-11') };
    membership = { role: ChatbotMemberRole.OWNER };
    await expect(service.assert('bot-1')).resolves.toBeTruthy();
    for (const role of [ChatbotMemberRole.EDITOR, ChatbotMemberRole.OWNER]) {
      await expect(service.assert('bot-1', role)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
    membership = null;
    await expect(service.assert('bot-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists only a member’s bots, platform admins included (no list of every bot)', async () => {
    await expect(service.accessibleChatbotIds()).resolves.toEqual(['bot-1']);
    platformWide = true;
    await expect(service.accessibleChatbotIds()).resolves.toEqual(['bot-1']);
    memberRows = [];
    await expect(service.accessibleChatbotIds()).resolves.toEqual([]);
  });

  it('gives a platform admin no role on bots they are not on', async () => {
    platformWide = true;
    memberRows = [];
    const roles = await service.rolesFor(['bot-1', 'bot-2']);
    expect(roles.size).toBe(0);
  });

  it('lets anyone with the Chatbots feature create a bot, and nobody else', async () => {
    await expect(service.canCreate()).resolves.toBe(false);
    await expect(service.assertCanCreate()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    chatbotsFeature = true;
    await expect(service.canCreate()).resolves.toBe(true);
    await expect(service.assertCanCreate()).resolves.toBeUndefined();
    expect(hasToggle).toHaveBeenCalledWith(7, FeatureToggleKey.WHATSAPP_BOT);
  });

  it('keeps what belongs to no bot to platform admins', async () => {
    await expect(service.assertPlatformAdmin()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    platformWide = true;
    await expect(service.assertPlatformAdmin()).resolves.toBeUndefined();
  });
});
