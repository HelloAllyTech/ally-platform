import { Injectable } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { AppConfigService } from 'src/config/config.service';
import {
  ImageGenerationOptions,
  ImageGenerationProvider,
} from '../interface/image-generation-provider.interface';

@Injectable()
export class OpenAiImageProvider implements ImageGenerationProvider {
  private client?: OpenAI;

  constructor(private readonly configService: AppConfigService) {}

  getModel(): string {
    return this.configService.openai.imageModel;
  }

  assertConfigured(): void {
    if (!this.configService.openai.apiKey) {
      throw new Error(
        'OPENAI_API_KEY is not configured — cannot generate an image with OpenAI.',
      );
    }
  }

  /** gpt-image edits take up to 16 input images; dall-e models none. */
  maxReferences(): number {
    return this.getModel().startsWith('gpt-image') ? 16 : 0;
  }

  /** Lazily build the client so the app boots even without a key configured. */
  private getClient(): OpenAI {
    if (!this.client) {
      this.assertConfigured();
      this.client = new OpenAI({ apiKey: this.configService.openai.apiKey });
    }
    return this.client;
  }

  async generateImage(
    prompt: string,
    size: string,
    options?: ImageGenerationOptions,
  ): Promise<Buffer> {
    const model = options?.model ?? this.getModel();
    const isGptImage = model.startsWith('gpt-image');
    if (options?.references?.length && isGptImage) {
      return this.editWithReferences(prompt, size, model, options);
    }
    const response = await this.getClient().images.generate({
      model,
      prompt,
      n: 1,
      size: size as OpenAI.Images.ImageGenerateParams['size'],
      // low/medium/high are gpt-image tiers; dall-e models reject them.
      ...(options?.quality && isGptImage ? { quality: options.quality } : {}),
      // Counselor-training covers legitimately name suicide, self-harm and
      // abuse (a QPR course description was refused outright under the
      // default 'auto' filter); 'low' still blocks disallowed imagery.
      ...(isGptImage ? { moderation: 'low' as const } : {}),
    });

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error('OpenAI returned no image data');
    }
    return Buffer.from(base64, 'base64');
  }

  /**
   * Reference-conditioned generation goes through the edit endpoint, which
   * takes the references as input images; the prompt names each one by its
   * position. Without a mask the whole canvas is generated.
   */
  private async editWithReferences(
    prompt: string,
    size: string,
    model: string,
    options: ImageGenerationOptions,
  ): Promise<Buffer> {
    const extension = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    };
    const images = await Promise.all(
      (options.references ?? []).slice(0, 16).map((reference, index) =>
        toFile(
          reference.data,
          `reference-${index + 1}.${extension[reference.mimeType]}`,
          {
            type: reference.mimeType,
          },
        ),
      ),
    );
    const response = await this.getClient().images.edit({
      model,
      image: images,
      prompt,
      n: 1,
      size: size as OpenAI.Images.ImageEditParams['size'],
      ...(options.quality ? { quality: options.quality } : {}),
      // Faces must survive the edit; gpt-image-1.x takes the setting, later
      // models always run at high fidelity and reject it.
      ...(model.startsWith('gpt-image-1')
        ? { input_fidelity: 'high' as const }
        : {}),
    });
    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error('OpenAI returned no image data');
    }
    return Buffer.from(base64, 'base64');
  }
}
