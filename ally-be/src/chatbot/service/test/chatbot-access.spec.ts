import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatbotMemberRole } from '../../enum/chatbot.enum';
import { ChatbotAccessService } from '../chatbot-access.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

/**
 * Platform admins manage every bot; everyone else sees exactly the bots they are members of, at
 * the role they were given. A bot you are not on answers like one that does not exist.
 */
describe('ChatbotAccessService', () => {
  const BOT = { id: 'bot-1', name: 'Bot' };
  let platformWide: boolean;
  let membership: { role: ChatbotMemberRole } | null;
  let service: ChatbotAccessService;

  beforeEach(() => {
    platformWide = false;
    membership = null;
    service = new ChatbotAccessService(
      { findOne: jest.fn(async () => BOT) } as never,
      {
        findOne: jest.fn(async () => membership),
        find: jest.fn(async () => [{ chatbotId: 'bot-1' }]),
      } as never,
      {
        resolveTenantIds: jest.fn(async () => (platformWide ? null : ['org-a'])),
      } as never,
    );
  });

  it('lets a platform admin act on any bot as owner', async () => {
    platformWide = true;
    await expect(service.assert('bot-1', ChatbotMemberRole.OWNER)).resolves.toMatchObject({
      role: ChatbotMemberRole.OWNER,
    });
  });

  it('hides a bot from someone who is not on it', async () => {
    await expect(service.assert('bot-1')).rejects.toBeInstanceOf(NotFoundException);
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
  });

  it('lists only a member’s bots, and every bot for a platform admin', async () => {
    await expect(service.accessibleChatbotIds()).resolves.toEqual(['bot-1']);
    platformWide = true;
    await expect(service.accessibleChatbotIds()).resolves.toBeNull();
  });

  it('keeps creating bots to platform admins', async () => {
    await expect(service.assertPlatformAdmin()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
