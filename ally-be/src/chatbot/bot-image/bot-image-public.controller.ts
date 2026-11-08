import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../auth/decorators/auth.metadata';
import { BotImageService, PUBLIC_CACHE_CONTROL } from './bot-image.service';

/**
 * A live bot page's images, for visitors (chunk 20d). Served only while the page is live and its
 * brand uses the image; otherwise 404. Content-hashed names, so a year's immutable cache is safe.
 */
@ApiTags('Bot page')
@Controller('v1/public/bot-images')
export class BotImagePublicController {
  constructor(private readonly images: BotImageService) {}

  @Public()
  @Get(':slug/:file')
  @ApiOperation({
    summary: "One of a live bot page's images (WebP, 256, 768 or 1600 px)",
  })
  async file(
    @Param('slug') slug: string,
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    const { body, contentType } = await this.images.publicFile(slug, file);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);
    // The page is served from another origin than the API; Helmet's default would block the image.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(body);
  }
}
