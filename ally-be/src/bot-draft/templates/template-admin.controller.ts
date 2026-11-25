import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
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
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AuthPermissions } from '../../auth/decorators/auth-permissions.decorator';
import { StaffOnly } from '../../auth/decorators/staff-only.decorator';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { AssistantScope } from '../../chatbot/access/chatbot-role.decorator';
import { TEMPLATE_KEY_PATTERN } from '../../chatbot/templates/template-validation';
import { TemplateAdminService } from './template-admin.service';

const KEY = TEMPLATE_KEY_PATTERN;

export class TemplateSourceDto {
  @ApiPropertyOptional()
  @IsString()
  @Matches(KEY)
  key!: string;

  @ApiPropertyOptional({
    description: 'A stored version; omit for the live one or the built-in.',
  })
  @IsOptional()
  @Type(() => Number)
  version?: number;
}

export class CreateTemplateDraftDto {
  @ApiPropertyOptional({ example: 'dental_clinic' })
  @IsString()
  @MaxLength(40)
  key!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Start as a copy of this template. Same key as the source: it replaces that template once published. A new key: a new template.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateSourceDto)
  from?: TemplateSourceDto;
}

export class SaveTemplateDraftDto {
  @ApiPropertyOptional({
    description: 'The whole template (see GET meta for its parts).',
  })
  @IsObject()
  manifest!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'What changed, for the version history.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class PublishTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** Ally staff (404 to anyone else) with system access, like the other Defaults & library screens. */
const Staff = () =>
  applyDecorators(
    StaffOnly(),
    AssistantScope('platform'),
    AuthPermissions([PERMISSIONS.SYSTEM_ACCESS]),
  );

/**
 * Assistants admin → Defaults & library → Templates: build, version and publish the use-case
 * templates owners start from. Nothing here installs a template on an assistant, and publishing
 * never changes an assistant that was already set up from one.
 */
@ApiTags('Staff')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/staff/assistant-templates')
export class TemplateAdminController {
  constructor(private readonly admin: TemplateAdminService) {}

  @Get()
  @Staff()
  @ApiOperation({
    summary: 'Every template, built-in or staff-made, one row each',
  })
  list() {
    return this.admin.list();
  }

  // Before `:key`, so "meta" is never read as a template key.
  @Get('meta')
  @Staff()
  @ApiOperation({
    summary:
      'What the editor offers: lists, packs, purposes, groups and the size rules',
  })
  meta() {
    return this.admin.meta();
  }

  @Post()
  @Staff()
  @ApiOperation({
    summary: 'Start a draft: blank, or a copy of a template',
    description:
      'The same key as the source edits that template (once published it replaces it); a new key makes a new template.',
  })
  create(@Body() dto: CreateTemplateDraftDto) {
    return this.admin.createDraft(dto);
  }

  @Get(':key')
  @Staff()
  @ApiOperation({
    summary:
      'One template: what is live, the open draft with its problems, every version',
  })
  get(@Param('key') key: string) {
    return this.admin.get(key);
  }

  @Get(':key/versions/:version')
  @Staff()
  @ApiOperation({ summary: 'One stored version, with its content' })
  version(
    @Param('key') key: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.admin.getVersion(key, version);
  }

  @Put(':key/draft')
  @Staff()
  @ApiOperation({
    summary: 'Save the open draft',
    description:
      'A draft may be half-finished: problems come back in `issues`, nothing is refused.',
  })
  save(@Param('key') key: string, @Body() dto: SaveTemplateDraftDto) {
    return this.admin.saveDraft(key, dto.manifest, dto.note);
  }

  @Delete(':key/draft')
  @Staff()
  @ApiOperation({ summary: 'Throw the open draft away' })
  discard(@Param('key') key: string) {
    return this.admin.discardDraft(key);
  }

  @Post(':key/draft/publish')
  @Staff()
  @ApiOperation({
    summary: 'Publish the open draft',
    description:
      'Refused with the list of problems until the template passes every check. Owners see it in the catalogue at once; assistants already set up from the template are not changed.',
  })
  publish(@Param('key') key: string, @Body() dto: PublishTemplateDto) {
    return this.admin.publish(key, dto.note);
  }

  @Post(':key/unpublish')
  @Staff()
  @ApiOperation({
    summary: 'Take the live version down',
    description:
      'A built-in comes back as it is in code; a staff-made template leaves the catalogue.',
  })
  unpublish(@Param('key') key: string) {
    return this.admin.unpublish(key);
  }

  @Post(':key/versions/:version/restore')
  @Staff()
  @ApiOperation({ summary: 'Copy an older version into a new draft' })
  restore(
    @Param('key') key: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.admin.restore(key, version);
  }
}
