import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  IMAGE_STUDIO_ORIGINALS_PREFIX,
  IMAGE_STUDIO_S3_PREFIX,
} from '../constants/image-studio.constants';

export interface S3Location {
  bucket: string;
  key: string;
}

const S3_URL = /^https:\/\/([^./]+)\.s3\.[^./]+\.amazonaws\.com\/(.+)$/;

/**
 * Tables whose rows can hold an image URL — anywhere in the row, including
 * jsonb content such as a quiz question's media or an article's HTML. Same
 * row-text search as TrackService.assertCallerMayDeleteMedia.
 */
const URL_HOLDING_TABLES = [
  'tracks',
  'track_sections',
  'track_items',
  'track_translations',
  'track_component_templates',
  'scenarios',
  'scenario_characters',
  'scenario_cover_image_library',
  'scenario_paths',
  'cases',
  'badges',
];

/**
 * Where generated images live and whether a stored image may be deleted.
 *
 * Generated images are shared: the same picture can be a roleplay cover, a
 * character's portrait and the reference for ten scenes. The editors' delete
 * paths used to remove "the old cover" whenever a cover changed, which also
 * removed it from everything else that showed it.
 */
@Injectable()
export class ImageAssetService {
  private readonly logger = LoggerService.getInstance(ImageAssetService.name);

  constructor(
    private readonly configService: AppConfigService,
    private readonly s3Service: S3Service,
    private readonly dataSource: DataSource,
  ) {}

  get bucket(): string {
    const bucket = this.configService.s3.learnMediaPublicBucket;
    if (!bucket) {
      throw new Error(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    }
    return bucket;
  }

  url(key: string): string {
    return this.s3Service.getS3Url(
      this.bucket,
      this.configService.aws.region ?? '',
      key,
    );
  }

  originalKey(imageId: string): string {
    return `${IMAGE_STUDIO_ORIGINALS_PREFIX}/${imageId}.png`;
  }

  displayKey(imageId: string): string {
    return `${IMAGE_STUDIO_S3_PREFIX}/${imageId}.webp`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3Service.uploadStream({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    });
  }

  async read(location: S3Location): Promise<Buffer> {
    return this.s3Service.getObjectBuffer(location);
  }

  async remove(key: string): Promise<void> {
    await this.s3Service.deleteObject({ bucket: this.bucket, key });
  }

  /**
   * The bucket and key of a URL in one of OUR buckets, or a 400. References
   * are fetched with S3 GetObject from this location — never over HTTP — so a
   * reference can only ever be an image already on the platform.
   */
  locate(url: string): S3Location {
    const match = url.match(S3_URL);
    const allowed = [
      this.configService.s3.learnMediaPublicBucket,
      this.configService.s3.assetsBucket,
    ].filter(Boolean);
    if (!match || !allowed.includes(match[1])) {
      throw new BadRequestException(
        'A reference image must be an image already on this platform.',
      );
    }
    return { bucket: match[1], key: decodeURIComponent(match[2]) };
  }

  isGeneratedAsset(url: string): boolean {
    const match = url.match(S3_URL);
    return !!match && match[2].startsWith(`${IMAGE_STUDIO_S3_PREFIX}/`);
  }

  /** How many rows, across every table that stores images, mention this URL. */
  async countUses(url: string): Promise<number> {
    const query = URL_HOLDING_TABLES.map(
      (table) =>
        `SELECT count(*)::int AS n FROM "${table}" t WHERE position($1 in row_to_json(t)::text) > 0`,
    ).join(' UNION ALL ');
    const rows: { n: number }[] = await this.dataSource.query(query, [url]);
    return rows.reduce((sum, row) => sum + Number(row.n || 0), 0);
  }

  /**
   * True when deleting this file would break something else: a generated
   * image (cleaned up by retention, never by an editor), or a file more than
   * one record shows. The record being edited still holds the URL while the
   * delete runs, so one use is "only this record".
   */
  async isShared(url: string): Promise<boolean> {
    if (this.isGeneratedAsset(url)) return true;
    try {
      return (await this.countUses(url)) > 1;
    } catch (error) {
      // When in doubt, keep the file: an orphan costs cents, a missing cover is a bug report.
      this.logger.warn(
        `[IMAGE_ASSET] could not count uses, keeping the file: ${(error as Error)?.message ?? error}`,
      );
      return true;
    }
  }
}
