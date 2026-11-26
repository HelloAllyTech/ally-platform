import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MANUAL_CHAT_LIMITS } from '../constants/manual-agent.constants';

export class ManualChatContextDto {
  @ApiPropertyOptional({ description: 'The page the reader has open' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  pageSlug?: string;

  @ApiPropertyOptional({ description: 'Text the reader selected on that page' })
  @IsOptional()
  @IsString()
  @MaxLength(MANUAL_CHAT_LIMITS.SELECTION_MAX)
  selection?: string;
}

export class ManualChatStreamDto {
  @ApiPropertyOptional({ description: 'Omit to start a new conversation' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ maxLength: MANUAL_CHAT_LIMITS.MESSAGE_MAX })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MANUAL_CHAT_LIMITS.MESSAGE_MAX)
  message!: string;

  @ApiPropertyOptional({ type: ManualChatContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ManualChatContextDto)
  context?: ManualChatContextDto;
}

export class SaveManualDraftDto {
  @IsUUID()
  conversationId!: string;

  @IsUUID()
  draftId!: string;

  @ApiPropertyOptional({
    description: 'The edited text; the card text when omitted',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MANUAL_CHAT_LIMITS.DRAFT_TEXT_MAX)
  text?: string;

  @ApiPropertyOptional({
    description: 'The edited title; the card title when omitted',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MANUAL_CHAT_LIMITS.DRAFT_TITLE_MAX)
  title?: string;
}

export class DismissManualDraftDto {
  @IsUUID()
  conversationId!: string;

  @IsUUID()
  draftId!: string;
}

export class CreateManualAgentKeyDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;
}
