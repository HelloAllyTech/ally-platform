import {
  deleteWaMedia,
  waMediaKeysOf,
} from '../../../whatsapp/media/wa-attachment';
import { AssistantRetentionService } from '../assistant-retention.service';
import { CustomerErasureService } from '../customer-erasure.service';

/** WA-A: voice notes, images and documents are kept only as long as their conversation. */
describe('stored WhatsApp files go with their messages (WA-A)', () => {
  const voice = {
    kind: 'audio',
    key: 'wa-media/bot-1/conv-1/m1.ogg',
    mimeType: 'audio/ogg',
  };
  const pdf = {
    kind: 'document',
    key: 'wa-media/bot-1/conv-1/m2.pdf',
    mimeType: 'application/pdf',
  };

  it('finds only wa-media keys', () => {
    expect(
      waMediaKeysOf([
        { attachments: [voice, pdf] },
        { attachments: [{ kind: 'image', key: 'bot-images/x.png' }] },
        { attachments: null },
      ]),
    ).toEqual([voice.key, pdf.key]);
  });

  it('deletes each file, best effort', async () => {
    const s3 = {
      deleteObject: jest
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('denied')),
    };
    expect(await deleteWaMedia(s3, 'b', [voice.key, pdf.key])).toBe(1);
    expect(s3.deleteObject).toHaveBeenCalledWith({
      bucket: 'b',
      key: voice.key,
    });
  });

  it('the retention sweep deletes the files, then clears only those references', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'm1', attachments: [voice] }])
      .mockResolvedValue([]);
    const s3 = { deleteObject: jest.fn().mockResolvedValue({}) };
    const service = new AssistantRetentionService(
      { query } as never,
      undefined,
      s3 as never,
      { s3: { audioBucket: 'audio' } } as never,
    );
    expect(
      await (service as any).purgeMedia([
        [],
        [],
        new Date(),
        'x',
        new Date(),
        'p',
      ]),
    ).toBe(1);
    expect(query.mock.calls[0][0]).toContain('x.attachments IS NOT NULL');
    expect(s3.deleteObject).toHaveBeenCalledWith({
      bucket: 'audio',
      key: voice.key,
    });
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining('SET attachments = NULL'),
      [['m1']],
    ]);
  });

  it('erasing a person deletes their files before their messages are cleared', async () => {
    const s3 = { deleteObject: jest.fn().mockResolvedValue({}) };
    const service = new CustomerErasureService(
      {} as never,
      undefined,
      s3 as never,
      { s3: { audioBucket: 'audio' } } as never,
    );
    const m = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ attachments: [voice, pdf] }])
        .mockResolvedValue([[], 0]),
    };
    await (service as any).eraseConversations(m, ['conv-1'], {});
    expect(s3.deleteObject).toHaveBeenCalledTimes(2);
    expect(s3.deleteObject.mock.invocationCallOrder[1]).toBeLessThan(
      m.query.mock.invocationCallOrder[1],
    );
  });
});
