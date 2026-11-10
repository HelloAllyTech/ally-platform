import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import OpenAI, { toFile } from 'openai';

import { audioUploadType } from 'src/common/util/audio.util';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';

/**
 * Speech-to-text for the idea-capture mic.
 *
 * It replaced the browser's own speech recognition (Chrome's Web Speech API), which in production
 * Chrome sat on "Listening…" and returned no words: it listens on the OS default input rather
 * than the mic the site was granted, and sends audio to a Google service we do not control. Here
 * the browser records from the mic it was actually given, sends each spoken phrase as a short
 * clip, and the same OpenAI transcription model as the scribe's voice notes turns it into text.
 *
 * The clip is held in memory for the request only; it is never written to disk, S3 or the
 * database, and the transcript is not logged.
 */
@Injectable()
export class RoadmapIdeaTranscriptionService {
  private readonly logger = LoggerService.getInstance(
    RoadmapIdeaTranscriptionService.name,
  );
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(configService: AppConfigService) {
    this.openai = new OpenAI({ apiKey: configService.openai.apiKey });
    this.model = configService.openai.transcriptionModel;
  }

  /** The words in one clip; '' when nothing intelligible was said. */
  async transcribe(audio: Express.Multer.File | undefined): Promise<string> {
    if (!audio?.buffer?.length) {
      throw new BadRequestException('No audio was provided.');
    }
    const startedAt = Date.now();
    try {
      const { type, ext } = audioUploadType(audio.mimetype);
      const file = await toFile(audio.buffer, `idea.${ext}`, { type });
      const result = await this.openai.audio.transcriptions.create({
        file,
        model: this.model,
      });
      const text = (result.text ?? '').trim();
      this.logger.info(
        `[IDEA_CAPTURE] transcribed model=${this.model} bytes=${audio.size} ` +
          `chars=${text.length} elapsedMs=${Date.now() - startedAt}`,
      );
      return text;
    } catch (error) {
      this.logger.error(
        `[IDEA_CAPTURE] transcription failed model=${this.model} ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as Error)?.message ?? error}`,
        error as Error,
      );
      throw new InternalServerErrorException('Failed to transcribe audio.');
    }
  }
}
