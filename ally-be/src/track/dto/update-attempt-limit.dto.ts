import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, ValidateIf } from 'class-validator';

/**
 * Raises the attempt limit of a component that has one (quiz, annotation) on
 * a published course. The same body serves both; the item's type decides
 * where the limit lives.
 */
export class UpdateAttemptLimitDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The new total attempt limit. Must be higher than the current limit; null means unlimited.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  maxAttempts!: number | null;
}

export class UpdateAttemptLimitResponseDto {
  @ApiProperty()
  trackItemId!: string;

  @ApiProperty({ type: Number, nullable: true })
  maxAttempts!: number | null;
}
