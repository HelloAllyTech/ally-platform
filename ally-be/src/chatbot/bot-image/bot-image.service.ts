import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { S3Service } from '../../aws/service/s3.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import {
  GuardedFetchError,
  guardedFetchBuffer,
} from '../../common/net/guarded-fetch';
import { AppConfigService } from '../../config/config.service';
import { RedisService } from '../../redis/service/redis.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { BotPageService } from '../bot-page/bot-page.service';
import { brandImageIds } from '../type/bot-page.type';
import {
  BotImage,
  BotImageKind,
  BotImageStatus,
  BotImageVariants,
} from './bot-image.entity';
import {
  IMAGE_MAX_BYTES,
  ImageCheckError,
  ImageProblem,
  processImage,
} from './image-check';
import { fileStem, PUBLIC_FILE } from './urls';

/** Copy §19, word for word: what the owner sees when an upload is refused. */
export const IMAGE_ERRORS: Record<
  ImageProblem | 'too_many' | 'failed',
  string
> = {
  too_large:
    'That image is over 5 MB. Try a smaller one, or export it at a lower size.',
  wrong_type: 'We can only use PNG, JPG or WebP images (and SVG for logos).',
  too_many_pixels:
    'That image is over 5 MB. Try a smaller one, or export it at a lower size.',
  too_many:
    'This assistant has 50 images, the most it can hold. Remove one to add another.',
  failed: "That upload didn't finish. Try again.",
};

export const MAX_IMAGES_PER_BOT = 50;
/** Uploads per user per minute. */
export const UPLOADS_PER_MINUTE = 30;
/** Removed images keep their files this long, so Undo works. */
export const PURGE_AFTER_DAYS = 30;
/** Signed URLs for the dashboard. */
const SIGNED_URL_SECONDS = 15 * 60;
/** Content-hashed names never change content, so they cache for a year. */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** An image as the dashboard sees it. */
export interface BotImageView {
  id: string;
  kind: BotImageKind;
  alt: string;
  fileName: string;
  width: number;
  height: number;
  status: BotImageStatus;
  /** Short-lived signed URLs, by size. */
  urls: { 256: string; 768: string; 1600: string };
}

const refuse = (
  code: keyof typeof IMAGE_ERRORS,
  status = HttpStatus.BAD_REQUEST,
) =>
  new HttpException(
    { statusCode: status, code, message: IMAGE_ERRORS[code] },
    status,
  );

/**
 * Images on a bot's page (chunk 20d §4). Uploads come through here, not straight to S3, so every
 * byte is checked and re-encoded (`image-check.ts`). Files live in the private bucket; the
 * dashboard reads signed URLs and visitors read through `publicFile`, which serves an image only
 * while the bot's page is live and its brand uses that image.
 */
@Injectable()
export class BotImageService implements OnModuleInit {
  private readonly logger = new Logger(BotImageService.name);

  constructor(
    @InjectRepository(BotImage)
    private readonly images: Repository<BotImage>,
    private readonly pages: BotPageService,
    private readonly s3: S3Service,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('daily', 'bot-image-purge', () =>
      this.purge().then(() => undefined),
    );
  }

  private bucket(): string {
    const bucket = this.config.s3.botImagesBucket;
    if (!bucket) throw new BadRequestException(IMAGE_ERRORS.failed);
    return bucket;
  }

