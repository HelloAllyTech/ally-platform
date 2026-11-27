import { recordedWebhook } from '../../test/fixtures/recorded';
import { MetaWhatsAppProvider } from '../../provider/meta-whatsapp.provider';
import { WaHandledBy } from '../../enum/whatsapp.enum';
import { WaMediaService } from '../wa-media.service';
import { FILE_NOT_READ, VOICE_NOTE_FAILED } from '../../wa-a-copy';
import {
  agentBot,
  ANSWER,
  buildInboundHarness,
  INBOUND_ID,
} from './whatsapp-inbound-agent.fixtures';

const AGENT_ANSWER = {
  ...ANSWER,
  turn_type: 'question',
  run_id: 'run-1',
  runtime: 'v2',
  trace: [],
};

/** Parsed exactly as the webhook would, from the recorded payloads. */
const parser = new MetaWhatsAppProvider({ whatsapp: {} } as never);
const recorded = (name: string) =>
  parser.parseInbound(recordedWebhook(name))[0];

/**
 * WA-A §1–2 through the real inbound pipeline and engine: a voice note is transcribed and its
 * transcript answered like a typed message (the crisis check first, then the agent); a failed
 * transcription gets the fixed line and nothing is lost; a file with no words is kept and
 * declined politely. ally-ai and Meta are mocked.
 */
describe('WhatsAppInboundService: voice notes, images and documents (WA-A)', () => {
  const build = async (transcript: unknown) => {
    const ai = {
      transcribeVoiceNote:
        transcript instanceof Error
          ? jest.fn().mockRejectedValue(transcript)
          : jest.fn().mockResolvedValue(transcript),
    };
    const meta = {
      downloadMedia: jest.fn().mockResolvedValue({
        data: Buffer.from('OggS'),
        mimeType: 'audio/ogg',
        sizeBytes: 4,
      }),
    };
    const s3 = { uploadStream: jest.fn().mockResolvedValue({}) };
    const db = { query: jest.fn().mockResolvedValue([]) };
    const media = new WaMediaService(
      db as never,
      meta as never,
      ai as never,
      s3 as never,
      { s3: { audioBucket: 'audio-bucket' } } as never,
    );
    const harness = await buildInboundHarness({
      chatbot: agentBot,
      agentAnswer: AGENT_ANSWER,
      extraProviders: [{ provide: WaMediaService, useValue: media }],
    });
    return { ...harness, ai, meta, s3 };
  };
  const sent = (h: { provider: { sendText: jest.Mock } }) =>
    h.provider.sendText.mock.calls.map((c) => c[1] as string);
  const bodyUpdate = (h: { messageUpdates: jest.Mock }) =>
    h.messageUpdates.mock.calls.find(
      ([where, patch]) => where.id === INBOUND_ID && 'body' in patch,
    )?.[1];

  it('a Hindi voice note: kept, transcribed, and the transcript answered by the agent', async () => {
    const h = await build({
      status: 'ok',
      transcript: 'मुझे कल सुबह का अपॉइंटमेंट चाहिए',
      language: 'hi',
      duration_sec: 4,
    });
    await h.service.handle(recorded('voice-note-hi'));

    expect(h.meta.downloadMedia).toHaveBeenCalledWith(
      '1003383421387256',
      expect.anything(),
    );
    expect(h.s3.uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'audio-bucket',
        Key: `wa-media/bot-1/conv-1/${INBOUND_ID}.ogg`,
      }),
    );
    // Only the transcript goes on; the audio never reaches the model.
    expect(h.ai.transcribeVoiceNote).toHaveBeenCalledTimes(1);
    expect(bodyUpdate(h)).toEqual({ body: 'मुझे कल सुबह का अपॉइंटमेंट चाहिए' });
    expect(h.aiService.runAgent).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.aiService.runAgent.mock.calls[0][0])).toContain(
      'मुझे कल सुबह का अपॉइंटमेंट चाहिए',
    );
    expect(JSON.stringify(h.aiService.runAgent.mock.calls[0][0])).not.toContain(
      'OggS',
    );
    expect(sent(h)).toHaveLength(1);
    expect(sent(h)[0]).toContain(ANSWER.answer);
  });

  it('an English booking request by voice goes to the agent like a typed one', async () => {
    const h = await build({
      status: 'ok',
      transcript: 'I want to book an appointment tomorrow at 11',
      language: 'en',
    });
    await h.service.handle(recorded('voice-note-en'));
    expect(h.aiService.checkWhatsAppCrisis).toHaveBeenCalled();
    expect(JSON.stringify(h.aiService.runAgent.mock.calls[0][0])).toContain(
      'I want to book an appointment tomorrow at 11',
    );
  });

  it('a voice note saying an at-risk sentence gets the crisis reply, not an answer', async () => {
    const h = await build({
      status: 'ok',
      transcript: 'मैं अब और जीना नहीं चाहता, सब खत्म कर देना चाहता हूँ',
      language: 'hi',
    });
    h.aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: true,
      confidence: 0.95,
      signal: 'wants to end life',
    });
    await h.service.handle(recorded('voice-note-hi'));
    const reply = h.savedMessages.find((m) => m.direction === 'outbound');
    expect(reply?.handledBy).toBe(WaHandledBy.CRISIS);
    expect(sent(h)[0]).toMatch(/14416/);
    expect(sent(h)[0]).not.toBe(ANSWER.answer);
  });

  it.each([
    ['ally-ai fails', new Error('504')],
    ['nothing was heard', { status: 'failed', transcript: '' }],
    [
      'the note is over 2 minutes',
      { status: 'too_long', transcript: '', duration_sec: 140 },
    ],
  ])(
    'when %s: the fixed "please type it" line, the note kept, no agent run',
    async (_n, result) => {
      const h = await build(result);
      await h.service.handle(recorded('voice-note-en'));
      expect(sent(h)).toEqual([VOICE_NOTE_FAILED.en]);
      expect(
        h.savedMessages.find((m) => m.direction === 'outbound')?.handledBy,
      ).toBe(WaHandledBy.VOICE_FAILED);
      expect(h.s3.uploadStream).toHaveBeenCalledTimes(1);
      expect(h.aiService.runAgent).not.toHaveBeenCalled();
    },
  );

  it('in a Hinglish chat, a failed voice note gets the Hinglish line (earlier turns first)', async () => {
    const h = await build({ status: 'failed', transcript: '' });
    h.messageFind.mockResolvedValue([
      {
        direction: 'outbound',
        body: 'Namaste! Kaise madad karun?',
        createdAt: new Date(2),
      },
      {
        direction: 'inbound',
        body: 'mujhe kal ka appointment chahiye',
        createdAt: new Date(1),
      },
    ]);
    await h.service.handle(recorded('voice-note-en'));
    expect(sent(h)).toEqual([VOICE_NOTE_FAILED['hi-latn']]);
  });

  it('with no earlier turns, the WhatsApp locale decides; else English', async () => {
    const h = await build({ status: 'failed', transcript: '' });
    await h.service.handle(recorded('voice-note-en'));
    expect(sent(h)).toEqual([VOICE_NOTE_FAILED.en]);
  });

  it('a PDF with no words: kept for the team, and "can\'t read files yet"', async () => {
    const h = await build(null);
    h.meta.downloadMedia.mockResolvedValue({
      data: Buffer.from('%PDF'),
      mimeType: 'application/pdf',
      sizeBytes: 4,
    });
    const pdf = recorded('document-pdf');
    pdf.text = '';
    delete pdf.media!.caption;
    await h.service.handle(pdf);
    expect(h.s3.uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: `wa-media/bot-1/conv-1/${INBOUND_ID}.pdf`,
      }),
    );
    expect(sent(h)).toEqual([FILE_NOT_READ.en]);
    expect(h.ai.transcribeVoiceNote).not.toHaveBeenCalled();
    expect(h.aiService.runAgent).not.toHaveBeenCalled();
  });

  it('an image with a caption is answered from the caption; the image never goes to the model', async () => {
    const h = await build(null);
    h.meta.downloadMedia.mockResolvedValue({
      data: Buffer.from('JFIF'),
      mimeType: 'image/jpeg',
      sizeBytes: 4,
    });
    await h.service.handle(recorded('image'));
    const request = JSON.stringify(h.aiService.runAgent.mock.calls[0][0]);
    expect(request).toContain('my prescription');
    expect(request).not.toContain('JFIF');
  });
});

