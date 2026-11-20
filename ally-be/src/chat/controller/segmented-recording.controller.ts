import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { TokenUser } from '../../auth/type/auth.types';
import { SettingsService } from '../../settings/service/settings.service';
import {
  FinalizeSegmentedRecordingDto,
  SegmentUploadUrlDto,
  StartSegmentedRecordingDto,
} from '../dto/segmented-recording.dto';
import {
  MAX_SEGMENTS,
  SEGMENT_SECONDS,
  SegmentedRecordingService,
} from '../service/segmented-recording.service';

/**
 * Segmented Scribe recording: the app uploads ~30 s segments straight to S3
 * and calls finalize on Stop. See SegmentedRecordingService.
 */
@ApiTags('Scribe recordings')
@Controller('v1/scribe-recordings')
export class SegmentedRecordingController {
  constructor(
    private readonly service: SegmentedRecordingService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get('config')
  @AuthPermissions([PERMISSIONS.START_MICROPHONE_CHAT])
  @ApiOperation({
    summary: 'Whether this org records in segments, and the segment size',
  })
  async config() {
    return {
      enabled: await this.settingsService.getScribeSegmentedRecordingEnabled(),
      segmentSeconds: SEGMENT_SECONDS,
      maxSegments: MAX_SEGMENTS,
    };
  }

  @Post()
  @AuthPermissions([PERMISSIONS.START_MICROPHONE_CHAT])
  @ApiOperation({
    summary: 'Start a segmented Scribe recording (creates the chat)',
  })
  start(
    @CurrentUser() user: TokenUser,
    @Body() dto: StartSegmentedRecordingDto,
  ) {
    return this.service.start(user.id, dto);
  }

  @Post(':chatId/segments/:index/upload-url')
  @HttpCode(200)
  @AuthPermissions([PERMISSIONS.START_MICROPHONE_CHAT])
  @ApiOperation({ summary: 'Presigned URL to PUT one segment to S3' })
  segmentUploadUrl(
    @CurrentUser() user: TokenUser,
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SegmentUploadUrlDto,
  ) {
    return this.service.segmentUploadUrl(
      user.id,
      chatId,
      index,
      dto.contentType,
    );
  }

  @Post(':chatId/finalize')
  @HttpCode(200)
  @AuthPermissions([PERMISSIONS.START_MICROPHONE_CHAT])
  @ApiOperation({
    summary:
      'Finish the recording: checks every segment arrived (status "missing" lists the ones to upload), ends the chat and starts transcription',
  })
  finalize(
    @CurrentUser() user: TokenUser,
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: FinalizeSegmentedRecordingDto,
  ) {
    return this.service.finalize(user.id, chatId, dto);
  }
}
