/**
 * Renders the style gallery's thumbnails: the SAME scene in every style, so
 * authors compare looks, not subjects. Uploads each to the learn-media bucket
 * at image-studio/styles/<styleId>.webp (the URL GET /v1/image-studio/styles
 * returns). Re-run after adding or retuning a style.
 *
 *   npx ts-node -r tsconfig-paths/register src/image-studio/scripts/thumbnails.ts [--only watercolour] [--dry-run ./out]
 *
 * Needs an image provider key (IMAGE_STUDIO_TEXT_PROVIDER, OpenAI by default)
 * and, without --dry-run, AWS credentials for the learn-media bucket.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as sharp from 'sharp';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from 'src/config/config.service';
import { GeminiImageProvider } from 'src/image-generation/provider/gemini-image.provider';
import { OpenAiImageProvider } from 'src/image-generation/provider/openai-image.provider';
import {
  getSlotProfile,
  ImageSlotKind,
} from 'src/image-studio/constants/image-slots.constants';
import {
  IMAGE_STYLES,
  styleThumbnailKey,
} from 'src/image-studio/constants/image-styles.constants';
import { compileImagePrompt } from 'src/image-studio/util/image-prompt.compiler';

dotenv.config();

const SUBJECT =
  'A counsellor and a young client sitting across from each other in a calm, ' +
  'plant-filled room, mid-conversation; the client looks down thoughtfully, the ' +
  'counsellor listens with a gentle expression.';

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
};

async function main() {
  const config = new AppConfigService(new ConfigService(process.env));
  const provider =
    config.imageStudio.textProvider === 'gemini'
      ? new GeminiImageProvider(config)
      : new OpenAiImageProvider(config);
  provider.assertConfigured();
  const dryRun = arg('dry-run');
  const only = arg('only');
  const bucket = config.s3.learnMediaPublicBucket;
  const s3 = new S3Client({ region: config.aws.region });
  const slot = getSlotProfile(ImageSlotKind.ARTICLE_INLINE);

  for (const style of IMAGE_STYLES.filter((s) => !only || s.id === only)) {
    const prompt = compileImagePrompt({ slot, style, description: SUBJECT });
    const raw = await provider.generateImage(prompt, slot.providerSize, {
      quality: 'medium',
    });
    const thumbnail = await sharp(raw)
      .resize(480, 320, { fit: 'cover', position: sharp.strategy.attention })
      .webp({ quality: 80 })
      .toBuffer();
    if (dryRun) {
      fs.mkdirSync(dryRun, { recursive: true });
      fs.writeFileSync(path.join(dryRun, `${style.id}.webp`), thumbnail);
    } else {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: styleThumbnailKey(style.id),
          Body: thumbnail,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=86400',
        }),
      );
    }
    console.log(`${style.id} done`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
