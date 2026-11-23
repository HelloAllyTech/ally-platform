import { Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { LedgerService } from '../service/ledger.service';

/**
 * Ally staff operations on paused credit work. `manage_costs` only (server-checked), like the rest
 * of billing admin.
 */
@ApiTags('Credits (Ally admin)')
@ApiBearerAuth()
@ApiSecurity('access-token')
@RequireFeatureToggle(FeatureToggleKey.MANAGE_COSTS)
@Controller('v1/staff/billing/credits')
export class CreditsStaffController {
  constructor(private readonly ledger: LedgerService) {}

  @ApiOperation({
    summary:
      'Resume every document indexing and site reading paused by the credits gate whose reason no longer holds (idempotent)',
  })
  @Post('resume-paused')
  @HttpCode(200)
  resumePaused() {
    return this.ledger.resumeAllPaused();
  }
}
