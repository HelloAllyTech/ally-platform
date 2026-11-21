import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import {
  IngestDeadCodeDto,
  IngestDeadCodeResponseDto,
} from '../dto/pm-agent-dead-code.dto';
import { PmAgentDeadCodeService } from '../service/pm-agent-dead-code.service';

/**
 * The machine door for the weekly dead-code report (`scripts/dead_code.py --publish`, run by
 * `.github/workflows/dead-code.yml`). `x-api-key` guarded, in its own controller, for the
 * reason BugHunterPipelineController gives: the report is an automated job, not a signed-in
 * admin, and the two auth models must not share a route table. It only stores evidence; see
 * PmAgentDeadCodeService.
 */
@ApiTags('PM Agent')
@Controller('v1/pm-agent/signals')
@UseGuards(ApiAuthGuard)
@ApiSecurity('api-key')
export class PmAgentDeadCodeController {
  constructor(private readonly deadCode: PmAgentDeadCodeService) {}

  @Post('dead-code')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Publish the weekly dead-code report as PM Agent evidence',
  })
  @ApiResponse({ status: 200, type: IngestDeadCodeResponseDto })
  ingest(@Body() dto: IngestDeadCodeDto): Promise<IngestDeadCodeResponseDto> {
    return this.deadCode.ingest(dto.groups);
  }
}
