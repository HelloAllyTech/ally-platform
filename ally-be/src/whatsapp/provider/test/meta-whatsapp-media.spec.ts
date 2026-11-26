import axios from 'axios';
import { recordedWebhook } from '../../test/fixtures/recorded';
import { MetaWhatsAppProvider } from '../meta-whatsapp.provider';
import {
  WHATSAPP_MEDIA_LIMITS,
  whatsappMediaProblem,
  type WhatsAppMedia,
} from '../../type/whatsapp-provider.interface';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** WA-A §1–2: voice notes, images and documents in; images and documents out. */
describe('MetaWhatsAppProvider media (WA-A)', () => {
  const provider = new MetaWhatsAppProvider({
    whatsapp: {
      phoneNumberId: '123',
      accessToken: 'token',
      graphApiVersion: 'v25.0',
      businessAccountId: 'waba-1',
    },
  } as never);

  beforeEach(() => jest.resetAllMocks());

  describe('parseInbound (recorded webhooks)', () => {
    it('reads a Hindi voice note as media to transcribe, not as unsupported', () => {
      const [message] = provider.parseInbound(recordedWebhook('voice-note-hi'));
      expect(message).toMatchObject({
        from: '919876543210',
        text: '',
        isUnsupportedMedia: false,
        media: {
          kind: 'audio',
          id: '1003383421387256',
          mimeType: 'audio/ogg; codecs=opus',
          voice: true,
        },
      });
    });

    it('reads an English voice note the same way', () => {
      const [message] = provider.parseInbound(recordedWebhook('voice-note-en'));
      expect(message.media).toMatchObject({ kind: 'audio', voice: true });
    });

    it('reads an image, with its caption as the words', () => {
      const [message] = provider.parseInbound(recordedWebhook('image'));
      expect(message.text).toBe('my prescription');
      expect(message.media).toMatchObject({
        kind: 'image',
        mimeType: 'image/jpeg',
        caption: 'my prescription',
      });
      expect(message.isUnsupportedMedia).toBe(false);
    });

    it('reads a PDF with its file name', () => {
      const [message] = provider.parseInbound(recordedWebhook('document-pdf'));
      expect(message.media).toMatchObject({
        kind: 'document',
        mimeType: 'application/pdf',
        filename: 'blood-report.pdf',
      });
    });

    it('a video is still unsupported', () => {
      const body = recordedWebhook('image');
      const message = body.entry[0].changes[0].value.messages[0];
      message.type = 'video';
      message.video = { id: 'v1', mime_type: 'video/mp4' };
      delete message.image;
      const [parsed] = provider.parseInbound(body);
      expect(parsed.isUnsupportedMedia).toBe(true);
      expect(parsed.media).toBeUndefined();
    });
  });

  describe('downloadMedia', () => {
    it("looks the media up, then fetches its URL with the number's token", async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            url: 'https://lookaside.fbsbx.com/x',
            mime_type: 'audio/ogg',
            file_size: 4,
          },
        })
        .mockResolvedValueOnce({ data: Buffer.from('OggS') });
      const file = await provider.downloadMedia('1003383421387256');
      expect(mockedAxios.get.mock.calls[0][0]).toBe(
        'https://graph.facebook.com/v25.0/1003383421387256',
      );
      expect(mockedAxios.get.mock.calls[1][0]).toBe(
        'https://lookaside.fbsbx.com/x',
      );
      expect(mockedAxios.get.mock.calls[1][1]).toMatchObject({
        headers: { Authorization: 'Bearer token' },
        responseType: 'arraybuffer',
      });
      expect(file).toEqual({
        data: Buffer.from('OggS'),
        mimeType: 'audio/ogg',
        sizeBytes: 4,
      });
    });

    it('refuses a file over the cap before downloading it', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          url: 'https://x',
          mime_type: 'application/pdf',
          file_size: 30 * 1024 * 1024,
        },
      });
      await expect(provider.downloadMedia('m1')).rejects.toThrow(/over/);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("sendMedia, checked against Meta's limits", () => {
    const pdf: WhatsAppMedia = {
      kind: 'document',
      link: 'https://s3.example/form.pdf?sig=1',
      mimeType: 'application/pdf',
      sizeBytes: 120_000,
      filename: 'Registration form.pdf',
      caption: 'The form',
    };

    it('sends a document by link with its file name and caption', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { messages: [{ id: 'wamid.out' }] },
      });
      await expect(provider.sendMedia('919876543210', pdf)).resolves.toEqual({
        providerMessageId: 'wamid.out',
      });
      expect(mockedAxios.post.mock.calls[0][1]).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '919876543210',
        type: 'document',
        document: {
          link: pdf.link,
          caption: 'The form',
          filename: 'Registration form.pdf',
        },
      });
    });

    it('sends an image without a file name', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { messages: [{ id: 'wamid.img' }] },
      });
      await provider.sendMedia('919876543210', {
        kind: 'image',
        link: 'https://s3.example/a.png',
        mimeType: 'image/png',
        sizeBytes: 1000,
        filename: 'ignored.png',
      });
      expect(mockedAxios.post.mock.calls[0][1]).toMatchObject({
        type: 'image',
        image: { link: 'https://s3.example/a.png' },
      });
      expect(
        (mockedAxios.post.mock.calls[0][1] as any).image.filename,
      ).toBeUndefined();
    });

    it.each<[string, Partial<WhatsAppMedia>, RegExp]>([
      [
        'an image over 5 MB',
        {
          kind: 'image',
          mimeType: 'image/png',
          sizeBytes: WHATSAPP_MEDIA_LIMITS.image.maxBytes + 1,
        },
        /size/,
      ],
      ['a GIF image', { kind: 'image', mimeType: 'image/gif' }, /type/],
      ['a zip document', { mimeType: 'application/zip' }, /type/],
      // Ally's cap, one constant (Meta allows 100 MB; files are held in memory).
      [
        'a document over 25 MB',
        { sizeBytes: WHATSAPP_MEDIA_LIMITS.document.maxBytes + 1 },
        /size/,
      ],
      [
        'a caption over 1024 characters',
        { caption: 'x'.repeat(1025) },
        /caption/,
      ],
      ['a plain http link', { link: 'http://s3.example/form.pdf' }, /https/],
    ])('never sends %s', async (_name, change, reason) => {
      const media = { ...pdf, ...change } as WhatsAppMedia;
      expect(whatsappMediaProblem(media)).toMatch(reason);
      await expect(provider.sendMedia('919876543210', media)).rejects.toThrow(
        /outside WhatsApp limits/,
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });
});
