import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import {
  CreateIdeaDraftDto,
  UpdateIdeaDraftDto,
} from '../dto/roadmap-idea-draft.dto';
import { RoadmapIdeaDraftService } from '../service/roadmap-idea-draft.service';
import { RoadmapIdeaTranscriptionService } from '../service/roadmap-idea-transcription.service';

/** Private, unpublished raw ideas. Same tier as filing an opportunity (VOTE). */
@ApiTags('Product Roadmap')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-roadmap/idea-drafts', version: '1' })
export class RoadmapIdeaDraftController {
  constructor(
    private readonly drafts: RoadmapIdeaDraftService,
    private readonly transcription: RoadmapIdeaTranscriptionService,
  ) {}

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Get()
  @ApiOperation({ summary: "List the caller's own idea drafts" })
  list(@CurrentUser() user: TokenUser) {
    return this.drafts.list(user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Post()
  @ApiOperation({ summary: 'Save a raw idea as a private draft' })
  create(@CurrentUser() user: TokenUser, @Body() dto: CreateIdeaDraftDto) {
    return this.drafts.create(user.id, dto);
  }

  /**
   * One spoken phrase from the idea-capture mic, as text. Nothing is saved: the words go back to
   * the capture screen, and only Save there creates a draft. Memory storage keeps the clip as an
   * in-memory buffer; 25MB is the transcription API's cap.
   */
  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Transcribe one spoken phrase for idea capture. Audio is processed in memory and never stored.',
  })
  async transcribe(
    @UploadedFile() audio: Express.Multer.File,
  ): Promise<{ text: string }> {
    return { text: await this.transcription.transcribe(audio) };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Patch(':id')
  @ApiOperation({ summary: 'Edit one of your drafts' })
  update(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIdeaDraftDto,
  ) {
    return this.drafts.update(user.id, id, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard one of your drafts' })
  remove(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.drafts.remove(user.id, id);
  }
}