  /** Check, re-encode and store one upload. The same image twice returns the first. */
  async upload(
    chatbotId: string,
    file: { buffer: Buffer; originalname?: string; size?: number },
    kind: BotImageKind,
    alt = '',
    options: { rateLimit?: boolean; tenantId?: string | null } = {},
  ): Promise<BotImageView> {
    const userId = Number(ExecutionManager.getUserId() ?? 0) || null;
    if (options.rateLimit !== false && userId) {
      const minute = Math.floor(Date.now() / 60_000);
      try {
        const { count } = await this.redis.incrWithExpiry(
          `bi:uploads:${userId}:${minute}`,
          60,
        );
        if (count > UPLOADS_PER_MINUTE)
          throw refuse('failed', HttpStatus.TOO_MANY_REQUESTS);
      } catch (error) {
        if (error instanceof HttpException) throw error;
        // Redis down: let the upload through, as the page's other limits fail open.
      }
    }
    if ((file.size ?? file.buffer.length) > IMAGE_MAX_BYTES)
      throw refuse('too_large');

    const attached = await this.images.count({
      where: { chatbotId, status: BotImageStatus.ATTACHED },
    });
    if (attached >= MAX_IMAGES_PER_BOT) throw refuse('too_many');

    let processed;
    try {
      processed = await processImage(file.buffer, {
        allowSvg: kind === BotImageKind.LOGO,
      });
    } catch (error) {
      if (error instanceof ImageCheckError) throw refuse(error.problem);
      throw refuse('failed');
    }

    const same = await this.images.findOne({
      where: {
        chatbotId,
        contentHash: processed.hash,
        status: BotImageStatus.ATTACHED,
      },
    });
    if (same) return this.toView(same);

    const tenantId =
      options.tenantId !== undefined
        ? options.tenantId
        : (ExecutionManager.getTenantId() ?? null);
    const stem = processed.hash.slice(0, 32);
    const prefix = `bot-images/${tenantId ?? 'none'}/${chatbotId}/${stem}`;
    const variants: BotImageVariants = {
      256: `${prefix}-256.webp`,
      768: `${prefix}-768.webp`,
      1600: `${prefix}-1600.webp`,
      original: `${prefix}-original.${processed.original.ext}`,
    };
    const bucket = this.bucket();
    try {
      await Promise.all([
        ...processed.variants.map((variant) =>
          this.s3.uploadStream({
            Bucket: bucket,
            Key: variants[variant.width],
            Body: variant.bytes,
            ContentType: 'image/webp',
            CacheControl: PUBLIC_CACHE_CONTROL,
          }),
        ),
        this.s3.uploadStream({
          Bucket: bucket,
          Key: variants.original,
          Body: processed.original.bytes,
          ContentType: processed.original.contentType,
          CacheControl: PUBLIC_CACHE_CONTROL,
        }),
      ]);
    } catch (error) {
      this.logger.warn(
        `Bot image upload failed for chatbot ${chatbotId}: ${(error as Error).message}`,
      );
      throw refuse('failed');
    }

    const saved = await this.images.save(
      this.images.create({
        chatbotId,
        tenantId,
        kind,
        status: BotImageStatus.ATTACHED,
        contentHash: processed.hash,
        width: processed.width,
        height: processed.height,
        variants,
        contentType: processed.original.contentType,
        alt: alt.trim().slice(0, 300),
        originalName: (file.originalname ?? '').slice(0, 200),
        createdBy: userId,
        detachedAt: null,
      }),
    );
    return this.toView(saved);
  }

  /**
   * Store the logo onboarding found on the owner's website (chunk 20d §4): fetched through the
   * same guarded fetcher as the crawl and stored like an upload, so the page never hotlinks it.
   * Returns null when it can't be used; onboarding then shows initials.
   */
  async importFromUrl(
    chatbotId: string,
    url: string,
    options: {
      allowHosts?: string[];
      alt?: string;
      tenantId?: string | null;
    } = {},
  ): Promise<BotImageView | null> {
    try {
      const fetched = await guardedFetchBuffer(url, {
        timeoutMs: 10_000,
        maxBytes: IMAGE_MAX_BYTES,
        userAgent: 'AllyAssistantSetup',
        accept: 'image/png,image/jpeg,image/webp,image/svg+xml;q=0.9,*/*;q=0.1',
        contentTypes: ['image/'],
        allowHosts: options.allowHosts,
      });
      return await this.upload(
        chatbotId,
        {
          buffer: fetched.body,
          originalname: new URL(fetched.url).pathname.split('/').pop() ?? '',
        },
        BotImageKind.LOGO,
        options.alt ?? '',
        { rateLimit: false, tenantId: options.tenantId },
      );
    } catch (error) {
      if (
        !(error instanceof GuardedFetchError) &&
        !(error instanceof HttpException)
      ) {
        this.logger.warn(
          `Logo import failed for chatbot ${chatbotId}: ${(error as Error).message}`,
        );
      }
      return null;
    }
  }

