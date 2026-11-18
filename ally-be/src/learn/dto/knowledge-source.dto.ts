import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class KnowledgeSourceDto {
  @ApiProperty({
    description: 'Knowledge source ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({
    description: 'Title of the knowledge source',
    example: 'Knowledge source 1',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Knowledge source content',
    example: 'Knowledge source content',
  })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiProperty({
    description:
      'Id of the scenario state from which the client may talk about this ' +
      'memory. Until the session reaches that state (or any later one) the ' +
      'content is withheld from the agent and only the title is shown to it, ' +
      'as a topic the client is not ready to discuss. Unset or null means ' +
      'always available. Must name one of the scenario `states`.',
    example: 'state-2',
    required: false,
    nullable: true,
  })
  @IsString()
  @IsOptional()
  unlocksFromStateId?: string | null;
}

/**
 * A Stage Director memory. Same shape as a Knowledge Source, plus the states
 * the author picked for it: the memory is available once the session has been
 * in ANY of them. An empty list means available from the start. When the list
 * is absent the older single `unlocksFromStateId` (that state or any later
 * one) still applies.
 */
export class MemoryDto extends KnowledgeSourceDto {
  @ApiProperty({
    description:
      'Ids of the scenario states at which the client may talk about this ' +
      'memory. It becomes available once the session has been in any of ' +
      'them and stays available. Empty means available from the start. Each ' +
      'must name one of the scenario `states`.',
    example: ['state-2', 'state-4'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  unlocksInStateIds?: string[];
}
