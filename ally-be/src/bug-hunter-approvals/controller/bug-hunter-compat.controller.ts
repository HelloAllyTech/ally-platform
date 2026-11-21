import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { BugHunterCompatService } from '../service/bug-hunter-compat.service';

class CompatListQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

class CompatRejectDto {
  @IsIn([
    'not_a_bug',
    'duplicate',
    'wrong_repo',
    'wont_fix',
    'too_risky',
    'other',
  ])
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

class CompatModeDto {
  @IsIn(['off', 'manual', 'ai'])
  mode!: string;
}

/**
 * Bug Hunter v2 in the old Bug Hunter's API shape (chunk 11, the exact-match page): the
 * old page's components read v2's queue here and its buttons act on v2. Same toggle as
 * every v2 route.
 */
@ApiTags('Bug Hunter v2')
@Controller('v1/bug-hunter-approvals/compat')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class BugHunterCompatController {
  constructor(private readonly compat: BugHunterCompatService) {}

  @Get('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'The v2 mode in the old shape (ai = autonomous)' })
  settings() {
    return this.compat.settings();
  }

  @Put('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'Switch the v2 mode (audited)' })
  setMode(@Body() dto: CompatModeDto, @Req() req: any) {
    return this.compat.setMode(dto.mode, Number(req.user?.id));
  }

  @Get('findings')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: "v2's bugs as the old page's findings" })
  findings(@Query() q: CompatListQueryDto) {
    return this.compat.list(q.limit ?? 100, q.offset ?? 0);
  }

  @Get('findings/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'One v2 bug as the old drawer shows it' })
  finding(@Param('id') id: string) {
    return this.compat.detail(id);
  }

  @Get('findings/:id/decisions')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'v2 records no decision log; always empty' })
  decisions() {
    return [];
  }

  @Post('findings/:id/approve')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({
    summary: 'Approve: Open PR on a suggested fix, else Put me on it',
  })
  approve(@Param('id') id: string, @Req() req: any) {
    return this.compat.approve(id, Number(req.user?.id));
  }

  @Post('findings/:id/reject')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'Decline: Dismiss with the reason' })
  reject(
    @Param('id') id: string,
    @Body() dto: CompatRejectDto,
    @Req() req: any,
  ) {
    return this.compat.reject(id, dto.reason, dto.note, Number(req.user?.id));
  }

  @Post('findings/:id/fix-session')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'Put me on it: queue the bug for the worker' })
  start(@Param('id') id: string, @Req() req: any) {
    return this.compat.start(id, Number(req.user?.id));
  }

  @Post('findings/:id/merge')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: "Merge the bug's PR (a person's click)" })
  merge(@Param('id') id: string, @Req() req: any) {
    return this.compat.merge(id, Number(req.user?.id));
  }

  @Post('findings/:id/release')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'Release a merged fix' })
  release(@Param('id') id: string, @Req() req: any) {
    return this.compat.release(id, Number(req.user?.id));
  }
}
