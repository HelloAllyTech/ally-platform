import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { toFile } from 'openai';

import { AppConfigService } from 'src/config/config.service';

import { RoadmapIdeaTranscriptionService } from '../roadmap-idea-transcription.service';

const mockTranscriptionsCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: mockTranscriptionsCreate } },
  })),
  toFile: jest.fn().mockResolvedValue('file-handle'),
}));

const config = {
  openai: { apiKey: 'test-key', transcriptionModel: 'whisper-1' },
} as unknown as AppConfigService;

const clip = (mimetype: string, bytes = 'audio') =>
  ({
    buffer: Buffer.from(bytes),
    size: bytes.length,
    mimetype,
  }) as Express.Multer.File;

describe('RoadmapIdeaTranscriptionService', () => {
  let service: RoadmapIdeaTranscriptionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RoadmapIdeaTranscriptionService(config);
  });

  it('transcribes a clip with the configured model and trims the text', async () => {
    mockTranscriptionsCreate.mockResolvedValue({ text: '  an idea  ' });

    await expect(
      service.transcribe(clip('audio/webm;codecs=opus')),
    ).resolves.toBe('an idea');

    expect(toFile).toHaveBeenCalledWith(expect.any(Buffer), 'idea.webm', {
      type: 'audio/webm',
    });
    expect(mockTranscriptionsCreate).toHaveBeenCalledWith({
      file: 'file-handle',
      model: 'whisper-1',
    });
  });

  it("names Safari's mp4 recordings so the transcriber reads them", async () => {
    mockTranscriptionsCreate.mockResolvedValue({ text: 'x' });
    await service.transcribe(clip('audio/mp4'));
    expect(toFile).toHaveBeenCalledWith(expect.any(Buffer), 'idea.mp4', {
      type: 'audio/mp4',
    });
  });

  it('answers empty text for a clip with nothing intelligible in it', async () => {
    mockTranscriptionsCreate.mockResolvedValue({ text: '' });
    await expect(service.transcribe(clip('audio/webm'))).resolves.toBe('');
  });

  it('refuses a request with no audio', async () => {
    await expect(service.transcribe(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.transcribe(clip('audio/webm', '')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockTranscriptionsCreate).not.toHaveBeenCalled();
  });

  it('turns a provider failure into a 500 without echoing its detail', async () => {
    mockTranscriptionsCreate.mockRejectedValue(new Error('quota exceeded'));
    await expect(service.transcribe(clip('audio/webm'))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
