import {
  NARRATION_RETRY_DELAYS_MINUTES,
  ScenarioDescriptionAudioService,
  narrationHash,
} from '../scenario-description-audio.service';
import { ScenarioStatus } from '../../type/scenario.type';

const generatePreview = jest.fn();
jest.mock('../../../voice-preview/providers/sarvam-tts.provider', () => ({
  SarvamTTSProvider: jest.fn().mockImplementation(() => ({ generatePreview })),
}));

describe('ScenarioDescriptionAudioService', () => {
  let row: Record<string, any>;
  let repo: any;
  let s3: any;
  let service: ScenarioDescriptionAudioService;

  beforeEach(() => {
    generatePreview.mockReset().mockResolvedValue(Buffer.from('mp3'));
    row = {
      id: 7,
      status: ScenarioStatus.ACTIVE,
      description: 'A client arrives late.',
      descriptionAudioUrl: null,
      descriptionAudioHash: null,
      descriptionAudioAttempts: 0,
      descriptionAudioNextAttemptAt: null,
    };
    repo = {
      findOne: jest.fn(async () => ({ ...row })),
      update: jest.fn(async (_id: number, patch: Record<string, any>) => {
        Object.assign(row, patch);
      }),
      find: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    };
    s3 = { uploadStream: jest.fn().mockResolvedValue({}) };
    service = new ScenarioDescriptionAudioService(
      repo,
      s3,
      {
        s3: { assetsBucket: 'assets' },
        aws: { region: 'r' },
        voicePreview: { sarvamApiKey: 'k' },
      } as any,
      { record: jest.fn() } as any,
    );
  });

  it('enqueues and generates audio when an active scenario is saved', async () => {
    await service.onScenarioSaved(7);
    await new Promise((r) => setImmediate(r));
    expect(generatePreview).toHaveBeenCalledWith(
      'A client arrives late.',
      'en-IN',
    );
    expect(row.descriptionAudioUrl).toMatch(/scenario-description-audio\/7\//);
    expect(row.descriptionAudioNextAttemptAt).toBeNull();
  });

  it('makes no TTS call when the stored audio matches the description', async () => {
    row.descriptionAudioUrl = 'u';
    row.descriptionAudioHash = narrationHash(row.description);
    await service.onScenarioSaved(7);
    expect(generatePreview).not.toHaveBeenCalled();
  });

  it('hides stale audio and regenerates when the description changes', async () => {
    row.descriptionAudioUrl = 'old';
    row.descriptionAudioHash = narrationHash('old text');
    await service.onScenarioSaved(7);
    await new Promise((r) => setImmediate(r));
    expect(generatePreview).toHaveBeenCalledTimes(1);
    expect(row.descriptionAudioUrl).not.toBe('old');
  });

  it('does not throw when TTS fails, and schedules a retry', async () => {
    generatePreview.mockRejectedValue(new Error('boom'));
    await expect(service.generate(7)).resolves.toBe(false);
    expect(row.descriptionAudioAttempts).toBe(1);
    expect(row.descriptionAudioNextAttemptAt).toBeInstanceOf(Date);
  });

  it('stops retrying after the last delay', async () => {
    generatePreview.mockRejectedValue(new Error('boom'));
    row.descriptionAudioAttempts = NARRATION_RETRY_DELAYS_MINUTES.length;
    await service.generate(7);
    expect(row.descriptionAudioNextAttemptAt).toBeNull();
  });

  it('does not touch a draft scenario', async () => {
    row.status = ScenarioStatus.DRAFT;
    await service.onScenarioSaved(7);
    expect(generatePreview).not.toHaveBeenCalled();
  });
});
