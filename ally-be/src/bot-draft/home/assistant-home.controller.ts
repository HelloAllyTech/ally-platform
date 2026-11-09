import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsDefined,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { AssistantHomeService } from './assistant-home.service';
import { HOME_FIELDS } from './home-fields';
import type { RuleChange } from './own-rules';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

const VERSION = /^[0-9a-f]{16}$/;

export class SaveHomeFieldDto {
  @ApiProperty({ enum: Object.keys(HOME_FIELDS) })
  @IsIn(Object.keys(HOME_FIELDS))
  field!: string;

  @ApiProperty({ description: 'The new value; its shape depends on the field' })
  @IsDefined()
  value!: unknown;

  @ApiProperty({
    description: 'The version of the value this edit started from',
  })
  @Matches(VERSION)
  version!: string;
}

export class ChangeRuleDto {
  @ApiProperty({ enum: ['add', 'edit', 'remove'] })
  @IsIn(['add', 'edit', 'remove'])
  op!: 'add' | 'edit' | 'remove';

  @ApiPropertyOptional({
    description: '`own-<n>`; a `pack-<n>` rule is refused',
  })
  @ValidateIf((dto: ChangeRuleDto) => dto.op !== 'add')
  @Matches(/^(own|pack)-\d{1,3}$/)
  id?: string;

  @ApiPropertyOptional()
  @ValidateIf((dto: ChangeRuleDto) => dto.op !== 'remove')
  @IsString()
  @MaxLength(400)
  text?: string;

  @ApiProperty()
  @Matches(VERSION)
  version!: string;
}

export class CorrectFactDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  text!: string;

  @ApiProperty({
    description: "The version of the fact's text this correction started from",
  })
  @Matches(VERSION)
  version!: string;
}

/**
 * The assistant home (chunk 20d): everything an owner edits after onboarding, one field at a time.
 * Members read; editors change.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class AssistantHomeController {
  constructor(private readonly home: AssistantHomeService) {}

  @Get(':id/home')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary:
      "The assistant's fields with their versions, safety rules and what it learned",
  })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.home.get(id);
  }

  @Patch(':id/home')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Save one field',
    description:
      'Refused with 409 and the current value when the field changed since `version`.',
  })
  saveField(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveHomeFieldDto,
  ) {
    return this.home.saveField(id, dto);
  }

  @Patch(':id/rules')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      "Add, edit or remove one of the owner's own rules; pack rules are fixed",
  })
  changeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRuleDto,
  ) {
    return this.home.changeRule(id, {
      ...(dto as unknown as RuleChange),
      version: dto.version,
    });
  }

  @Post(':id/facts/:factId/correction')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Correct a learned detail; the correction replaces the original for the assistant',
  })
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('factId') factId: string,
    @Body() dto: CorrectFactDto,
  ) {
    return this.home.correctFact(id, factId.slice(0, 64), dto);
  }
}
