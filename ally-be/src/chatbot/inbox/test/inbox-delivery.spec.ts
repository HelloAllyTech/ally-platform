import { InboxService } from '../inbox.service';

/** WA-A §3 and §1–2: ticks, a failed send's reason, and voice notes and files with short links. */
describe('the Inbox thread: delivery and files (WA-A)', () => {
  const conversation = {
    id: 'conv-1',
    chatbot_id: 'bot-1',
    contact_id: null,
    assistant: 'Sukoon',
    channel: 'whatsapp',
    last_message_at: new Date('2026-11-26T08:00:00Z'),
  };
  const at = new Date('2026-11-26T08:00:00Z');
  const messages = [
    {
      id: 'm1',
      role: 'user',
      text: 'मुझे अपॉइंटमेंट चाहिए',
      at,
      sent_by_user_id: null,
      attachments: [
        {
          kind: 'audio',
          key: 'wa-media/t/bot-1/conv-1/wamid.1.ogg',
          mimeType: 'audio/ogg',
          voice: true,
          transcript: 'मुझे अपॉइंटमेंट चाहिए',
          durationSec: 4,
        },
      ],
      status: 'received',
      delivery: null,
      error_code: null,
    },
    {
      id: 'm2',
      role: 'assistant',
      text: 'Sure',
      at,
      sent_by_user_id: null,
      status: 'sent',
      delivery: 'read',
      error_code: null,
    },
    {
      id: 'm3',
      role: 'agent_human',
      text: 'Hello',
      at,
      sent_by_user_id: 7,
      sent_by_name: 'Asha',
      status: 'sent',
      delivery: 'failed',
      error_code: 131047,
    },
    {
      id: 'm4',
      role: 'assistant',
      text: 'Queued',
      at,
      sent_by_user_id: null,
      status: 'sent',
      delivery: null,
      error_code: null,
    },
  ];
  const build = () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([conversation])
      .mockResolvedValueOnce(messages);
    const s3 = {
      generatePresignedUrl: jest
        .fn()
        .mockResolvedValue('https://signed.example/v'),
    };
    const service = new InboxService(
      { query } as never,
      { assert: jest.fn().mockResolvedValue(undefined) } as never,
      s3 as never,
      { s3: { audioBucket: 'audio-bucket' } } as never,
    );
    return { service, query, s3 };
  };

  it('shows read, failed with its reason in plain words, and sent', async () => {
    const { service } = build();
    const thread = (await service.thread('bot-1', 'conv-1')) as any;
    const [, read, failed, sent] = thread.messages;
    expect(read).toMatchObject({ status: 'read', failedReason: null });
    expect(failed.status).toBe('failed');
    expect(failed.failedReason).toMatch(/24 hours/);
    expect(sent).toMatchObject({ status: 'sent', failedReason: null });
  });

  it('gives a voice note a short link and its transcript', async () => {
    const { service, s3 } = build();
    const thread = (await service.thread('bot-1', 'conv-1')) as any;
    expect(thread.messages[0].attachments).toEqual([
      expect.objectContaining({
        kind: 'audio',
        voice: true,
        transcript: 'मुझे अपॉइंटमेंट चाहिए',
        url: 'https://signed.example/v',
      }),
    ]);
    expect(s3.generatePresignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'audio-bucket',
        key: 'wa-media/t/bot-1/conv-1/wamid.1.ogg',
        operation: 'get',
        expiresIn: 600,
      }),
    );
    expect(thread.messages[1].attachments).toEqual([]);
  });
});

describe('a file the team attaches (WA-A §3)', () => {
  const build = () => {
    const s3 = { uploadStream: jest.fn().mockResolvedValue({}) };
    const service = new InboxService(
      { query: jest.fn() } as never,
      { assert: jest.fn().mockResolvedValue(undefined) } as never,
      s3 as never,
      { s3: { audioBucket: 'audio' } } as never,
    );
    return { service, s3 };
  };
  const file = (mimetype: string, size: number, originalname = 'form.pdf') => ({
    buffer: Buffer.from('x'),
    mimetype,
    size,
    originalname,
  });

  it('stores a PDF beside the chat and returns what the send needs', async () => {
    const { service, s3 } = build();
    const media = await service.storeTeamFile(
      'bot-1',
      'conv-1',
      file('application/pdf', 2048),
    );
    expect(media).toMatchObject({
      kind: 'document',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      filename: 'form.pdf',
    });
    expect(media.key).toMatch(/^wa-media\/bot-1\/conv-1\/team-.+\.pdf$/);
    expect(s3.uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'audio', Key: media.key }),
    );
  });

  it.each([
    ['a GIF', file('image/gif', 10, 'a.gif'), 'file_type'],
    ['a zip', file('application/zip', 10, 'a.zip'), 'file_type'],
    ['a 6 MB photo', file('image/jpeg', 6 * 1024 * 1024, 'a.jpg'), 'file_size'],
    ['a 30 MB PDF', file('application/pdf', 30 * 1024 * 1024), 'file_size'],
  ])('refuses %s before storing it', async (_n, f, code) => {
    const { service, s3 } = build();
    await expect(
      service.storeTeamFile('bot-1', 'conv-1', f),
    ).rejects.toMatchObject({
      response: { errorCode: code },
    });
    expect(s3.uploadStream).not.toHaveBeenCalled();
  });
});
