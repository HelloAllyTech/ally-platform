import { BadRequestException } from '@nestjs/common';
import {
  ChatbotAccessMode,
  ChatbotAudienceKind,
} from '../../enum/chatbot.enum';
import { ChatbotAudienceService } from '../chatbot-audience.service';
import type { ChatSender } from '../../engine/chatbot-engine.types';

/**
 * "Who can chat" is checked against whatever the channel could tell about the sender, so any
 * channel gets the same rules without access logic of its own.
 */
describe('ChatbotAudienceService', () => {
  const sender: ChatSender = {
    externalId: '+919876543210',
    label: 'contact ending 3210',
    phone: '+91 98765 43210',
    userId: 42,
    tenantId: 'org-a',
    email: 'Asha@Example.org',
  };
  let entries: { kind: ChatbotAudienceKind; value: string }[];
  let service: ChatbotAudienceService;

  beforeEach(() => {
    entries = [];
    service = new ChatbotAudienceService({
      find: async () => entries,
    } as never);
  });

  const canChat = (accessMode: ChatbotAccessMode, who: ChatSender = sender) =>
    service.canChat({ id: 'bot-1', accessMode }, who);

  it('lets anyone chat with an open bot', async () => {
    await expect(
      canChat(ChatbotAccessMode.ANYONE, { externalId: 'x', label: 'x' }),
    ).resolves.toBe(true);
  });

  it('lets any recognised Ally user chat, and no one else', async () => {
    await expect(canChat(ChatbotAccessMode.RECOGNISED)).resolves.toBe(true);
    await expect(
      canChat(ChatbotAccessMode.RECOGNISED, { externalId: 'x', label: 'x' }),
    ).resolves.toBe(false);
  });

  it.each([
    [ChatbotAudienceKind.USER, '42'],
    [ChatbotAudienceKind.ORGANISATION, 'org-a'],
    [ChatbotAudienceKind.PHONE, '+919876543210'],
    [ChatbotAudienceKind.EMAIL, 'asha@example.org'],
  ])('lets a listed %s chat', async (kind, value) => {
    entries = [{ kind, value }];
    await expect(canChat(ChatbotAccessMode.LISTED)).resolves.toBe(true);
  });

  it('refuses someone not on the list', async () => {
    entries = [{ kind: ChatbotAudienceKind.ORGANISATION, value: 'org-b' }];
    await expect(canChat(ChatbotAccessMode.LISTED)).resolves.toBe(false);
  });

  it('stores phones and emails in one comparable form', () => {
    expect(
      ChatbotAudienceService.normaliseValue(
        ChatbotAudienceKind.PHONE,
        '+91 98765-43210',
      ),
    ).toBe('+919876543210');
    expect(
      ChatbotAudienceService.normaliseValue(
        ChatbotAudienceKind.EMAIL,
        ' A@B.org ',
      ),
    ).toBe('a@b.org');
    expect(() =>
      ChatbotAudienceService.normaliseValue(
        ChatbotAudienceKind.PHONE,
        'call me',
      ),
    ).toThrow(BadRequestException);
  });

  it('marks a phone or email entry signed in once that identity is proven', async () => {
    const listed = [
      { kind: ChatbotAudienceKind.EMAIL, value: 'asha@example.org' },
      { kind: ChatbotAudienceKind.EMAIL, value: 'ravi@example.org' },
      { kind: ChatbotAudienceKind.PHONE, value: '+919876543210' },
      { kind: ChatbotAudienceKind.USER, value: '42' },
    ];
    const query = jest.fn(async () => [
      { value: 'asha@example.org' },
      { value: '+919876543210' },
    ]);
    const withIdentities = new ChatbotAudienceService({
      find: async () => listed,
      manager: { query },
    } as never);
    const out = await withIdentities.list('bot-1');
    expect(
      out.map((e) => (e as { everMatched?: boolean }).everMatched),
    ).toEqual([true, false, true, undefined]);
    expect(query.mock.calls[0]).toEqual([
      expect.any(String),
      ['bot-1', 'email', ['email', 'whatsapp']],
    ]);
  });
});
