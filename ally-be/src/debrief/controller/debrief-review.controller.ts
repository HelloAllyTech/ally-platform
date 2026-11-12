import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseInterceptors,
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
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { DebriefReviewVerdict } from '../enum/debrief-review.enum';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefReviewService } from '../service/debrief-review.service';
import { DebriefAct } from '../util/debrief-console-roles.util';

type AuthedRequest = { user: { id: number } };

class VerdictDto {
  @ApiProperty({ enum: DebriefReviewVerdict })
  @IsEnum(DebriefReviewVerdict)
  verdict!: DebriefReviewVerdict;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  hardFails?: string[];
}

/**
 * Expert review (debrief orchestrator spec Part B): the verdict, given from
 * the Debrief Console's session page. Comments go through the console's own
 * comment routes; every call is audited, as the Console is.
 */
@ApiTags('Debriefs — expert review')
@Controller('v1/debriefs/expert-review')
@UseInterceptors(DebriefConsoleAuditInterceptor)
@ApiBearerAuth()
@ApiSecurity('access-token')
export class DebriefReviewController {
  constructor(private readonly reviews: DebriefReviewService) {}

  @Put('runs/:id/verdict')
  @DebriefAct('verdict')
  @ApiOperation({
    summary:
      'Give or change your verdict; it also joins the judge calibration set',
  })
  verdict(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Body() body: VerdictDto,
  ) {
    return this.reviews.setVerdict(id, req.user.id, body);
  }
}
