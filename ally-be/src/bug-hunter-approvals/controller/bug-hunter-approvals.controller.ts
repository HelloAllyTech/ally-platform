import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
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
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import {
  BulkBugsDto,
  DismissBugDto,
  ListBugsQueryDto,
  StartBugDto,
  UpdateModeDto,
} from '../dto/board.dto';
import { CreateVerdictDto, ListReportsQueryDto } from '../dto/verdict.dto';
import { BugHunterApprovalsService } from '../service/bug-hunter-approvals.service';
import { BugHunterBoardService } from '../service/bug-hunter-board.service';

/**
 * Bug Hunter v2 (chunk 09): its suggested fixes and escalations, and the two-part
 * verdict (diagnosis + fix) that teaches it. PLATFORM_ADMIN with the
 * BUG_HUNTER_V2_VERDICTS toggle only. Approve/reject for pull requests are part of
 * the design but stay switched off until the bug hunter runs in pr mode.
 */
@ApiTags('Bug Hunter v2')
@Controller('v1/bug-hunter-approvals')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class BugHunterApprovalsController {
  constructor(
    private readonly service: BugHunterApprovalsService,
    private readonly board: BugHunterBoardService,
  ) {}

  @Get('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({
    summary: 'The mode (off / manual / autonomous) and daily limit',
  })
  settings() {
    return this.board.settings();
  }

  @Put('settings/mode')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'Switch the mode (audited)' })
  setMode(@Body() dto: UpdateModeDto, @Req() req: any) {
    return this.board.setMode(dto.mode, Number(req.user?.id));
  }

  @Get('bugs')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({
    summary: 'The board: one tab of bugs, with the count of every tab',
  })
  bugs(@Query() query: ListBugsQueryDto) {
    return this.board.list(query);
  }

  @Post('bugs/:id/start')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'Start fix (Backlog) or Retry (Failed): queue it' })
  start(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartBugDto,
    @Req() req: any,
  ) {
    return this.board.start(id, dto, Number(req.user?.id));
  }

  @Post('bugs/bulk')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'Put me on / Dismiss several bugs (audited each)' })
  bulk(@Body() dto: BulkBugsDto, @Req() req: any) {
    return this.board.bulk(
      dto.action,
      dto.ids,
      dto.reason,
      Number(req.user?.id),
    );
  }

  @Post('bugs/:id/dismiss')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({
    summary: 'Dismiss with a reason (audited; may record a verdict)',
  })
  dismiss(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DismissBugDto,
    @Req() req: any,
  ) {
    return this.board.dismiss(id, dto, Number(req.user?.id));
  }

  @Post('bugs/:id/open-pr')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({
    summary: 'Open a draft PR from a suggested fix (queued for the worker)',
  })
  openPr(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.board.openPr(id, Number(req.user?.id));
  }

  @Post('bugs/:id/merge')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({
    summary: "Merge the bug's PR (a person's click; records the verdict)",
  })
  merge(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.board.merge(id, Number(req.user?.id));
  }

  @Post('bugs/:id/release')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({
    summary: "Release a merged fix (the app's production-release workflow)",
  })
  release(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.board.release(id, Number(req.user?.id));
  }

  @Get('reports')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'Suggested fixes and escalations to judge' })
  list(@Query() query: ListReportsQueryDto) {
    return this.service.list(query);
  }

  @Get('reports/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'One report: finding, repro test, patch, verdicts' })
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }

  @Post('reports/:id/verdict')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({
    summary: 'Record (or amend) the verdict: diagnosis, fix and a reason',
  })
  verdict(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateVerdictDto,
    @Req() req: any,
  ) {
    return this.service.recordVerdict(id, dto, Number(req.user?.id));
  }

  @Post('approvals/:runId/approve')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'pr mode only: approve a draft PR (switched off)' })
  approve() {
    return prModeOff();
  }

  @Post('approvals/:runId/reject')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS)
  @ApiOperation({ summary: 'pr mode only: reject a draft PR (switched off)' })
  reject() {
    return prModeOff();
  }
}

function prModeOff(): never {
  throw new ForbiddenException({
    code: 'PR_MODE_OFF',
    message:
      'Bug Hunter v2 suggests fixes; it does not open pull requests yet, so there is nothing to approve.',
  });
}
