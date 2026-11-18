import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * ally-ai's Scribe v2 harness report for a chat (POST /chats/note-drafts).
 * `report` mirrors ally-ai's HarnessReport (app/core/note_harness/models.py).
 */
export class NoteDraftCallbackDto {
  @ApiProperty({ description: 'Chat ID' })
  @IsNumber()
  @IsNotEmpty()
  chatId!: number;

  @ApiProperty({ description: 'True while v2 runs beside v1 unseen' })
  @IsBoolean()
  @IsOptional()
  shadow?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  correlationId?: string;

  @ApiProperty({ description: 'The harness report', type: Object })
  @IsObject()
  report!: NoteHarnessReport;
}

export interface NoteHarnessReport {
  draft?: {
    narrative?: { t: string; text: string; turn_ids: number[] }[];
    fields?: Record<string, { value: unknown; evidence_turn_ids: number[] }>;
  } | null;
  budget?: {
    transcript_minutes?: number;
    transcript_words?: number;
    narrative_words?: number;
    [key: string]: unknown;
  } | null;
  mode?: string | null;
  path?: string | null;
  segments?: number;
  repaired?: boolean;
  validation?: Record<string, unknown>;
  llm_calls?: number;
  duration_ms?: number;
  error?: string | null;
}