  async list(chatbotId: string): Promise<BotImageView[]> {
    const rows = await this.images.find({
      where: { chatbotId, status: BotImageStatus.ATTACHED },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async get(chatbotId: string, id: string): Promise<BotImageView> {
    return this.toView(await this.find(chatbotId, id));
  }

  async setAlt(
    chatbotId: string,
    id: string,
    alt: string,
  ): Promise<BotImageView> {
    const image = await this.find(chatbotId, id);
    image.alt = alt.trim().slice(0, 300);
    return this.toView(await this.images.save(image));
  }

  /** Remove: unreadable at once (the public route only serves attached images), files kept 30 days. */
  async detach(chatbotId: string, id: string): Promise<void> {
    const image = await this.find(chatbotId, id);
    if (image.status !== BotImageStatus.ATTACHED) return;
    image.status = BotImageStatus.DETACHED;
    image.detachedAt = new Date();
    await this.images.save(image);
  }

  /** Undo a removal, while the files still exist. */
  async restore(chatbotId: string, id: string): Promise<BotImageView> {
    const image = await this.find(chatbotId, id);
    if (image.status === BotImageStatus.PURGED) throw new NotFoundException();
    if (image.status === BotImageStatus.DETACHED) {
      const attached = await this.images.count({
        where: { chatbotId, status: BotImageStatus.ATTACHED },
      });
      if (attached >= MAX_IMAGES_PER_BOT) throw refuse('too_many');
      image.status = BotImageStatus.ATTACHED;
      image.detachedAt = null;
      await this.images.save(image);
    }
    return this.toView(image);
  }

  /** Throws unless every id is an attached image of this bot (a brand may only use its own). */
  async assertAttached(chatbotId: string, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const found = await this.images.count({
      where: { chatbotId, id: In(unique), status: BotImageStatus.ATTACHED },
    });
    if (found !== unique.length) {
      throw new BadRequestException(
        'That image is no longer on this assistant.',
      );
    }
  }

  /**
   * One public file: only a 256/768/1600 WebP variant, of an attached image, that the live page's
   * brand uses. Anything else is a 404, whatever the reason.
   */
  async publicFile(
    slug: string,
    file: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const match = PUBLIC_FILE.exec(file);
    if (!match) throw new NotFoundException();
    const available = await this.pages.findAvailable(slug);
    if (!available) throw new NotFoundException();
    const used = brandImageIds(available.settings.brand);
    if (!used.length) throw new NotFoundException();
    const image = (
      await this.images.find({
        where: {
          chatbotId: available.chatbot.id,
          id: In(used),
          status: BotImageStatus.ATTACHED,
        },
      })
    ).find((row) => fileStem(row) === match[1]);
    if (!image) throw new NotFoundException();
    const size = Number(match[2]) as 256 | 768 | 1600;
    try {
      const body = await this.s3.getObjectBuffer({
        bucket: this.bucket(),
        key: image.variants[size],
      });
      return { body, contentType: 'image/webp' };
    } catch {
      throw new NotFoundException();
    }
  }

  /** Delete the files of images removed over 30 days ago. Daily. */
  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );
    const due = await this.images.find({
      where: { status: BotImageStatus.DETACHED, detachedAt: LessThan(cutoff) },
      take: 500,
    });
    let purged = 0;
    for (const image of due) {
      try {
        const bucket = this.bucket();
        await Promise.all(
          Object.values(image.variants).map((key) =>
            this.s3.deleteObject({ bucket, key }),
          ),
        );
        image.status = BotImageStatus.PURGED;
        await this.images.save(image);
        purged += 1;
      } catch (error) {
        this.logger.warn(
          `Bot image purge failed for ${image.id}: ${(error as Error).message}`,
        );
      }
    }
    if (purged) this.logger.log(`Purged ${purged} removed bot image(s)`);
    return purged;
  }

  private async find(chatbotId: string, id: string): Promise<BotImage> {
    const image = await this.images.findOne({ where: { id, chatbotId } });
    if (!image) throw new NotFoundException();
    return image;
  }

  private async toView(image: BotImage): Promise<BotImageView> {
    const bucket = this.config.s3.botImagesBucket;
    const sign = (key: string) =>
      bucket
        ? this.s3.generatePresignedUrl({
            bucket,
            key,
            operation: 'get',
            expiresIn: SIGNED_URL_SECONDS,
          })
        : Promise.resolve('');
    const [u256, u768, u1600] = await Promise.all([
      sign(image.variants[256]),
      sign(image.variants[768]),
      sign(image.variants[1600]),
    ]);
    return {
      id: image.id,
      kind: image.kind,
      alt: image.alt,
      fileName: image.originalName,
      width: image.width,
      height: image.height,
      status: image.status,
      urls: { 256: u256, 768: u768, 1600: u1600 },
    };
  }
}
