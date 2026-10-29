import { Controller, Get, Query } from '@nestjs/common';
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
import { BuilderHistoryService } from '../service/builder-history.service';
import { BuilderNowService } from '../service/builder-now.service';
import { ListBuilderHistoryQueryDto } from '../dto/builder.dto';

/**
 * The Builder tab's own surface — Now, Rules and History — kept apart from
 * BuilderController, which is the session page's. The decision feed itself
 * (list, answer, undo) stays on BuilderController next to the session actions
 * it routes to.
 */
@ApiTags('Builder')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'builder', version: '1' })
export class BuilderRoomController {
  constructor(
    private readonly historyService: BuilderHistoryService,
    private readonly nowService: BuilderNowService,
  ) {}

  /**
   * The Now tab in one read: sessions in progress grouped by what they wait
   * on, the decisions waiting on a person, and the in-progress limit.
   */
  @Get('now')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'The Builder tab: in progress, decisions, limit' })
  now() {
    return this.nowService.now();
  }

  /** Every decision, ask and tell, newest first. Read-only: corrections are rules, never edits. */
  @Get('history')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Builder History, searched and filtered' })
  listHistory(
    @Query() query: ListBuilderHistoryQueryDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.historyService.list(query, user.id);
  }
}
