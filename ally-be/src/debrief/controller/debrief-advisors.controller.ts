import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { DebriefAdvisorsService } from '../service/debrief-advisors.service';

type AuthedRequest = { user: { id: number } };

/**
 * User Management › Clinical advisors: add and remove clinical advisors and
 * Debrief owners.
 * Gated exactly like User Management › Ally admins (the
 * `admin_user_management` toggle): the advisor role is platform-managed and
 * reaches every organisation, so it is granted where Ally admins are.
 */
@ApiTags('Debriefs')
@Controller('v1/clinical-advisors')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefAdvisorsController {
  constructor(private readonly advisors: DebriefAdvisorsService) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  @ApiOperation({ summary: 'The clinical advisors' })
  list() {
    return this.advisors.list();
  }

  @Get('search')
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  @ApiOperation({
    summary: 'Find a person by name or email (at least 3 characters)',
  })
  search(@Query('q') q: string) {
    return this.advisors.search(q);
  }

  @Put(':userId')
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  @ApiOperation({
    summary:
      "Make a person a clinical advisor. Adds only the advisor's access; nothing else they hold changes.",
  })
  add(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: AuthedRequest,
  ) {
    return this.advisors.add(userId, req.user.id);
  }

  @Delete(':userId')
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  @ApiOperation({
    summary:
      "Stop a person being a clinical advisor. Removes only the advisor's access.",
  })
  remove(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: AuthedRequest,
  ) {
    return this.advisors.remove(userId, req.user.id);
  }

  @Put(':userId/owner')
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  @ApiOperation({
    summary:
      'Make a person the Debrief owner (settings, releases, PM agent, Agent logs). Adds only that role; nothing else they hold changes.',
  })
  addOwner(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: AuthedRequest,
  ) {
    return this.advisors.add(userId, req.user.id, 'owner');
  }

  @Delete(':userId/owner')
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  @ApiOperation({
    summary: 'Stop a person being the Debrief owner. Removes only that role.',
  })
  removeOwner(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: AuthedRequest,
  ) {
    return this.advisors.remove(userId, req.user.id, 'owner');
  }
}
