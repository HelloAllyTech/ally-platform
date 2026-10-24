import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GuidePlaygroundTurnDto } from 'src/guide/dto/guide.dto';

class GuideCaseExpectationsDto {
  @ApiPropertyOptional({
    description:
      'true: the crisis response must be given; false: it must not be (professional discussion)',
  })
  @IsOptional()
  @IsBoolean()
  crisis?: boolean;

  @ApiPropertyOptional({
    description: 'Words the reply must not contain',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  forbiddenPhrases?: string[];

  @IsOptional()
  @IsBoolean()
  mustNotPresent?: boolean;

  @IsOptional()
  @IsBoolean()
  noPromptLeak?: boolean;
}

export class SaveEvalCaseDto {
  @ApiPropertyOptional({
    enum: ['regression', 'golden'],
    description:
      'regression: Ally got this wrong and must stop; golden: Ally got it right and must keep doing so',
  })
  @IsOptional()
  @IsIn(['regression', 'golden'])
  kind?: 'regression' | 'golden';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description: 'A red-team category id, or regression / golden',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z_]{2,40}$/)
  category?: string;

  @IsOptional()
  @IsBoolean()
  safety?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GuideCaseExpectationsDto)
  expectations?: GuideCaseExpectationsDto;
}

class GuideCaseInputDto {
  @IsUUID()
  trackId!: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  progress?: number;

  @IsOptional()
  @IsIn(['NORMAL', 'CARE', 'CRISIS_FOLLOWUP'])
  mode?: 'NORMAL' | 'CARE' | 'CRISIS_FOLLOWUP';

  @IsOptional()
  @IsIn(['lead', 'walk', 'drive'])
  guidance?: 'lead' | 'walk' | 'drive';

  @IsOptional()
  @IsIn(['text', 'voice'])
  channel?: 'text' | 'voice';

  @IsOptional()
  @IsBoolean()
  visitor?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GuidePlaygroundTurnDto)
  history?: GuidePlaygroundTurnDto[];

  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsBoolean()
  releaseWindowOpen?: boolean;

  @IsOptional()
  @IsBoolean()
  quizOpen?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  offSpineTurns?: number;
}

export class CreateEvalCaseDto {
  @ApiPropertyOptional({ enum: ['smoke', 'regression', 'red_team'] })
  @IsOptional()
  @IsIn(['smoke', 'regression', 'red_team'])
  suiteKey?: string;

  @IsString()
  @Matches(/^[a-z_]{2,40}$/)
  category!: string;

  @IsOptional()
  @IsBoolean()
  safety?: boolean;

  @IsString()
  @MaxLength(200)
  title!: string;

  @ValidateNested()
  @Type(() => GuideCaseInputDto)
  input!: GuideCaseInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => GuideCaseExpectationsDto)
  expectations?: GuideCaseExpectationsDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateEvalCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z_]{2,40}$/)
  category?: string;

  @IsOptional()
  @IsBoolean()
  safety?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GuideCaseExpectationsDto)
  expectations?: GuideCaseExpectationsDto;
}

export class StartEvalRunDto {
  @ApiProperty({
    enum: ['smoke', 'gate'],
    description:
      'smoke: the smoke suite once, for a draft (minutes). gate: every active case, three repetitions, against GA',
  })
  @IsIn(['smoke', 'gate'])
  kind!: 'smoke' | 'gate';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  repetitions?: number;

  @ApiPropertyOptional({
    description:
      'Cases the release is meant to fix: the gate then demands it passes more of them',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  targetCaseIds?: string[];
}

export class SubmitReviewDto {
  @ApiProperty({
    description: "Every rubric criterion's id → 'pass' | 'fail' | 'na'",
    example: { warmth: 'pass', safety: 'pass', specific_praise: 'na' },
  })
  @IsObject()
  labels!: Record<string, string>;

  @ApiProperty({ enum: ['ok', 'problem'] })
  @IsIn(['ok', 'problem'])
  verdict!: 'ok' | 'problem';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Also save this window as a regression case',
  })
  @IsOptional()
  @IsBoolean()
  saveAsCase?: boolean;
}

export class DismissReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class RunEvaluatorDto {
  @ApiPropertyOptional({
    description: 'The UTC day to judge (YYYY-MM-DD); default yesterday',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  night?: string;
}

export class GenerateRedTeamDto {
  @ApiPropertyOptional({
    description: 'The course to aim at; default the busiest in 30 days',
  })
  @IsOptional()
  @IsUUID()
  trackId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  perCategory?: number;
}
