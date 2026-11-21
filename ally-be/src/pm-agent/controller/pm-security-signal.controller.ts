import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import {
  IngestSecuritySignalsDto,
  IngestSecuritySignalsResult,
} from '../dto/pm-security-signal.dto';
import { PmSecuritySignalService } from '../service/pm-security-signal.service';

/**
 * Machine-only: the weekly security audit workflow posts its findings here (`x-api-key`, the
 * same platform key Bug Hunter's pipeline uses). Own controller so it never shares a route
 * table with the admin (JWT) PM Agent routes.
 */
@ApiTags('PM Agent')
@Controller('v1/internal/pm-agent/signals')
@UseGuards(ApiAuthGuard)
@ApiSecurity('api-key')
export class PmSecuritySignalController {
  constructor(private readonly service: PmSecuritySignalService) {}

  @Post('security-audit')
  @HttpCode(200)
  @ApiOperation({ summary: 'File security audit findings as PM Agent signals' })
  ingest(
    @Body() dto: IngestSecuritySignalsDto,
  ): Promise<IngestSecuritySignalsResult> {
    return this.service.ingest(dto.findings, dto.runUrl);
  }
}
