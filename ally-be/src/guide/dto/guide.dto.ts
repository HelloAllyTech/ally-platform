import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
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
  @IsIn(['start', 'continue', 'locked_peek', 'not_now', 'safe_now'])
  intent?: 'start' | 'continue' | 'locked_peek' | 'not_now' | 'safe_now' | null;
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

  @ApiPropertyOptional({
    enum: ['session', 'spaced_recall'],
    description:
      'session (the closing ritual, the default) or spaced_recall (the finale door: a short look back after the course).',
  })
  @IsOptional()
  @IsIn(['session', 'spaced_recall'])
  purpose?: 'session' | 'spaced_recall';
}

/** POST /v1/guide/voice/turns (contract GuideVoiceTurnRequest). */
export class GuideVoiceTurnDto {
  @ApiProperty({ description: 'The voice-session token from the dispatch.' })
  @IsString()
  @MaxLength(128)
  token!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  clientTurnId!: string;

  @ApiProperty({ description: 'What the learner said (final transcript).' })
  @IsString()
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  language?: string | null;

  @ApiPropertyOptional({
    description: 'The previous turn, when the learner spoke over its reply.',
  })
  @IsOptional()
  @IsString()
  interruptedTurnId?: string | null;

  @ApiPropertyOptional({ description: 'Characters of that reply they heard.' })
  @IsOptional()
  @IsNumber()
  spokenChars?: number | null;
}

/** POST /v1/guide/threads/:id/voice-session. */
export class GuideVoiceSessionDto {
  @ApiPropertyOptional({ enum: ['hands_free', 'push_to_talk'] })
  @IsOptional()
  @IsIn(['hands_free', 'push_to_talk'])
  turnMode?: 'hands_free' | 'push_to_talk';

  @ApiPropertyOptional({ enum: ['en', 'hi', 'mr', 'ta', 'kn'] })
  @IsOptional()
  @IsIn(['en', 'hi', 'mr', 'ta', 'kn'])
  language?: string;
}

/** POST /v1/guide/admin/baseline — capture a baseline snapshot now. */
export class GuideBaselineCaptureDto {
  @ApiPropertyOptional({
    description: 'Days of enrollments to measure, 7–365 (default 90).',
  })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  windowDays?: number;

  @ApiPropertyOptional({ description: 'Why this snapshot was taken.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /v1/guide/admin/releases/:id/canary — show it to a share of new epochs. */
export class GuideCanaryStartDto {
  @ApiProperty({
    description: 'Share of new conversations, 1–30 (plan default 20).',
  })
  @IsInt()
  @Min(1)
  @Max(30)
  percent!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class GuidePlaygroundTurnDto {
  @IsIn(['learner', 'ally'])
  role!: 'learner' | 'ally';

  @IsString()
  @MaxLength(4000)
  text!: string;
}

/** POST /v1/guide/admin/playground — one dry-run turn of any release. */
export class GuidePlaygroundRunDto {
  @ApiProperty({ description: 'Any release, a draft included.' })
  @IsUUID()
  releaseId!: string;

  @ApiProperty()
  @IsUUID()
  trackId!: string;

  @ApiPropertyOptional({
    description: 'An organisation whose Ally layer to use (default: none)',
  })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({
    description: 'Items the imagined learner has completed',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  progress?: number;

  @IsOptional()
  @IsIn(['NORMAL', 'CARE', 'CRISIS_FOLLOWUP'])
  mode?: 'NORMAL' | 'CARE' | 'CRISIS_FOLLOWUP';

  @IsOptional()
  @IsIn(['lead', 'walk', 'drive'])
  guidance?: 'lead' | 'walk' | 'drive';

  @IsOptional()
  @IsIn(['text', 'voice'])
  channel?: 'text' | 'voice';

  @ApiPropertyOptional({ description: 'Run as an anonymous visitor' })
  @IsOptional()
  @IsBoolean()
  visitor?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuidePlaygroundTurnDto)
  history?: GuidePlaygroundTurnDto[];

  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsIn(['start', 'continue', 'locked_peek', 'not_now', 'safe_now'])
  intent?: 'start' | 'continue' | 'locked_peek' | 'not_now' | 'safe_now';
}

class GuideMicroActivityAnswerDto {
  @IsString()
  @MaxLength(16)
  questionId!: string;

  @IsString()
  @MaxLength(16)
  optionId!: string;
}

/** POST /v1/guide/threads/:id/micro-activities/:cardId/responses (plan §9.1). */
export class GuideMicroActivityResponseDto {
  @ApiPropertyOptional({ description: 'For questions with options' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuideMicroActivityAnswerDto)
  answers?: GuideMicroActivityAnswerDto[];

  @ApiPropertyOptional({ description: 'For a written answer' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}

/** POST /v1/guide/messages/:messageId/feedback (plan §9.1). */
export class GuideMessageFeedbackDto {
  @ApiProperty({ enum: [1, -1] })
  @IsIn([1, -1])
  rating!: 1 | -1;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

/** POST /v1/guide/tracks/:trackId/advice (contract GuideAdviceLineRequest). */
export class GuideAdviceLineDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  text!: string;
}

/** POST /v1/guide/admin/advice/:adviceId/moderate (Ally Console). */
export class GuideAdviceModerationDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * A change to one organisation's or course's Ally config (plan §7.5).
 * `set` writes values (null is a value: "off"); `clear` hands keys back to
 * the layer below. Each key is checked against the policy schema.
 */
export class GuideConfigOverrideDto {
  @ApiPropertyOptional({
    description: 'Policy key → value, e.g. { "releaseWindowMaxTurns": 8 }',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  set?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clear?: string[];

  @ApiPropertyOptional({
    description:
      'The version you loaded; a save over a newer change is refused (409)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
