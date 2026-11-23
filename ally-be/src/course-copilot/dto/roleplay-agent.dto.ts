import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { COURSE_COPILOT_LIMITS } from '../constants/course-copilot.constants';
import { ROLEPLAY_MODES, RoleplayMode } from '../type/roleplay-brief.type';

export class StartRoleplayAgentRunDto {
  @ApiProperty({
    example: 'Government secondary-school teachers, new to mental health',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  learners!: string;

  @ApiProperty({
    example:
      'Ask a withdrawn student directly about suicide and walk them to the counsellor',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  goal!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsUUID('all', { each: true })
  competencyIds!: string[];

  @ApiProperty({ enum: ROLEPLAY_MODES })
  @IsIn(ROLEPLAY_MODES as unknown as string[])
  mode!: RoleplayMode;

  @ApiPropertyOptional({ enum: ['EASY', 'MEDIUM', 'HARD'] })
  @IsOptional()
  @IsIn(['EASY', 'MEDIUM', 'HARD'])
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';

  @ApiPropertyOptional({ description: 'Who the client is and how they behave' })
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  clientDescription?: string;

  @ApiPropertyOptional({ description: 'Reuse a Character Library character' })
  @IsOptional()
  @IsUUID()
  characterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  saveCharacter?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'languages.id values' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(COURSE_COPILOT_LIMITS.languagesPerRoleplay)
  @IsString({ each: true })
  languageIds?: string[];

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({ minimum: 2, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(30)
  lengthMinutes?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  triggerWarningIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(800)
  notes?: string;
}
