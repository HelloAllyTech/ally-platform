import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateRoleplayInterviewSessionDto {
  @ApiPropertyOptional({
    description:
      'The saved roleplay this chat is for; omit for a roleplay not yet saved',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  scenarioId?: number;
}

export class RoleplayInterviewAnswerDto {
  @ApiPropertyOptional({ type: [String], description: 'Picked option ids' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  optionIds?: string[];

  @ApiPropertyOptional({ description: "The trainer's own typed answer" })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;
}

export class RoleplayInterviewMessageDto {
  @ApiPropertyOptional({ description: "The trainer's message" })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  text?: string;

  @ApiPropertyOptional({ description: 'The question card being answered' })
  @IsOptional()
  @IsUUID()
  questionId?: string;

  @ApiPropertyOptional({ type: RoleplayInterviewAnswerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RoleplayInterviewAnswerDto)
  answer?: RoleplayInterviewAnswerDto;
}

export class ApproveRoleplayInterviewPlanDto {
  @ApiProperty({ description: 'The plan version the trainer approved' })
  @IsInt()
  @Min(1)
  planVersion!: number;
}

export class LinkRoleplayInterviewScenarioDto {
  @ApiProperty({ description: 'The saved roleplay' })
  @IsInt()
  @IsPositive()
  scenarioId!: number;
}
