import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { MAX_KNOWLEDGE_SOURCES_COUNT } from '../constants/scenario.constants';
import { KnowledgeSourceDto } from './knowledge-source.dto';

export class MapScenarioMemoriesDto {
  @ApiProperty({
    description:
      "The simulation's Knowledge Sources, as currently in the form.",
    type: [KnowledgeSourceDto],
  })
  @IsArray()
  @ArrayMaxSize(MAX_KNOWLEDGE_SOURCES_COUNT)
  @ValidateNested({ each: true })
  @Type(() => KnowledgeSourceDto)
  knowledgeSources!: KnowledgeSourceDto[];

  @ApiProperty({
    description: 'The simulation states, in order: {id, name, guidelines}.',
    required: false,
  })
  @IsOptional()
  @IsArray()
  states?: { id?: string; name?: string; guidelines?: unknown }[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  characterProfileText?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  roleInstructions?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;
}

export class StageDirectorBulkSwitchDto {
  @ApiProperty({
    description:
      'Only these simulations. Omit to consider every one on Main Agent Prompt #3.',
    required: false,
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  scenarioIds?: number[];

  @ApiProperty({
    description:
      'Report what would be switched and write nothing. Defaults to true.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiProperty({
    description:
      'Skip simulations with fewer than two states. Defaults to true.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  onlyWithStates?: boolean;
}
