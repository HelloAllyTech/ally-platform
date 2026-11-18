import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  AcceptImageRequestDto,
  CastSheetDto,
  DescribeImageRequestDto,
  DescribeImageResponseDto,
  EstimateImagesRequestDto,
  EstimateImagesResponseDto,
  GeneratedImageDto,
  GenerateImageBatchRequestDto,
  GenerateImageRequestDto,
  GenerateImagesResponseDto,
  GetCastSheetsQueryDto,
  GetHistoryQueryDto,
  GetJobsQueryDto,
  ImageSlotProfileDto,
  ImageStudioConfigDto,
  ImageStyleDto,
} from '../dto/image-studio.dto';
import { ImageStudioService } from '../service/image-studio.service';

/** Anyone who authors something with an image slot may generate one. */
const AUTHOR_PERMISSIONS = [
  PERMISSIONS.EDIT_ADMIN_TRACK,
  PERMISSIONS.EDIT_SCENARIO,
  PERMISSIONS.EDIT_SCENARIO_CHARACTER,
  PERMISSIONS.EDIT_ADMIN_BADGES,
  PERMISSIONS.EDIT_ADMIN_CASE,
  PERMISSIONS.EDIT_ADMIN_SCENARIO_PATH,
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const splitIds = (raw: string, max: number): string[] => {
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length || ids.length > max || ids.some((id) => !UUID.test(id))) {
    throw new BadRequestException(`Pass 1–${max} comma-separated ids.`);
  }
  return ids;
};

@ApiTags('Image Studio')
@Controller('/v1/image-studio')
export class ImageStudioController {
  constructor(private readonly imageStudio: ImageStudioService) {}

  @ApiOperation({ summary: 'Whether Image Studio is on, and its limits' })
  @ApiResponse({ status: 200, type: ImageStudioConfigDto })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Get('config')
  getConfig(): ImageStudioConfigDto {
    return this.imageStudio.getConfig();
  }

  @ApiOperation({ summary: 'The style gallery' })
  @ApiResponse({ status: 200, type: [ImageStyleDto] })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Get('styles')
  getStyles(): ImageStyleDto[] {
    return this.imageStudio.getStyles();
  }

  @ApiOperation({ summary: 'Every image slot with its shape and defaults' })
  @ApiResponse({ status: 200, type: [ImageSlotProfileDto] })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Get('slots')
  getSlots(): ImageSlotProfileDto[] {
    return this.imageStudio.getSlots();
  }

  @ApiOperation({
    summary: 'Draft a picture description from the content around a slot',
    description:
      'Synchronous; one fast model call. Also returns alt text and a safety verdict.',
  })
  @ApiResponse({ status: 201, type: DescribeImageResponseDto })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Post('describe')
  describe(
    @CurrentUser() user: TokenUser,
    @Body() dto: DescribeImageRequestDto,
  ): Promise<DescribeImageResponseDto> {
    return this.imageStudio.describe(user, dto);
  }

  @ApiOperation({
    summary: 'Generate 1–4 images for a slot',
    description:
      'Screens and plans the request, then queues one row per variation and returns at ' +
      'once; poll GET jobs. 422 with `safety` when the request is blocked, 429 when the ' +
      'author has too many images in flight, 503 when Image Studio is off.',
  })
  @ApiResponse({ status: 201, type: GenerateImagesResponseDto })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Post('jobs')
  generate(
    @CurrentUser() user: TokenUser,
    @Body() dto: GenerateImageRequestDto,
  ): Promise<GenerateImagesResponseDto> {
    return this.imageStudio.generate(user, dto);
  }

  @ApiOperation({
    summary:
      'Generate one image for each of up to 20 slots (e.g. fill empty scenes)',
    description:
      'A blocked item comes back as a failed image with the reason, not a 422.',
  })
  @ApiResponse({ status: 201, type: GenerateImagesResponseDto })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Post('jobs/batch')
  generateBatch(
    @CurrentUser() user: TokenUser,
    @Body() dto: GenerateImageBatchRequestDto,
  ): Promise<GenerateImagesResponseDto> {
    return this.imageStudio.generateBatch(user, dto.items);
  }

  @ApiOperation({
    summary: 'Estimated cost of a request or batch, before it runs',
  })
  @ApiResponse({ status: 200, type: EstimateImagesResponseDto })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  estimate(@Body() dto: EstimateImagesRequestDto): EstimateImagesResponseDto {
    return this.imageStudio.estimate(dto);
  }

  @ApiOperation({
    summary: 'Poll generated images by id (caller’s tenant only)',
  })
  @ApiResponse({ status: 200, type: [GeneratedImageDto] })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Get('jobs')
  getJobs(
    @CurrentUser() user: TokenUser,
    @Query() query: GetJobsQueryDto,
  ): Promise<GeneratedImageDto[]> {
    return this.imageStudio.getJobs(user, splitIds(query.ids, 80));
  }

  @ApiOperation({
    summary: 'Earlier images generated for one slot, newest first',
  })
  @ApiResponse({ status: 200, type: [GeneratedImageDto] })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Get('history')
  history(
    @CurrentUser() user: TokenUser,
    @Query() query: GetHistoryQueryDto,
  ): Promise<GeneratedImageDto[]> {
    return this.imageStudio.history(user, query.slotKey, query.limit);
  }

  @ApiOperation({
    summary: 'Mark an image as used',
    description:
      'Keeps it from the retention cleanup. With `trackId`, the first accepted image of a ' +
      'course with no style example becomes it.',
  })
  @ApiResponse({ status: 200, type: GeneratedImageDto })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Post('images/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptImageRequestDto,
  ): Promise<GeneratedImageDto> {
    return this.imageStudio.accept(user, id, dto.trackId);
  }

  @ApiOperation({
    summary: 'The accepted cast sheet per character, for one style',
  })
  @ApiResponse({ status: 200, type: [CastSheetDto] })
  @AuthPermissions(AUTHOR_PERMISSIONS, 'OR')
  @Get('cast-sheets')
  castSheets(
    @CurrentUser() user: TokenUser,
    @Query() query: GetCastSheetsQueryDto,
  ): Promise<CastSheetDto[]> {
    return this.imageStudio.castSheets(
      user,
      splitIds(query.characterIds, 20),
      query.styleId,
    );
  }
}
