import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import {
  LinkPullRequestsDto,
  LinkedPrsResponseDto,
} from '../dto/item-release.dto';
import { ItemReleaseService } from '../service/item-release.service';

/**
 * Release tracking for roadmap items (Roadmap v2, P1). The first route under
 * `/v1/roadmap/items`, the read model P2 builds out.
 */
@ApiTags('Product Roadmap')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roadmap/items', version: '1' })
export class RoadmapItemReleaseController {
  constructor(private readonly itemReleaseService: ItemReleaseService) {}

  /**
   * Builders and Owners only. Until P0's RoadmapRoleService lands this is the
   * gate that already guards setting a stage by hand — which is exactly what
   * this replaces — the manage toggle plus the roadmap edit permission.
   */
  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post(':code/linked-prs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Built elsewhere: link pull requests to a roadmap item',
    description:
      'Links GitHub pull requests (links, or numbers in the monorepo) to the item with this code ' +
      '(OPP-0388, opp-388 or 388). Once every service those pull requests touched is in a ' +
      'successful production release, the item moves to Released, as Builder work does.',
  })
  @ApiResponse({ status: 200, type: LinkedPrsResponseDto })
  linkPullRequests(
    @CurrentUser() user: TokenUser,
    @Param('code') code: string,
    @Body() dto: LinkPullRequestsDto,
  ): Promise<LinkedPrsResponseDto> {
    return this.itemReleaseService.linkPullRequests(user.id, code, dto.prs);
  }
}
