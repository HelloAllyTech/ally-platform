import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { StaffOnly } from 'src/auth/decorators/staff-only.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  CustomerOutreachBodyDto,
  CustomerOverview,
} from '../dto/customer-statistics.dto';
import { CustomerStatisticsService } from '../service/customer-statistics.service';

/**
 * The Customers tab on Statistics. Ally staff only: anyone else gets 404, as if
 * the route were not there. On top of that it needs the Analytics toggle, the
 * one that already opens Organisation health, so a platform admin given a narrow
 * login (Chatbots only, say) does not see every customer. An admin limited to a
 * list of organisations is refused: this page spans all of them.
 */
@ApiTags('Customer Statistics')
@Controller('v1/customer-statistics')
@ApiBearerAuth()
@ApiSecurity('access-token')
@StaffOnly()
export class CustomerStatisticsController {
  constructor(private readonly service: CustomerStatisticsService) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      'How each customer organisation is doing, and who to get in touch with',
    description:
      "One row per organisation in the caller's scope: activity over the last 28 days against the 28 before, last activity, a 12-week trend, credits, and the reasons to get in touch. Aggregates only. Kept for ten minutes.",
  })
  @ApiResponse({ status: 200, description: 'The customer overview' })
  async overview(): Promise<CustomerOverview> {
    return this.service.getOverview(requireUserId());
  }

  @Post('outreach')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @HttpCode(204)
  @ApiOperation({
    summary: 'Record that you got in touch with an organisation',
    description:
      'Adds a contact with an optional short note. The organisation drops down the ranking for a week.',
  })
  @ApiResponse({ status: 204, description: 'Recorded' })
  async outreach(@Body() body: CustomerOutreachBodyDto): Promise<void> {
    await this.service.recordContact(requireUserId(), body.tenantId, body.note);
  }
}

function requireUserId(): number {
  const id = ExecutionManager.getUserId();
  if (!id) throw new Error('A signed-in user is required');
  return Number(id);
}
