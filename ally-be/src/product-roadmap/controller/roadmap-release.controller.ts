import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';

import {
  ReleasePlanQueryDto,
  ReleaseServiceDto,
} from '../dto/release-policy.dto';
import { RoadmapV2EnabledGuard } from '../guard/roadmap-v2-enabled.guard';
import { ReleasePolicyService } from '../service/release-policy.service';

/**
 * Releases on the Roadmap (Roadmap v2, P5; plan §5.5, D5/D6): the plan behind
 * the idea page's Ship tab and the release dialog, the Release click, and the
 * Owner's Resume.
 *
 * Every route is 404 while `roadmap_v2` is off (`RoadmapV2EnabledGuard`, at
 * controller level so it runs before sign-in is even checked), so nothing
 * here can dispatch in production before the cutover. Who may do what is
 * decided in `ReleasePolicyService` (Owner, or the lead of an idea in the
 * range), not by a route toggle, because a lead's right comes from the ideas
 * in the range.
 */
@ApiTags('Product Roadmap')
@ApiBearerAuth()
@ApiSecurity('access-token')
@UseGuards(RoadmapV2EnabledGuard)
@Controller({ path: 'roadmap/release', version: '1' })
export class RoadmapReleaseController {
  constructor(private readonly releasePolicyService: ReleasePolicyService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('plan')
  @ApiOperation({
    summary: 'What a production release of one service would ship now',
    description:
      'Every commit in lastSuccessfulProdTag...master for the service (other people’s included), the held paths ' +
      'they touch (file → rule), the ideas linked to them, the tag it would take, and what the auto-release ' +
      'policy would do (shadow mode in this phase). 404 while roadmap_v2 is off.',
  })
  plan(@CurrentUser() user: TokenUser, @Query() query: ReleasePlanQueryDto) {
    return this.releasePolicyService.getPlan(user.id, query.service);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Release one service to production (a Release click)',
    description:
      'Dispatches the service’s production release workflow at master through ProductionReleaseService. ' +
      'For an Owner, or the lead of an idea whose commits are in the range. Works while auto-release is ' +
      'paused. 409 when more of the service landed since the plan was read, when a release is already ' +
      'running, or when the range could not be read. 404 while roadmap_v2 is off.',
  })
  release(@CurrentUser() user: TokenUser, @Body() dto: ReleaseServiceDto) {
    return this.releasePolicyService.release(
      user.id,
      dto.service,
      dto.serviceHeadSha,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Resume auto-release after the circuit breaker paused it (Owner only)',
    description: 'Idempotent. 404 while roadmap_v2 is off.',
  })
  resume(@CurrentUser() user: TokenUser) {
    return this.releasePolicyService.resume(user.id);
  }
}
