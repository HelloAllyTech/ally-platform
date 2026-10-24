import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { GUIDE_NOTES_MAX_CHARS } from '../type/track-guide-notes.type';

/**
 * `PUT v1/learn/admin/tracks/:id/guide-notes` — replaces the course's Ally
 * notes whole. Omitting `tension` clears every per-item override.
 */
export class UpdateTrackGuideNotesDto {
  @ApiPropertyOptional({
    description: `What the trainer tells Ally about this course (≤ ${GUIDE_NOTES_MAX_CHARS} characters). Never a quiz answer.`,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(GUIDE_NOTES_MAX_CHARS)
  notes?: string | null;

  @ApiPropertyOptional({
    description:
      'Item id → low | medium | high, overriding the default pacing tension',
    type: 'object',
    additionalProperties: { type: 'string', enum: ['low', 'medium', 'high'] },
  })
  @IsOptional()
  @IsObject()
  tension?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'True when the notes are a Course Copilot draft the trainer saved unedited',
  })
  @IsOptional()
  @IsBoolean()
  draftedByCopilot?: boolean;
}
