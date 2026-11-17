import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PM_SETTINGS_LIMITS } from '../constants/pm-agent.constants';
import {
  PmAcceptPath,
  PmCardKind,
  PmCardStatus,
  PmRejectReasonChip,
} from '../enum/pm-agent.enum';

// ── requests ────────────────────────────────────────────────────────────────

const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : value;

export class ListCardsQueryDto {
  @ApiPropertyOptional({
    description:
      'Comma-separated statuses. Default: the review queue (open + needs-you).',
    example: 'open,needs_attention',
  })
  @IsOptional()
  @Transform(csv)
  @IsEnum(PmCardStatus, { each: true })
  status?: PmCardStatus[];

  @ApiPropertyOptional({ enum: PmCardKind })
  @IsOptional()
  @IsEnum(PmCardKind)
  kind?: PmCardKind;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class LimitQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class AcceptCardDto {
  @ApiProperty({ enum: PmAcceptPath })
  @IsEnum(PmAcceptPath)
  path!: PmAcceptPath;

  @ApiPropertyOptional({
    description:
      'The card version hash the admin read. When sent, a mismatch answers 409 (the card changed).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  versionHash?: string;
}

export class RejectCardDto {
  @ApiPropertyOptional({ maxLength: PM_SETTINGS_LIMITS.REASON_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(PM_SETTINGS_LIMITS.REASON_MAX)
  reason?: string;

  @ApiPropertyOptional({ enum: PmRejectReasonChip })
  @IsOptional()
  @IsEnum(PmRejectReasonChip)
  reasonChip?: PmRejectReasonChip;
}

export class FeedbackCardDto {
  @ApiProperty({ maxLength: PM_SETTINGS_LIMITS.FEEDBACK_TEXT_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(PM_SETTINGS_LIMITS.FEEDBACK_TEXT_MAX)
  text!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['smaller_scope', 'needs_more_evidence'],
  })
  @IsOptional()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  chips?: string[];

  @ApiPropertyOptional({
    description: 'Run the revision now (budget permitting).',
  })
  @IsOptional()
  @IsBoolean()
  reviseNow?: boolean;
}

export class AnswerCardDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  optionIndex?: number;

  @ApiPropertyOptional({ maxLength: PM_SETTINGS_LIMITS.CUSTOM_ANSWER_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PM_SETTINGS_LIMITS.CUSTOM_ANSWER_MAX)
  customText?: string;
}

export class UpdatePmAgentSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  monthlyBudgetUsd?: number;

  @ApiPropertyOptional({
    minimum: PM_SETTINGS_LIMITS.QUEUE_CAP_MIN,
    maximum: PM_SETTINGS_LIMITS.QUEUE_CAP_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(PM_SETTINGS_LIMITS.QUEUE_CAP_MIN)
  @Max(PM_SETTINGS_LIMITS.QUEUE_CAP_MAX)
  queueCap?: number;

  @ApiPropertyOptional({
    minimum: PM_SETTINGS_LIMITS.RUN_HOUR_MIN,
    maximum: PM_SETTINGS_LIMITS.RUN_HOUR_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(PM_SETTINGS_LIMITS.RUN_HOUR_MIN)
  @Max(PM_SETTINGS_LIMITS.RUN_HOUR_MAX)
  runHourIst?: number;

  @ApiPropertyOptional({ maxLength: PM_SETTINGS_LIMITS.MANDATE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(PM_SETTINGS_LIMITS.MANDATE_MAX)
  mandate?: string;

  @ApiPropertyOptional({
    description:
      'Stops STARTING builds; cards are still generated. The circuit breaker is separate: resume it with autoBuildPaused=false.',
  })
  @IsOptional()
  @IsBoolean()
  pauseAutoBuild?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  slackNotify?: boolean;

  @ApiPropertyOptional({
    description: 'category → weight (0–10). null resets to equal weights.',
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  categoryWeights?: Record<string, number> | null;

  @ApiPropertyOptional({
    description:
      'false resumes auto-build after the circuit breaker paused it. true is refused (only the breaker sets it).',
  })
  @IsOptional()
  @IsBoolean()
  autoBuildPaused?: boolean;
}

export class UpdateMemoryDto {
  @ApiPropertyOptional({ maxLength: PM_SETTINGS_LIMITS.MEMORY_VALUE_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PM_SETTINGS_LIMITS.MEMORY_VALUE_MAX)
  value?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// ── responses (shapes are the contract in docs/pm-agent.md) ──────────────────

export interface PmNeedsYou {
  reason: string;
  actions: ('retry' | 'open_pr' | 'dismiss')[];
}

export interface PmDeliveryPr {
  url: string;
  state: string | null;
  ciStatus: string | null;
  merged: boolean;
  releaseState: string | null;
  releaseTag: string | null;
}

export interface PmDelivery {
  status: string | null;
  prs: PmDeliveryPr[];
  costUsd: number | null;
}

export interface PmCardResponse {
  id: string;
  kind: PmCardKind;
  category: string;
  status: PmCardStatus;
  version: number;
  versionHash: string;
  title: string;
  payload: Record<string, any>;
  rank: number;
  evidenceFreshness: string | null;
  createdAt: string;
  decidedAt?: string | null;
  decidedBy?: number | null;
  undoUntil?: string | null;
  needsYou?: PmNeedsYou;
  delivery?: PmDelivery;
  revisedFromCardId?: string | null;
  reasonChip?: string | null;
  reason?: string | null;
}

export interface PmEvidenceResponse {
  id: string;
  source: string;
  kind: string;
  label: string;
  query: Record<string, unknown> | null;
  snapshot: unknown;
  url: string | null;
  fetchedAt: string;
}

export interface PmCardEventResponse {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  cardVersion: number;
  actorUserId: number | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface PmCardDetailResponse extends PmCardResponse {
  evidence: PmEvidenceResponse[];
  events: PmCardEventResponse[];
}

export interface PmSettingsResponse {
  enabled: boolean;
  monthlyBudgetUsd: number;
  queueCap: number;
  runHourIst: number;
  mandate: string;
  pauseAutoBuild: boolean;
  slackNotify: boolean;
  categoryWeights: Record<string, number> | null;
  autoBuildPaused: boolean;
  autoBuildPausedReason: string | null;
  autoBuildPausedAt: string | null;
  updatedAt: string;
}

export interface PmRunResponse {
  id: string;
  status: string;
  trigger: string;
  runDate: string;
  stopReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  reservedUsd: number;
  spentUsd: number;
  cardsCreated: number;
  error: string | null;
}

export interface PmStateResponse {
  agentState: string;
  stopReason?: string;
  settings: PmSettingsResponse;
  budget: { monthlyBudgetUsd: number; spentUsd: number; reservedUsd: number };
  queue: { open: number; cap: number; needsYou: number };
  lastRun?: PmRunResponse;
  nextRunAt?: string;
  autoBuildPaused: boolean;
}

export interface PmMemoryResponse {
  id: string;
  kind: string;
  key: string;
  value: string;
  scope: string;
  source: string;
  sourceCardId: string | null;
  confidence: number | null;
  active: boolean;
  expiresAt: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PmHealthResponse {
  acceptRate7d: number | null;
  acceptRate30d: number | null;
  shippedRate: number | null;
  costPerAcceptedCardUsd: number | null;
  spendByLane: { lane: string; costUsd: number }[];
  repeatedRejectionRate: number | null;
}

export interface PmTrackingResponse {
  needsYou: PmCardResponse[];
  inProgress: PmCardResponse[];
  shipped: PmCardResponse[];
  other: PmCardResponse[];
}

export interface PmRunNowResponse {
  runId: string | null;
  started: boolean;
  reason?: string;
}
