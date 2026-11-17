import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { RoadmapDictationService } from '../roadmap-dictation.service';

const audio = (size = 1000) =>
  ({ buffer: Buffer.alloc(size, 1), size, mimetype: 'audio/webm' }) as any;

function build(opts: { role?: string; draft?: any; spent?: number } = {}) {
  const deps = {
    dataSource: { query: jest.fn(async () => [{ planStage: 'prd' }]) },
    transcription: {
      transcribe: jest.fn(async () => 'mixed Hindi and English words'),
      modelId: 'whisper-1',
    },
    drafts: {
      ownDraft: jest.fn(async () => {
        if (opts.draft === null) throw new NotFoundException();
        return opts.draft ?? { id: 'draft-session' };
      }),
    },
    reader: {
      detail: jest.fn(async () => ({
        sessionId: 'shared-session',
        can: { answer: true, comment: true },
      })),
    },
    roles: { roleOf: jest.fn(async () => opts.role ?? 'idea') },
    spend: {
      checkCeiling: jest.fn(async () => ({
        spentUsd: opts.spent ?? 0.2,
        ceilingUsd: 1,
      })),
      record: jest.fn(),
    },
    ceiling: { assertWithinCeiling: jest.fn() },
    llmUsage: { record: jest.fn() },
  };
  const service = new RoadmapDictationService(
    ...(Object.values(deps) as unknown as ConstructorParameters<
      typeof RoadmapDictationService
    >),
  );
  return { service, deps };
}

describe('RoadmapDictationService', () => {
  it('turns a draft clip into text and charges the draft at the idea stage', async () => {
    const { service, deps } = build();
    const result = await service.dictate(7, {
      audio: audio(),
      durationMs: 30_000,
      code: 'OPP-0900',
    });
    expect(result).toEqual({
      text: 'mixed Hindi and English words',
      durationMs: 30_000,
    });
    expect(deps.llmUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'stt',
        task: LlmTask.ROADMAP_DICTATION,
        audioMs: 30_000,
      }),
    );
    const [entry] = deps.spend.record.mock.calls[0] as any[];
    expect(entry).toMatchObject({
      sessionId: 'draft-session',
      stage: 'idea',
      taskId: 'roadmap-dictation',
    });
    // whisper-1 is $0.006/min: half a minute is $0.003.
    expect(entry.knownCostUsd).toBeCloseTo(0.003, 6);
  });

  it('stops at 2 minutes', async () => {
    const { service, deps } = build();
    const error = await service
      .dictate(7, { audio: audio(), durationMs: 125_000, code: 'OPP-0900' })
      .catch((e) => e);
    expect(error.getStatus()).toBe(413);
    expect(error.getResponse()).toMatchObject({ code: 'clip_too_long' });
    expect(deps.transcription.transcribe).not.toHaveBeenCalled();
  });

  it("refuses at the draft's $1 idea cap; typing still works", async () => {
    const { service, deps } = build({ spent: 1.0 });
    const error = await service
      .dictate(7, { audio: audio(), durationMs: 5_000, code: 'OPP-0900' })
      .catch((e) => e);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code: 'idea_cap_reached' });
    expect(deps.transcription.transcribe).not.toHaveBeenCalled();
  });

  it("on a shared idea, checks the caller can write there and the idea's ceiling", async () => {
    const { service, deps } = build({ draft: null });
    await service.dictate(7, {
      audio: audio(),
      durationMs: 5_000,
      code: 'OPP-0100',
    });
    expect(deps.ceiling.assertWithinCeiling).toHaveBeenCalledWith(
      'shared-session',
      'dictation',
    );
    deps.reader.detail.mockResolvedValueOnce({
      sessionId: 's',
      can: { answer: false, comment: false },
    });
    await expect(
      service.dictate(7, {
        audio: audio(),
        durationMs: 5_000,
        code: 'OPP-0100',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('says so plainly when transcription fails', async () => {
    const { service, deps } = build();
    deps.transcription.transcribe.mockRejectedValueOnce(new Error('boom'));
    const error = await service
      .dictate(7, { audio: audio(), durationMs: 5_000, code: 'OPP-0900' })
      .catch((e) => e);
    expect(error.getStatus()).toBe(502);
    expect(error.getResponse()).toMatchObject({ code: 'transcription_failed' });
    expect(deps.spend.record).not.toHaveBeenCalled();
  });
});
