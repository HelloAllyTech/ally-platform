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
    {} as any,
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

describe('DebriefAudioService (plan §13: a deleted session takes its audio)', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';

  /** An in-memory bucket with the two calls the sweep makes. */
  function fakeStorage(keys: string[]) {
    const objects = new Set(keys);
    return {
      objects,
      listObjects: jest.fn(
        async (p: { bucket: string; prefix: string; delimiter?: string }) => {
          const under = [...objects].filter((k) => k.startsWith(p.prefix));
          if (!p.delimiter) return { keys: under, prefixes: [] };
          const prefixes = new Set(
            under
              .map((k) => k.slice(p.prefix.length).split(p.delimiter!)[0])
              .map((first) => `${p.prefix}${first}${p.delimiter}`),
          );
          return { keys: [], prefixes: [...prefixes] };
        },
      ),
      deleteObject: jest.fn(async (p: { bucket: string; key: string }) => {
        objects.delete(p.key);
        return {};
      }),
    };
  }

  function sweeper(storage: ReturnType<typeof fakeStorage>, alive: string[]) {
    const query = jest.fn(async (_sql: string, [ids]: [string[]]) =>
      ids.filter((id) => alive.includes(id)).map((id) => ({ id })),
    );
    const svc = new DebriefAudioService(
      {} as any,
      {} as any,
      storage as any,
      { s3: { audioBucket: 'audio' } } as any,
      {} as any,
      { query } as any,
    );
    return { svc, query };
  }

  it('deletes every audio file of a session that no longer exists, and only those', async () => {
    const storage = fakeStorage([
      `debrief-audio/${A}/aaa.mp3`,
      `debrief-audio/${A}/bbb.mp3`,
      `debrief-audio/${B}/ccc.mp3`,
      'debrief-audio/not-a-session/x.mp3',
      'other/thing.mp3',
    ]);
    const { svc } = sweeper(storage, [B]);

    expect(await svc.sweepDeletedSessions()).toBe(1);
    expect([...storage.objects].sort()).toEqual(
      [
        'debrief-audio/not-a-session/x.mp3',
        `debrief-audio/${B}/ccc.mp3`,
        'other/thing.mp3',
      ].sort(),
    );
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: 'audio',
      key: `debrief-audio/${A}/aaa.mp3`,
    });
  });

  it('does nothing when every session with audio still exists', async () => {
    const storage = fakeStorage([`debrief-audio/${A}/aaa.mp3`]);
    const { svc } = sweeper(storage, [A]);
    expect(await svc.sweepDeletedSessions()).toBe(0);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('deleteSessionAudio removes one session’s files', async () => {
    const storage = fakeStorage([
      `debrief-audio/${A}/aaa.mp3`,
      `debrief-audio/${B}/ccc.mp3`,
    ]);
    const { svc } = sweeper(storage, []);
    expect(await svc.deleteSessionAudio(A)).toBe(1);
    expect([...storage.objects]).toEqual([`debrief-audio/${B}/ccc.mp3`]);
  });
});
