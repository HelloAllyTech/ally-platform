import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Context attached by "Ask about this" (contract GuideAnchor). */
export class GuideAnchorDto {
  @IsString()
  itemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  quote?: string | null;

  @IsOptional()
  @IsNumber()
  timestampSec?: number | null;

  @IsOptional()
  @IsString()
  storyQuoteId?: string | null;
}

/** POST /v1/guide/threads/:id/turns (contract GuideTurnRequest). */
export class GuideTurnRequestDto {
  @ApiProperty({
    description: 'Client-generated id; a resend returns the same turn.',
  })
  @IsString()
  @MaxLength(64)
  clientTurnId!: string;

  @ApiProperty()
  @IsString()
  // Length is checked in the service so the 400 carries GUIDE_MESSAGE_TOO_LONG.
  text!: string;

  @ApiPropertyOptional({ type: GuideAnchorDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GuideAnchorDto)
  anchor?: GuideAnchorDto;

  @ApiPropertyOptional({
    enum: ['start', 'continue', 'locked_peek', 'not_now'],
  })
  @IsOptional()
  @IsIn(['start', 'continue', 'locked_peek', 'not_now'])
  intent?: 'start' | 'continue' | 'locked_peek' | 'not_now' | null;
}

/** PUT /v1/guide/admin/settings — any subset of the kill switches. */
export class UpdateGuideSwitchesDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() anonymousChat?: boolean;
  @IsOptional() @IsBoolean() voice?: boolean;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  disabledCapabilities?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) disabledTenants?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) disabledCourses?: string[];
}

export class GuideRollbackDto {
  @ApiProperty({
    description: 'A safety rollback moves every thread at its next turn.',
  })
  @IsBoolean()
  emergency!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** POST /v1/guide/threads/:id/cards/:cardId/events (contract GuideCardEventRequest). */
export class GuideCardEventDto {
  @ApiProperty({
    enum: [
      'opened',
      'closed',
      'completed_claim',
      'dismissed',
      'launched',
      'returned',
      'reopened',
    ],
  })
  @IsIn([
    'opened',
    'closed',
    'completed_claim',
    'dismissed',
    'launched',
    'returned',
    'reopened',
  ])
  type!:
    | 'opened'
    | 'closed'
    | 'completed_claim'
    | 'dismissed'
    | 'launched'
    | 'returned'
    | 'reopened';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scenarioSessionId?: string | null;

  @ApiPropertyOptional({ enum: ['completed', 'aborted'] })
  @IsOptional()
  @IsIn(['completed', 'aborted'])
  outcome?: 'completed' | 'aborted' | null;
}

/** PUT /v1/guide/prefs (contract GuidePrefsUpdate). */
export class GuidePrefsUpdateDto {
  @ApiPropertyOptional({ enum: ['lead', 'walk', 'drive'] })
  @IsOptional()
  @IsIn(['lead', 'walk', 'drive'])
  guidance?: 'lead' | 'walk' | 'drive';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  voiceEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sideQuests?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  memoryEnabled?: boolean;

  @ApiPropertyOptional({ enum: ['off', 'in_app', 'in_app_email'] })
  @IsOptional()
  @IsIn(['off', 'in_app', 'in_app_email'])
  outreach?: 'off' | 'in_app' | 'in_app_email';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  preferClassic?: boolean;
}

/** PUT …/crisis-responses: fixed crisis copy for one language. */
export class GuideCrisisResponseDto {
  @ApiProperty({ enum: ['en', 'hi', 'mr', 'ta', 'kn'] })
  @IsIn(['en', 'hi', 'mr', 'ta', 'kn'])
  languageCode!: string;

  @ApiProperty({
    description: 'Clinically approved text, 40–1,500 characters.',
  })
  @IsString()
  @MaxLength(1500)
  body!: string;
}

/** PUT /v1/guide/threads/:id/appointment. */
export class GuideAppointmentDto {
  @ApiProperty({ description: 'ISO date-time of the reminder.' })
  @IsString()
  @MaxLength(40)
  at!: string;

  @ApiProperty({ description: 'IANA time zone, e.g. Asia/Kolkata.' })
  @IsString()
  @MaxLength(64)
  timezone!: string;
}
