import { NotFoundException } from '@nestjs/common';
import { DebriefAudioService } from '../service/debrief-audio.service';

const generatePreview = jest.fn(async () => Buffer.from('mp3'));
jest.mock('../../voice-preview/providers/sarvam-tts.provider', () => ({
  SarvamTTSProvider: jest.fn().mockImplementation(() => ({ generatePreview })),
}));

const RUN = {
  id: 'run-1',
  tenantId: 't1',
  language: 'ta-IN',
  cards: {
    opening: 'நீங்கள் அமைதியாக இருந்தீர்கள்.',
    what_worked: [],
    work_on_this: [],
    skill_words: [],
    reflective_question: 'Q?',
  },
};

function build(opts: { cached?: boolean; removed?: boolean }) {
  const s3 = {
    getHeadObject: jest.fn(async () => {
      if (!opts.cached) throw new Error('NotFound');
      return {};
    }),
    uploadStream: jest.fn(async () => ({})),
    generatePresignedUrl: jest.fn(
      async (p: { key: string }) => `https://signed/${p.key}`,
    ),
  };
  const usage = { record: jest.fn(async () => undefined) };
  const svc = new DebriefAudioService(
    {
      findOne: jest.fn(async () => (opts.removed ? { id: 'f' } : null)),
    } as any,
    { ownLiveRun: jest.fn(async () => RUN) } as any,
    s3 as any,
    {
      s3: { audioBucket: 'audio' },
      voicePreview: { sarvamApiKey: 'k' },
    } as any,
    usage as any,
  );
  return { svc, s3, usage };
}

describe('DebriefAudioService (read-aloud)', () => {
  beforeEach(() => generatePreview.mockClear());

  it('generates a card on the first tap, in the debrief language, and records the characters', async () => {
    const { svc, s3, usage } = build({});
    const res = await svc.audioUrl('s1', 7, 'opening');

    expect(generatePreview).toHaveBeenCalledWith(RUN.cards.opening, 'ta-IN');
    expect(s3.uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'audio', ContentType: 'audio/mpeg' }),
    );
    expect(res.cached).toBe(false);
    expect(res.url).toMatch(
      /^https:\/\/signed\/debrief-audio\/s1\/[0-9a-f]{24}\.mp3$/,
    );
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'tts',
        task: 'debrief_read_aloud',
        characters: RUN.cards.opening.length,
      }),
    );
  });

  it('makes no TTS call when the card was read before', async () => {
    const { svc, s3 } = build({ cached: true });
    const res = await svc.audioUrl('s1', 7, 'opening');
    expect(generatePreview).not.toHaveBeenCalled();
    expect(s3.uploadStream).not.toHaveBeenCalled();
    expect(res.cached).toBe(true);
  });

  it('never reads a card the Ally team removed, or one that does not exist', async () => {
    await expect(
      build({ removed: true }).svc.audioUrl('s1', 7, 'opening'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      build({}).svc.audioUrl('s1', 7, 'what_worked[2]'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(generatePreview).not.toHaveBeenCalled();
  });
});
