import {
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/auth.metadata';
import { DirectoryPublicService } from '../service/directory-public.service';

/** What a visitor's browser calls. No sign-in; unpublished and unverified answer 404. */
@ApiTags('Directory (public)')
@Controller('v1/public/directory')
export class DirectoryPublicController {
  constructor(private readonly service: DirectoryPublicService) {}

  @Public()
  @Get('domain-check')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      "For the TLS front door's on-demand certificates: 200 for a verified, published domain, else 404",
  })
  async domainCheck(@Query('domain') domain?: string): Promise<{ ok: true }> {
    if (!domain || !(await this.service.domainIsServed(domain))) {
      throw new NotFoundException();
    }
    return { ok: true };
  }

  @Public()
  @Get('domains/:host')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'The landing page served on a verified custom domain',
  })
  byDomain(@Param('host') host: string) {
    return this.service.byDomain(host);
  }

  @Public()
  @Get('collections/:slug')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: "A published collection's landing page" })
  bySlug(@Param('slug') slug: string) {
    return this.service.bySlug(slug);
  }
}
