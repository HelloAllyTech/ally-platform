import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** Ally admin: add credits to a builder (by user or account), or adjust them. */
export class GrantCreditsDto {
  @ApiPropertyOptional({
    description: 'The builder; their account is created if needed',
  })
  @IsOptional()
  @IsInt()
  userId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiProperty({
    example: 20,
    description: 'Dollars; negative only for an adjustment',
  })
  @IsNumber()
  amountUsd!: number;

  @ApiProperty({ enum: ['grant', 'adjustment'] })
  @IsIn(['grant', 'adjustment'])
  kind!: 'grant' | 'adjustment';

  @ApiProperty({ example: 'Pilot credits' })
  @IsString()
  @MaxLength(1000)
  note!: string;
}

/** Ally admin: move a chatbot's budget to another account. */
export class TransferBudgetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  toUserId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  toAccountId?: string;
}

/** Ally admin: the cutover grant (dry run first). */
export class CreditsCutoverDto {
  @ApiProperty({ default: true })
  @IsBoolean()
  dryRun!: boolean;
}

/** Builder: what to set aside for a chatbot's customers. */
export class SetBudgetDto {
  @ApiProperty({ example: 5 })
  @IsNumber()
  @Min(0)
  setAsideUsd!: number;
}

export class TopUpBudgetDto {
  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0.01)
  amountUsd!: number;
}

/** Builder: per-user dollar limits on a chatbot; null or absent = no limit. */
export class UserLimitsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyUsd?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weeklyUsd?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyUsd?: number | null;
}
