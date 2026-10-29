import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { RoadmapUpNextService } from '../service/roadmap-up-next.service';

/**
 * The Builder tab's Up next, Start and Put back. Under `/builder` because that
 * is where the person is; in this module because opportunities are the
 * roadmap's, and the roadmap is the side allowed to depend on Builder.
 */
@ApiTags('Builder')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'builder', version: '1' })
export class RoadmapUpNextController {
  constructor(private readonly upNextService: RoadmapUpNextService) {}

  @Get('up-next')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'Prioritised opportunities not yet started, in roadmap order',
  })
  upNext(@CurrentUser() user: TokenUser) {
    return this.upNextService.upNext(user.id);
  }

  @Post('up-next/:opportunityId/start')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Start an opportunity: open its Builder session and run the first interview turn server-side',
  })
  start(
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.upNextService.start(user.id, opportunityId);
  }

  @Post('sessions/:sessionId/put-back')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Cancel an untouched interview and return its opportunity to the prioritised roadmap',
  })
  putBack(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.upNextService.putBack(user.id, sessionId);
  }
}
