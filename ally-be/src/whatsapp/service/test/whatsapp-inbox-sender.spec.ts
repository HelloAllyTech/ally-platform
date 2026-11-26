import { WaHandledBy } from '../../enum/whatsapp.enum';
import { WhatsAppInboxSender } from '../whatsapp-inbox-sender.service';

/** WA-A §3: team replies from the Inbox can carry a file or BT1's reply buttons. */
describe('WhatsAppInboxSender (WA-A)', () => {
  const build = () => {
    const messages = {
      create: (row: Record<string, unknown>) => row,
      save: jest.fn(async (row: Record<string, unknown>) => ({
        ...row,
        id: 'out-1',
      })),
      update: jest.fn().mockResolvedValue(undefined),
      manager: { query: jest.fn().mockResolvedValue([]) },
    };
    const provider = {
      sendText: jest
        .fn()
        .mockResolvedValue({ providerMessageId: 'wamid.text' }),
      sendInteractive: jest
        .fn()
        .mockResolvedValue({ providerMessageId: 'wamid.btn' }),
      sendMedia: jest
        .fn()
        .mockResolvedValue({ providerMessageId: 'wamid.file' }),
    };
    const s3 = {
      generatePresignedUrl: jest
        .fn()
        .mockResolvedValue('https://s3.example/signed'),
    };
    const sender = new WhatsAppInboxSender(
      {
        findOne: async () => ({ id: 'conv-1', contactId: 'c-1' }),
        update: jest.fn(),
      } as never,
      {
        findOne: async () => ({
          id: 'c-1',
          phoneE164: '919876543210',
          businessNumberId: 'n-1',
        }),
      } as never,
      messages as never,
      provider as never,
      {
        credentialsFor: async () => ({ phoneNumberId: 'p', accessToken: 't' }),
      } as never,
      { sync: jest.fn().mockResolvedValue(true) } as never,
      s3 as never,
      { s3: { audioBucket: 'audio' } } as never,
    );
    return { sender, provider, messages, s3 };
  };
  const base = {
    conversationId: 'conv-1',
    text: '*Asha*\nHere is the form',
    handledBy: WaHandledBy.HUMAN,
    sentByUserId: 7,
  };

  it('sends an attached PDF by signed link, with the text as its caption, and puts it on the message', async () => {
    const { sender, provider, messages, s3 } = build();
    const result = await sender.send({
      ...base,
      media: {
        kind: 'document',
        key: 'wa-media/bot-1/conv-1/team-1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        filename: 'form.pdf',
      },
    });
    expect(result).toEqual({ messageId: 'out-1', sent: true });
    expect(s3.generatePresignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'wa-media/bot-1/conv-1/team-1.pdf',
        expiresIn: 600,
      }),
    );
    expect(provider.sendMedia).toHaveBeenCalledWith(
      '919876543210',
      expect.objectContaining({
        kind: 'document',
        link: 'https://s3.example/signed',
        caption: base.text,
        filename: 'form.pdf',
      }),
      expect.anything(),
    );
    expect(provider.sendText).not.toHaveBeenCalled();
    expect(messages.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('SET attachments'),
      ['out-1', expect.stringContaining('team-1.pdf')],
    );
  });

  it("sends reply buttons with BT1's interactive send, ids marked as the team's", async () => {
    const { sender, provider } = build();
    await sender.send({ ...base, buttons: ['Yes', 'No'] });
    expect(provider.sendInteractive).toHaveBeenCalledWith(
      '919876543210',
      {
        type: 'button',
        body: base.text,
        buttons: [
          { id: 'team-reply:0', title: 'Yes' },
          { id: 'team-reply:1', title: 'No' },
        ],
      },
      expect.anything(),
    );
  });

  it('falls back to the text with the choices listed when the buttons cannot go', async () => {
    const { sender, provider } = build();
    provider.sendInteractive.mockRejectedValueOnce(new Error('131000'));
    await sender.send({ ...base, buttons: ['Yes', 'No'] });
    expect(provider.sendText).toHaveBeenCalledWith(
      '919876543210',
      `${base.text}\n\n• Yes\n• No`,
      expect.anything(),
    );
  });

  it('a file Meta refuses fails the send, so the team sees it', async () => {
    const { sender, provider, messages } = build();
    provider.sendMedia.mockRejectedValueOnce(
      new Error('The file is outside WhatsApp limits'),
    );
    const result = await sender.send({
      ...base,
      media: {
        kind: 'image',
        key: 'wa-media/x.gif',
        mimeType: 'image/gif',
        sizeBytes: 1,
      },
    });
    expect(result.sent).toBe(false);
    expect(messages.update).toHaveBeenCalledWith(
      { id: 'out-1' },
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
