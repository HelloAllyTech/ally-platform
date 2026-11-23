import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapSweepService } from './roadmap-sweep.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP] };

export class RoadmapSweepKeepDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  codes!: string[];
}

/**
 * The Owner's one-time sweep of To do (idea-to-plan audit rec 9): which old
 * ideas have at most one voter, and Keep. Declining goes through the existing
 * bulk review. 404 while `roadmap_v2` is off; 403 for anyone but an Owner.
 */
@ApiTags('Roadmap v2')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roadmap', version: '1' })
export class RoadmapSweepController {
  constructor(
    private readonly settings: PlanSettingsService,
    private readonly sweep: RoadmapSweepService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Get('todo-sweep')
  @ApiOperation({
    summary:
      'Owner: To do ideas older than 60 days with at most one voter, for the bulk review',
  })
  async list(@CurrentUser() user: TokenUser) {
    await this.settings.assertRoadmapV2();
    return this.sweep.list(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, VIEW)
  @Post('todo-sweep/keep')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Owner: keep these ideas; the sweep stops offering them',
  })
  async keep(@Body() dto: RoadmapSweepKeepDto, @CurrentUser() user: TokenUser) {
    await this.settings.assertRoadmapV2();
    return this.sweep.keep(user.id, dto.codes);
  }
}