describe("WhatsAppInboundService: a tap on a team member's button (WA-A §3)", () => {
  it('is read as its title, like typed words, never as a BT1 tap or STOP', async () => {
    const h = await buildInboundHarness({
      chatbot: agentBot,
      agentAnswer: AGENT_ANSWER,
    });
    await h.service.handle({
      providerMessageId: 'wamid.tap',
      from: '919876543210',
      text: 'Stop',
      actionId: 'team-reply:1',
      isUnsupportedMedia: false,
      timestamp: new Date(),
    });
    expect(h.aiService.runAgent).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.aiService.runAgent.mock.calls[0][0])).toContain(
      'Stop',
    );
  });
});

describe('WhatsAppInboundService: a source document after the reply (WA-A §2)', () => {
  it('sends what the run chose, after the reply, as its own saved message', async () => {
    const media = {
      receive: jest.fn(),
      sourceFilesFor: jest.fn().mockResolvedValue([
        {
          id: 'd1',
          title: 'Registration form',
          bucket: 'b',
          key: 'kb/form.pdf',
          fileName: 'registration.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
        },
      ]),
      sendSourceFile: jest
        .fn()
        .mockResolvedValue({ providerMessageId: 'wamid.doc' }),
    };
    const h = await buildInboundHarness({
      chatbot: agentBot,
      agentAnswer: AGENT_ANSWER,
      extraProviders: [{ provide: WaMediaService, useValue: media }],
    });
    await h.service.handle({
      providerMessageId: 'wamid.ask',
      from: '919876543210',
      text: 'Can you send me the registration form?',
      isUnsupportedMedia: false,
      timestamp: new Date(),
    });
    expect(media.sourceFilesFor).toHaveBeenCalledWith('run-1', 'bot-1');
    expect(media.sendSourceFile).toHaveBeenCalledWith(
      '919876543210',
      expect.objectContaining({ title: 'Registration form' }),
      expect.anything(),
    );
    expect(media.sendSourceFile.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.provider.sendText.mock.invocationCallOrder[0],
    );
    expect(h.savedMessages[h.savedMessages.length - 1]).toMatchObject({
      body: 'Registration form',
      handledBy: 'source_file',
    });
  });
});
