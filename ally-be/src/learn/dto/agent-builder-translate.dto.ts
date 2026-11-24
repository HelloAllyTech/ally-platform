import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class AgentBuilderTranslateTargetDto {
  @ApiProperty({ example: '2', description: 'languages.id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  languageId!: string;

  @ApiProperty({ example: 'hi-IN' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  languageCode!: string;
}

/** Agent Builder wizard: one generated field's text, into the roleplay's other languages. */
export class AgentBuilderTranslateDto {
  @ApiProperty({ description: 'The text to translate (the main language’s)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @ApiProperty({ type: [AgentBuilderTranslateTargetDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AgentBuilderTranslateTargetDto)
  targets!: AgentBuilderTranslateTargetDto[];
}
