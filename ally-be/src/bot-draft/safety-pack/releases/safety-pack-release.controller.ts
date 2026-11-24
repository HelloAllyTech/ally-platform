import {
  applyDecorators,
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  PipeTransform,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AuthPermissions } from '../../../auth/decorators/auth-permissions.decorator';
import { StaffOnly } from '../../../auth/decorators/staff-only.decorator';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { AssistantScope } from '../../../chatbot/access/chatbot-role.decorator';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { MAX_LINE_CHARS, MAX_LIST_ITEMS } from './release-content';
import {
  SAFETY_PACK_IDS,
  SafetyPackReleaseService,
} from './safety-pack-release.service';

/** A path parameter that must be one of `allowed`. */
export class ParseInPipe implements PipeTransform<string, string> {
  constructor(private readonly allowed: readonly string[]) {}
  transform(value: string): string {
    if (!this.allowed.includes(value))
      throw new BadRequestException('Unknown safety pack');
    return value;
  }
}

export class CreatePackDraftDto {
  @ApiPropertyOptional({ enum: ['current', 'code'] })
  @IsOptional()
  @IsIn(['current', 'code'])
  source?: 'current' | 'code';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

class RequiredSettingsDto {
  @IsBoolean()
  crisisClassifierEnabled!: boolean;
}

export class UpdatePackDraftDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_LINE_CHARS, { each: true })
  rules?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_LINE_CHARS, { each: true })
  always?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_LINE_CHARS, { each: true })
  never?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_LINE_CHARS, { each: true })
  atRisk?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_ITEMS)
  @IsString({ each: true })
  @MaxLength(MAX_LINE_CHARS, { each: true })
  probes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_LINE_CHARS)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_LINE_CHARS)
  industryLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_LINE_CHARS)
  builderMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_LINE_CHARS)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_LINE_CHARS)
  disclaimer?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => RequiredSettingsDto)
  requiredSettings?: RequiredSettingsDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RunPackSuiteDto {
  @ApiPropertyOptional({
    description: 'A chatbot you can edit; the draft pack is tested on it',
  })
  @IsUUID()
  chatbotId!: string;
}

export class RollbackPackDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/** Ally staff (404 to anyone else) holding `manage:safety-packs`. */
const Curator = () =>
  applyDecorators(
    StaffOnly(),
    AssistantScope('platform'),
    AuthPermissions([PERMISSIONS.MANAGE_SAFETY_PACKS]),
  );

const userId = () => Number(ExecutionManager.getUserId() ?? 0) || null;

/**
 * Assistants stage 9: safety pack releases, for Ally curators (`manage:safety-packs`; 404 to
 * anyone who is not Ally staff). Draft, run the crisis suite, release, roll back.
 */
@ApiTags('Staff')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/staff/safety-packs')
export class SafetyPackReleaseController {
  constructor(private readonly releases: SafetyPackReleaseService) {}

  @Get()
  @Curator()
  @ApiOperation({
    summary:
      'Every safety pack: the current release, its history, and the languages a release must pass',
  })
  list() {
    return this.releases.list();
  }

  @Get('releases/:releaseId')
  @Curator()
  @ApiOperation({
    summary:
      'One release: its content, what it changes against the current release, and what blocks it',
  })
  get(@Param('releaseId', ParseUUIDPipe) releaseId: string) {
    return this.releases.get(releaseId);
  }

  @Post(':packId/releases')
  @Curator()
  @ApiOperation({
    summary: 'A new draft from the current release (or the code pack)',
  })
  create(
    @Param('packId', new ParseInPipe(SAFETY_PACK_IDS)) packId: string,
    @Body() dto: CreatePackDraftDto,
  ) {
    return this.releases.createDraft(packId, dto, userId());
  }

  @Patch('releases/:releaseId')
  @Curator()
  @ApiOperation({
    summary: 'Change a draft; any earlier crisis check result is cleared',
  })
  update(
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @Body() dto: UpdatePackDraftDto,
  ) {
    const { note, ...change } = dto;
    return this.releases.updateDraft(releaseId, change, note);
  }

  @Post('releases/:releaseId/suite')
  @Curator()
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Run the crisis suite on a draft in every supported language (Ally pays; runs in the background)',
  })
  suite(
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @Body() dto: RunPackSuiteDto,
  ) {
    return this.releases.startSuite(releaseId, dto.chatbotId, userId());
  }

  @Post('releases/:releaseId/release')
  @Curator()
  @ApiOperation({
    summary:
      'Release a draft that passed in every language (no override); every chatbot on the pack uses it and owners are emailed',
  })
  release(@Param('releaseId', ParseUUIDPipe) releaseId: string) {
    return this.releases.release(releaseId, userId());
  }

  @Post(':packId/rollback')
  @Curator()
  @ApiOperation({
    summary:
      'Go back to the release before the current one; owners are emailed',
  })
  rollback(
    @Param('packId', new ParseInPipe(SAFETY_PACK_IDS)) packId: string,
    @Body() dto: RollbackPackDto,
  ) {
    return this.releases.rollback(packId, userId(), dto.note);
  }
}
