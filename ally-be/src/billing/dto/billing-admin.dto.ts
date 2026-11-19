import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  BillingModelType,
  BillingStatus,
  PriceUnit,
  WhatsAppRateCategory,
} from '../enum/billing.enum';

/** Every CR1 admin change says why. */
export class NoteDto {
  @ApiProperty({ example: 'OpenAI cut the price on 1 Dec' })
  @IsString()
  @MaxLength(1000)
  note!: string;
}

export class PriceDto extends NoteDto {
  @ApiPropertyOptional({
    example: 0.4,
    description: 'USD per million input tokens',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  inputPerMillionUsd?: number | null;

  @ApiPropertyOptional({ example: 0.1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cachedInputPerMillionUsd?: number | null;

  @ApiPropertyOptional({ example: 1.6 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  outputPerMillionUsd?: number | null;

  @ApiPropertyOptional({
    example: 0.006,
    description: 'USD per unit (minute, page, million characters)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPriceUsd?: number | null;

  @ApiPropertyOptional({ enum: PriceUnit })
  @IsOptional()
  @IsEnum(PriceUnit)
  unit?: PriceUnit | null;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Defaults to today',
  })
  @IsOptional()
  @IsString()
  effectiveFrom?: string;
}

export class AddModelDto extends PriceDto {
  @ApiProperty({ example: 'openai' })
  @IsString()
  @MaxLength(40)
  provider!: string;

  @ApiProperty({ example: 'gpt-6-luna' })
  @IsString()
  @MaxLength(200)
  model!: string;

  @ApiPropertyOptional({ example: 'GPT-6 Luna' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiProperty({ enum: BillingModelType })
  @IsEnum(BillingModelType)
  type!: BillingModelType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class EditModelDto extends NoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ enum: BillingModelType })
  @IsOptional()
  @IsEnum(BillingModelType)
  type?: BillingModelType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class ModelStatusDto extends NoteDto {
  @ApiProperty({ enum: BillingStatus })
  @IsEnum(BillingStatus)
  status!: BillingStatus;
}

export class WhatsAppRateDto extends NoteDto {
  @ApiProperty({ example: 'IN' })
  @IsString()
  @MaxLength(2)
  country!: string;

  @ApiProperty({ enum: WhatsAppRateCategory })
  @IsEnum(WhatsAppRateCategory)
  category!: WhatsAppRateCategory;

  @ApiProperty({ example: 0.0118 })
  @IsNumber()
  @Min(0)
  priceUsd!: number;

  @ApiPropertyOptional({ example: '2027-01-01' })
  @IsOptional()
  @IsString()
  effectiveFrom?: string;
}

export class CostSettingsDto extends NoteDto {
  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyBudgetUsd?: number;

  @ApiPropertyOptional({ example: 0.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  conversationAlertUsd?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  spikeMultiplier?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  spikeMinUsd?: number;
}

export class FixedCostDto extends NoteDto {
  @ApiProperty({ example: '2026-11' })
  @IsString()
  month!: string;

  @ApiProperty({ example: 'Hetzner servers' })
  @IsString()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ example: 180 })
  @IsNumber()
  @Min(0)
  amountUsd!: number;
}

export const COST_DIMENSIONS = [
  'publisher',
  'assistant',
  'kind',
  'model',
  'channel',
] as const;

export class BreakdownQueryDto {
  @ApiProperty({ enum: COST_DIMENSIONS })
  @IsIn(COST_DIMENSIONS as unknown as string[])
  by!: (typeof COST_DIMENSIONS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  to?: string;
}

export class TokenGrantDto extends NoteDto {
  @ApiProperty({ example: 2_000_000 })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({
    description: 'Resets to this amount on the same day each month',
  })
  @IsOptional()
  renewMonthly?: boolean;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsString()
  expiresAt?: string | null;
}

export class TokenGrantUpdateDto extends NoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  renewMonthly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expiresAt?: string | null;
}

export class UnlimitedDto extends NoteDto {
  @ApiProperty()
  unlimited!: boolean;
}

export class PlanDto extends NoteDto {
  @ApiPropertyOptional({ example: 'pro', description: 'Set on create only' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  key?: string;

  @ApiProperty({ example: 'Pro' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: 'Empty: unlimited' })
  @IsOptional()
  maxPublished!: number | null;

  @ApiProperty({ example: 5 })
  @IsNumber()
  @Min(0)
  includedSeats!: number;

  @ApiPropertyOptional({ example: 'basic' })
  @IsOptional()
  @IsString()
  includedSeatTypeKey?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  customerConversations!: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  ownerRuns!: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  seatsRequired?: boolean;

  @ApiPropertyOptional({ description: 'USD per month, for Costs only' })
  @IsOptional()
  priceUsd?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  active?: boolean;
}

export class SeatTypeDto extends NoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  key?: string;

  @ApiProperty({ example: 'Premium' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: 'Empty: unlimited' })
  @IsOptional()
  messagesPerMonth!: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  rank?: number;

  @ApiPropertyOptional({
    description: 'USD per seat per month, for Costs only',
  })
  @IsOptional()
  priceUsd?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  active?: boolean;
}

export class SubscriptionDto extends NoteDto {
  @ApiProperty({ example: 'pro' })
  @IsString()
  planKey!: string;

  @ApiPropertyOptional({ example: '2026-11-19' })
  @IsOptional()
  @IsString()
  periodStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  periodEnd?: string | null;

  @ApiPropertyOptional({ enum: ['active', 'past_due', 'cancelled'] })
  @IsOptional()
  @IsString()
  status?: 'active' | 'past_due' | 'cancelled';
}

export class AddSeatsDto extends NoteDto {
  @ApiProperty({ example: 'premium' })
  @IsString()
  seatTypeKey!: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(1)
  count!: number;

  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @IsString()
  startDate?: string;
}

export class SeatTypeChangeDto extends NoteDto {
  @ApiProperty({ example: 'premium' })
  @IsString()
  seatTypeKey!: string;
}

export class AssignSeatDto {
  @ApiPropertyOptional({
    example: 'person@example.com',
    description: 'Null frees the seat',
  })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email!: string | null;
}
