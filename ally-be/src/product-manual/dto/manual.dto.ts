import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  MANUAL_BUDGET_MAX_USD,
  MANUAL_BUDGET_MIN_USD,
  MANUAL_IMPORT_MAX_PAGES,
} from '../constants/manual.constants';

export class RevertPageDto {
  @IsUUID()
  revisionId!: string;
}

export class UpdateManualSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    minimum: MANUAL_BUDGET_MIN_USD,
    maximum: MANUAL_BUDGET_MAX_USD,
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(MANUAL_BUDGET_MIN_USD)
  @Max(MANUAL_BUDGET_MAX_USD)
  monthlyBudgetUsd?: number;
}

/**
 * Pages are validated one by one by the service so a bad page is reported in `errors` and does not
 * fail the whole batch; here only the envelope is checked.
 */
export class ImportPagesDto {
  @IsArray()
  @ArrayMaxSize(MANUAL_IMPORT_MAX_PAGES)
  pages!: Record<string, unknown>[];

  @ApiPropertyOptional({ enum: ['upsert'] })
  @IsOptional()
  @IsString()
  @IsIn(['upsert'])
  mode?: 'upsert';
}
