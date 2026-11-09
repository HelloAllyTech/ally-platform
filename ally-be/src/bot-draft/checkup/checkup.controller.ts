import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { CHECKUP_LIMITS, CheckupService, SuiteCase } from './checkup.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };
const EXPECT = ['answer', 'decline', 'clarify', 'crisis_only', 'smalltalk'];
const SUITE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class SuiteCaseDto implements SuiteCase {
  @ApiProperty() @IsString() @MaxLength(64) id!: string;
  @ApiProperty() @IsString() @MaxLength(500) send!: string;
  @ApiProperty({ enum: EXPECT }) @IsIn(EXPECT) expect!: SuiteCase['expect'];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  thread?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  facts?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  must_not?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  also_ok?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hard_fail?: boolean;
  @ApiPropertyOptional({ enum: ['must_pass', 'nice_to_pass'] })
  @IsOptional()
  @IsIn(['must_pass', 'nice_to_pass'])
  tier?: 'must_pass' | 'nice_to_pass';
}

export class ImportSuiteDto {
  @ApiProperty() @Matches(SUITE) suite!: string;

  @ApiProperty({ type: [SuiteCaseDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SuiteCaseDto)
  cases!: SuiteCaseDto[];
}

export class StartRunDto {
  @ApiPropertyOptional({ enum: ['manual', 'eval'] })
  @IsOptional()
  @IsIn(['manual', 'eval'])
  trigger?: 'manual' | 'eval';

  @ApiPropertyOptional({ description: 'Ask only this suite (evals)' })
  @IsOptional()
  @Matches(SUITE)
  suite?: string;

  @ApiPropertyOptional({
    description: 'Ask each question this many times (evals, platform admins)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CHECKUP_LIMITS.maxAttempts)
  attempts?: number;
}

/**
 * The Checkup (chunk 20a-2): an assistant's test questions, run through its own engine and graded
 * by the one grader. Members read; editors run it. Eval suites are platform admins only.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class CheckupController {
  constructor(private readonly checkup: CheckupService) {}

  @Post(':id/checkup/suites')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: "Add or update an eval suite's questions (platform admins)",
  })
  importSuite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportSuiteDto,
  ) {
    return this.checkup.importSuite(id, dto.suite, dto.cases);
  }

  @Post(':id/checkup/runs')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Start a checkup run',
    description:
      'Answers at once with the run; poll GET …/checkup/runs/:runId for results.',
  })
  start(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StartRunDto) {
    return this.checkup.start(id, {
      trigger: dto.trigger ?? 'manual',
      suite: dto.suite ?? null,
      attempts: dto.attempts,
    });
  }

  @Get(':id/checkup/runs/:runId')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'A checkup run with its results and numbers' })
  getRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.checkup.getRun(id, runId);
  }
}
