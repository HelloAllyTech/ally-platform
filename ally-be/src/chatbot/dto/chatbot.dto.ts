import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
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
import {
  ChatbotAccessMode,
  ChatbotAnswerMode,
  ChatbotAudienceKind,
  ChatbotKnowledgeSource,
  ChatbotMemberRole,
  ChatbotStatus,
} from '../enum/chatbot.enum';
import { KB_MAX_PASTE_CHARS } from '../../knowledge-base/constants/knowledge-base.constants';
import { MAX_SYSTEM_PROMPT_CHARS } from '../type/chatbot.type';
import type { ChatbotSettingsOverride } from '../type/chatbot.type';

export class ChatbotPersonaDto {
  @ApiPropertyOptional({ description: 'The name the bot answers as' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({
    description:
      'Instructions for the bot. Grounding, format and safety rules still take precedence.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SYSTEM_PROMPT_CHARS)
  systemPrompt?: string;

  @ApiPropertyOptional({ example: 'warm and concise' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tone?: string;

  @ApiPropertyOptional({
    description: 'Sent before the first reply to a new person',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  greeting?: string;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  defaultLanguage?: string;
}

export class ChatbotModelDto {
  @ApiProperty({ example: 'openai' })
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @ApiProperty({ example: 'gpt-4.1-mini' })
  @IsString()
  @IsNotEmpty()
  model!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number | null;
}

export class CreateChatbotDto {
  @ApiProperty({ example: 'Policy helper' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ type: ChatbotPersonaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatbotPersonaDto)
  persona?: ChatbotPersonaDto;

  @ApiPropertyOptional({ enum: ChatbotAnswerMode })
  @IsOptional()
  @IsEnum(ChatbotAnswerMode)
  answerMode?: ChatbotAnswerMode;

  @ApiPropertyOptional({ enum: ChatbotAccessMode })
  @IsOptional()
  @IsEnum(ChatbotAccessMode)
  accessMode?: ChatbotAccessMode;
}

export class UpdateChatbotDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ type: ChatbotPersonaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatbotPersonaDto)
  persona?: ChatbotPersonaDto;

  @ApiPropertyOptional({ enum: ChatbotAnswerMode })
  @IsOptional()
  @IsEnum(ChatbotAnswerMode)
  answerMode?: ChatbotAnswerMode;

  @ApiPropertyOptional({ enum: ChatbotAccessMode })
  @IsOptional()
  @IsEnum(ChatbotAccessMode)
  accessMode?: ChatbotAccessMode;

  @ApiPropertyOptional({ enum: ChatbotKnowledgeSource })
  @IsOptional()
  @IsEnum(ChatbotKnowledgeSource)
  knowledgeSource?: ChatbotKnowledgeSource;

  @ApiPropertyOptional({
    type: ChatbotModelDto,
    nullable: true,
    description: 'Null returns the bot to the platform default model',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatbotModelDto)
  model?: ChatbotModelDto | null;
}

export class SetChatbotStatusDto {
  @ApiProperty({ enum: ChatbotStatus })
  @IsEnum(ChatbotStatus)
  status!: ChatbotStatus;
}

export class SetChatbotDocumentsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  documentIds!: string[];
}

export class ChatbotMemberInputDto {
  @ApiProperty()
  @IsInt()
  userId!: number;

  @ApiProperty({ enum: ChatbotMemberRole })
  @IsEnum(ChatbotMemberRole)
  role!: ChatbotMemberRole;
}

export class SetChatbotMembersDto {
  @ApiProperty({ type: [ChatbotMemberInputDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ChatbotMemberInputDto)
  members!: ChatbotMemberInputDto[];
}

export class ChatbotAudienceEntryDto {
  @ApiProperty({ enum: ChatbotAudienceKind })
  @IsEnum(ChatbotAudienceKind)
  kind!: ChatbotAudienceKind;

  @ApiProperty({
    description: 'User id, organisation id, phone number or email, by kind',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  value!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class AddChatbotAudienceDto {
  @ApiProperty({ type: [ChatbotAudienceEntryDto] })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ChatbotAudienceEntryDto)
  entries!: ChatbotAudienceEntryDto[];
}

export class UpdateChatbotSettingsDto {
  @ApiProperty({
    description:
      'Every field the bot changes; one left out follows the default. Safety and rate limits can only be made stricter.',
  })
  @IsObject()
  settings!: ChatbotSettingsOverride;
}

export class ChatbotHistoryTurnDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  content!: string;
}

/** Unsaved changes to try in the test console before saving them. */
export class ChatbotDraftDto {
  @ApiPropertyOptional({ type: ChatbotPersonaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatbotPersonaDto)
  persona?: ChatbotPersonaDto;

  @ApiPropertyOptional({ enum: ChatbotAnswerMode })
  @IsOptional()
  @IsEnum(ChatbotAnswerMode)
  answerMode?: ChatbotAnswerMode;

  @ApiPropertyOptional({ type: ChatbotModelDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatbotModelDto)
  model?: ChatbotModelDto | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  documentIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  settings?: ChatbotSettingsOverride;
}

export class TestChatbotDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message!: string;

  @ApiPropertyOptional({ type: [ChatbotHistoryTurnDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChatbotHistoryTurnDto)
  history?: ChatbotHistoryTurnDto[];

  @ApiPropertyOptional({ type: ChatbotDraftDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatbotDraftDto)
  draft?: ChatbotDraftDto;

  @ApiPropertyOptional({
    description:
      'Answer as if asked by someone in this organisation (bots that answer from the asker’s organisation)',
  })
  @IsOptional()
  @IsUUID()
  asTenantId?: string;

  @ApiPropertyOptional({
    description:
      'Also apply the "who can chat" check, as if you were the sender',
  })
  @IsOptional()
  @IsBoolean()
  checkAccess?: boolean;

  @ApiPropertyOptional({
    description:
      'The Preview thread (`preview-<uuid>`), kept until "New thread". A new one is made when absent.',
  })
  @IsOptional()
  @Matches(
    /^preview-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  )
  conversationId?: string;
}

export class BindConnectorDto {
  @ApiProperty({ description: 'The bot to bind to; null unbinds' })
  @IsOptional()
  @IsUUID()
  chatbotId!: string | null;
}

/** A rename, or new text, for one of a chatbot's own documents. */
export class UpdateChatbotDocumentDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({
    description:
      "The document's new text. Changing it trains the chatbot on it again.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(KB_MAX_PASTE_CHARS)
  text?: string;
}
