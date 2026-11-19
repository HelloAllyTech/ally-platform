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
