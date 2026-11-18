import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/auth/decorators/auth.metadata';
import { RateLimit } from 'src/rate-limit/decorator/rate-limit.decorator';
import { TenantBrandingResponseDto } from '../dto/tenant-branding-response.dto';
import { TenantService } from '../service/tenant.service';

/**
 * Signed-out branding lookup for the login page (reached with `?org=<code>`
 * from an invite or magic-link email) and the public talker page.
 *
 * Returns only what those pages paint: name, logo, colour, favicon, welcome
 * line. The talker page already shows an org's name and logo to anyone with
 * its link, so nothing here is newly public. An org with branding off
 * resolves to Ally defaults with its name — the same as being signed in.
 */
@ApiTags('Tenant')
@Controller('v1/public/tenants')
export class TenantPublicController {
  constructor(private readonly tenantService: TenantService) {}

  @Public()
  @RateLimit({ key: 'ip', limit: 60, ttl: 60_000 })
  @Get(':code/branding')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Resolved branding for an organization code' })
  getBranding(@Param('code') code: string): Promise<TenantBrandingResponseDto> {
    return this.tenantService.getPublicBranding(code);
  }
}
