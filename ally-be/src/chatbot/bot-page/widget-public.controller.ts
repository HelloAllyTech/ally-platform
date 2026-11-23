import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../auth/decorators/auth.metadata';
import { BotPagePublicService } from './bot-page-public.service';

/**
 * The website widget's loader (chunk 13) reads its settings from here, on whatever site it is
 * embedded in. So this sits outside the bot page's Origin guard and the app's CORS list
 * (`common/cors/app-cors.ts` leaves exactly these two routes out): it answers CORS itself, to any
 * origin, without credentials (stage 7: the widget may load anywhere; chatting needs sign-in).
 * `:slug` is the page's address or its legacy slug, so embeds made before stage 7 keep working.
 */
@ApiTags('Bot page (public)')
@Controller('v1/public/widget')
export class WidgetPublicController {
  constructor(private readonly service: BotPagePublicService) {}

  @Public()
  @Get(':slug')
  @ApiOperation({
    summary: "The chat bubble's settings, for any website it is embedded in",
    description:
      'Answers any http(s) `Origin`, with CORS for that origin and no credentials, and notes the site for the owner\'s "Sites it has loaded on" list. No or a non-web Origin: 403 `host_not_allowed`.',
  })
  async config(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const origin = req.headers.origin;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    const config = await this.service.widgetConfig(slug, origin, req);
    res.setHeader('Access-Control-Allow-Origin', origin!);
    return config;
  }

  @Public()
  @Get(':slug/frame-policy')
  @ApiOperation({
    summary:
      'The `frame-ancestors` for the embedded bot page (for CloudFront and Caddy)',
  })
  framePolicy(@Param('slug') slug: string) {
    return this.service.framePolicy(slug);
  }
}
