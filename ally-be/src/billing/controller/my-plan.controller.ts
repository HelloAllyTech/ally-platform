import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PlanViewService } from '../service/plan-view.service';

/**
 * The owner's Plan and usage (CR1 Part C): their own plan, tokens left, seats and this month's
 * counts. Any signed-in user, for themselves only. **Never dollars.**
 */
@ApiTags('Plan and usage')
@ApiBearerAuth()
@ApiSecurity('access-token')
@UseGuards(AuthGuard('jwt'))
@Controller('v1/me')
export class MyPlanController {
  constructor(private readonly views: PlanViewService) {}

  @ApiOperation({
    summary: 'My plan, tokens left, seats and this month’s usage (no prices)',
  })
  @Get('plan')
  plan(@CurrentUser() user: TokenUser) {
    return this.views.forUser(user.id);
  }
}
