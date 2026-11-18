import { BadRequestException } from '@nestjs/common';
import { ImageAssetService } from '../service/image-asset.service';

const config = {
  s3: { learnMediaPublicBucket: 'learn-media', assetsBucket: 'assets' },
  aws: { region: 'region-1' },
} as any;

const build = (counts: number[] = [0]) => {
  const dataSource = {
    query: jest.fn().mockResolvedValue(counts.map((n) => ({ n }))),
  } as any;
  const s3 = {
    getS3Url: (b: string, r: string, k: string) =>
      `https://${b}.s3.${r}.amazonaws.com/${k}`,
  } as any;
  return { service: new ImageAssetService(config, s3, dataSource), dataSource };
};

describe('ImageAssetService', () => {
  it('locates an image in one of our buckets', () => {
    const { service } = build();
    expect(
      service.locate(
        'https://learn-media.s3.region-1.amazonaws.com/track-media/image/a%20b.png',
      ),
    ).toEqual({
      bucket: 'learn-media',
      key: 'track-media/image/a b.png',
    });
  });

  it.each([
    'https://evil.example.com/x.png',
    'https://someone-else.s3.region-1.amazonaws.com/x.png',
    'http://169.254.169.254/latest/meta-data',
  ])('refuses a reference outside our buckets: %s', (url) => {
    const { service } = build();
    expect(() => service.locate(url)).toThrow(BadRequestException);
  });

  it('treats every generated image as shared, without asking the database', async () => {
    const { service, dataSource } = build();
    await expect(
      service.isShared(
        'https://learn-media.s3.region-1.amazonaws.com/image-studio/abc.webp',
      ),
    ).resolves.toBe(true);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('keeps a file more than one record shows, and frees one only this record shows', async () => {
    const url =
      'https://learn-media.s3.region-1.amazonaws.com/scenario-cover-images/c.png';
    await expect(build([1, 1, 0]).service.isShared(url)).resolves.toBe(true);
    await expect(build([1, 0, 0]).service.isShared(url)).resolves.toBe(false);
  });

  it('keeps the file when it cannot tell', async () => {
    const { service, dataSource } = build();
    dataSource.query.mockRejectedValue(new Error('db down'));
    await expect(
      service.isShared(
        'https://learn-media.s3.region-1.amazonaws.com/scenario-cover-images/c.png',
      ),
    ).resolves.toBe(true);
  });
});
