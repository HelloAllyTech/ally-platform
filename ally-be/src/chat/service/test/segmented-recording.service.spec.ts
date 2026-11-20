import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  MAX_SEGMENTS,
  SegmentedRecordingService,
  returnedRows,
} from '../segmented-recording.service';
import { ChatStatus, ChatSummaryStatus } from '../../entity/chat.entity';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { LoggerService } from '../../../logger/logger.service';
import { StreamEndReason } from '../../constants/chat.constants';

const TENANT = 'tenant-1';
const key = (chatId: number, i: number) =>
  SegmentedRecordingService.segmentKey(chatId, i, 'webm');

describe('returnedRows', () => {
  it('unwraps the postgres [rows, count] of UPDATE … RETURNING', () => {
    expect(returnedRows([[{ id: 7 }], 1])).toEqual([{ id: 7 }]);
    expect(returnedRows([[], 0])).toEqual([]);
    expect(returnedRows([{ id: 7 }])).toEqual([{ id: 7 }]);
  });
});

describe('SegmentedRecordingService', () => {
  let service: SegmentedRecordingService;
  let chatService: any;
  let s3: any;
  let ai: any;
  let uploads: any;
  let db: any;
  let chat: any;

  beforeEach(() => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any);
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(TENANT);
    jest
      .spyOn(ExecutionManager, 'setAuthContext')
      .mockImplementation(() => undefined);
    chat = {
      id: 7,
      tenantId: TENANT,
      counselorId: 1,
      status: ChatStatus.ACTIVE,
      metadata: {
        segmented: { format: 'webm', segmentSeconds: 30, startedAt: 'x' },
      },
    };
    chatService = {
      getChatsByCouncilorId: jest.fn().mockResolvedValue(null),
      createChatForAnonymousClient: jest.fn().mockResolvedValue({ id: 7 }),
      getChatByIdForServiceCall: jest.fn(async () => chat),
      updateCallMetadata: jest.fn(),
      updateChat: jest.fn(),
    };
    s3 = {
      generatePresignedUrl: jest.fn().mockResolvedValue('https://signed'),
      listObjects: jest.fn().mockResolvedValue({ keys: [], prefixes: [] }),
      getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('x')),
      uploadStream: jest.fn(),
      deleteObject: jest.fn(),
    };
    ai = { publishTranscribeAudioEvent: jest.fn() };
    uploads = { createAudioUpload: jest.fn() };
    db = { query: jest.fn().mockResolvedValue([]) };
    service = new SegmentedRecordingService(
      chatService,
      s3,
      { s3: { audioBucket: 'bucket' } } as any,
      ai,
      uploads,
      db,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('start', () => {
    it('creates an ACTIVE scribe chat and records the segment format', async () => {
      const r = await service.start(1, {
        platform: 'WEB' as any,
        format: 'webm',
      });
      expect(r).toEqual({
        chatId: 7,
        segmentSeconds: 30,
        maxSegments: MAX_SEGMENTS,
      });
      expect(chatService.createChatForAnonymousClient).toHaveBeenCalledWith(
        expect.objectContaining({
          counselorId: 1,
          status: ChatStatus.ACTIVE,
          mode: 'SCRIBE',
        }),
      );
      expect(db.query.mock.calls[0][1][1]).toContain('"format":"webm"');
    });

    it('refuses a second recording while one is in progress', async () => {
      chatService.getChatsByCouncilorId.mockResolvedValue({ id: 3 });
      await expect(
        service.start(1, { platform: 'WEB' as any, format: 'webm' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('segmentUploadUrl', () => {
    it('signs a PUT for the segment key with its content type', async () => {
      const r = await service.segmentUploadUrl(
        1,
        7,
        3,
        'audio/webm;codecs=opus',
      );
      expect(r.key).toBe('scribe-segments/7/00003.webm');
      expect(s3.generatePresignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          key: r.key,
          operation: 'put',
          contentType: 'audio/webm',
        }),
      );
    });

    it("refuses someone else's recording, a finished one, a bad index or type", async () => {
      await expect(
        service.segmentUploadUrl(2, 7, 0, 'audio/webm'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.segmentUploadUrl(1, 7, -1, 'audio/webm'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.segmentUploadUrl(1, 7, 0, 'audio/mpeg'),
      ).rejects.toBeInstanceOf(BadRequestException);
      chat.status = ChatStatus.ENDED;
      await expect(
        service.segmentUploadUrl(1, 7, 0, 'audio/webm'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('finalize', () => {
    beforeEach(() => {
      jest.spyOn(service, 'joinAndTranscribe').mockResolvedValue(undefined);
    });

    it('lists the missing segments instead of finishing', async () => {
      s3.listObjects.mockResolvedValue({
        keys: [key(7, 0), key(7, 2)],
        prefixes: [],
      });
      await expect(
        service.finalize(1, 7, { segmentCount: 4 }),
      ).resolves.toEqual({
        status: 'missing',
        missing: [1, 3],
      });
      expect(service.joinAndTranscribe).not.toHaveBeenCalled();
    });

    it('ends the chat once and starts the join when every segment is there', async () => {
      s3.listObjects.mockResolvedValue({
        keys: [key(7, 1), key(7, 0)],
        prefixes: [],
      });
      db.query.mockImplementation(async (sql: string) =>
        sql.includes('SET status') ? [{ id: 7 }] : [],
      );
      const r = await service.finalize(1, 7, {
        segmentCount: 2,
        durationSeconds: 61.4,
      });
      expect(r).toEqual({ status: 'finalized', missing: [] });
      expect(chatService.updateCallMetadata).toHaveBeenCalledWith(7, 61);
      const meta = db.query.mock.calls.find((c: any[]) =>
        String(c[1]?.[1]).includes('streamEndReason'),
      );
      expect(JSON.parse(meta[1][1])).toEqual({
        streamEndReason: StreamEndReason.COMPLETED,
      });
      expect(service.joinAndTranscribe).toHaveBeenCalledWith(7);
    });

    it('with allowPartial finishes with what arrived and flags it incomplete', async () => {
      s3.listObjects.mockResolvedValue({ keys: [key(7, 0)], prefixes: [] });
      db.query.mockImplementation(async (sql: string) =>
        sql.includes('SET status') ? [{ id: 7 }] : [],
      );
      const r = await service.finalize(1, 7, {
        segmentCount: 3,
        allowPartial: true,
      });
      expect(r.missing).toEqual([1, 2]);
      const meta = db.query.mock.calls.find((c: any[]) =>
        String(c[1]?.[1]).includes('streamEndReason'),
      );
      expect(JSON.parse(meta[1][1]).incompleteRecording).toBeTruthy();
    });

    it('is idempotent: a repeat, or a lost race, reports already-finalized', async () => {
      chat.status = ChatStatus.ENDED;
      await expect(
        service.finalize(1, 7, { segmentCount: 2 }),
      ).resolves.toEqual({
        status: 'already-finalized',
        missing: [],
      });
      chat.status = ChatStatus.ACTIVE;
      db.query.mockResolvedValue([]); // another colour ended it first
      await expect(
        service.finalize(1, 7, { segmentCount: 0 }),
      ).resolves.toMatchObject({
        status: 'already-finalized',
      });
      expect(service.joinAndTranscribe).not.toHaveBeenCalled();
    });
  });

  describe('joinAndTranscribe', () => {
    const claim = (attempts = 1) => [
      { metadata: { segmented: { format: 'webm', joinAttempts: attempts } } },
    ];

    it('does nothing when another caller holds the join', async () => {
      db.query.mockResolvedValue([]);
      await service.joinAndTranscribe(7);
      expect(s3.listObjects).not.toHaveBeenCalled();
    });

    it('marks a recording with no segments as NO_AUDIO', async () => {
      db.query.mockImplementation(async (sql: string) =>
        sql.includes('joining') ? claim() : [],
      );
      await service.joinAndTranscribe(7);
      expect(chatService.updateChat).toHaveBeenCalledWith(7, {
        summaryStatus: ChatSummaryStatus.NO_AUDIO,
      });
      expect(ai.publishTranscribeAudioEvent).not.toHaveBeenCalled();
    });

    it('joins in index order, sends one file to transcription, then deletes the segments', async () => {
      db.query.mockImplementation(async (sql: string) =>
        sql.includes('joining') ? claim() : [],
      );
      s3.listObjects.mockResolvedValue({
        keys: [key(7, 10), key(7, 2), 'scribe-segments/7/junk'],
        prefixes: [],
      });
      const join = jest
        .spyOn(SegmentedRecordingService, 'joinWithFfmpeg')
        .mockImplementation(async (inputs, out) => {
          expect(inputs.map((f) => path.basename(f))).toEqual([
            '00002.webm',
            '00010.webm',
          ]);
          fs.writeFileSync(out, 'mp3');
        });
      await service.joinAndTranscribe(7);
      expect(join).toHaveBeenCalled();
      expect(s3.uploadStream).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: 'audio-upload/segmented/7.mp3',
          ContentType: 'audio/mpeg',
        }),
      );
      expect(ai.publishTranscribeAudioEvent).toHaveBeenCalledWith(
        expect.objectContaining({ chat_id: 7, mode: 'SCRIBE' }),
      );
      expect(s3.deleteObject).toHaveBeenCalledTimes(2);
    });

    it('fails the summary only after the last attempt', async () => {
      s3.listObjects.mockResolvedValue({ keys: [key(7, 0)], prefixes: [] });
      jest
        .spyOn(SegmentedRecordingService, 'joinWithFfmpeg')
        .mockRejectedValue(new Error('bad audio'));
      db.query.mockImplementation(async (sql: string) =>
        sql.includes('joining') ? claim(1) : [],
      );
      await service.joinAndTranscribe(7);
      expect(chatService.updateChat).not.toHaveBeenCalled();
      db.query.mockImplementation(async (sql: string) =>
        sql.includes('joining') ? claim(3) : [],
      );
      await service.joinAndTranscribe(7);
      expect(chatService.updateChat).toHaveBeenCalledWith(7, {
        summaryStatus: ChatSummaryStatus.FAILED,
      });
    });
  });

  describe('janitor', () => {
    it('finishes an abandoned recording with the segments that arrived, flagged incomplete', async () => {
      db.query.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT id, tenant_id')) {
          return [
            {
              id: 7,
              tenant_id: TENANT,
              counselorId: 1,
              segmented: { segmentSeconds: 30 },
            },
          ];
        }
        if (sql.includes('SET status')) return [{ id: 7 }];
        return [];
      });
      s3.listObjects.mockResolvedValue({
        keys: [key(7, 0), key(7, 1)],
        prefixes: [],
      });
      const join = jest
        .spyOn(service, 'joinAndTranscribe')
        .mockResolvedValue(undefined);
      await service.janitor();
      expect(chatService.updateCallMetadata).toHaveBeenCalledWith(7, 60);
      const meta = db.query.mock.calls.find((c: any[]) =>
        String(c[1]?.[1]).includes('streamEndReason'),
      );
      expect(JSON.parse(meta[1][1]).incompleteRecording).toEqual({
        reason: StreamEndReason.JANITOR_ORPHAN,
      });
      expect(join).toHaveBeenCalledWith(7);
    });
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

(hasFfmpeg ? describe : describe.skip)('joinWithFfmpeg (real ffmpeg)', () => {
  it('joins standalone webm segments into one mp3 of their total length', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'segjoin-'));
    try {
      const inputs = [0, 1, 2].map((i) => {
        const f = path.join(dir, `${i}.webm`);
        execFileSync('ffmpeg', [
          '-y',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${300 + i * 100}:duration=2`,
          '-ac',
          '1',
          '-c:a',
          'libopus',
          f,
        ]);
        return f;
      });
      const out = path.join(dir, 'joined.mp3');
      await SegmentedRecordingService.joinWithFfmpeg(inputs, out);
      const seconds = Number(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'csv=p=0',
          out,
        ])
          .toString()
          .trim(),
      );
      expect(seconds).toBeGreaterThan(5.8);
      expect(seconds).toBeLessThan(6.3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
