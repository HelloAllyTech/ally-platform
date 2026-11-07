import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, ValidateIf } from 'class-validator';

export class UpdateQuizSettingsDto {
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

export class UpdateQuizSettingsResponseDto {
  @ApiProperty()
  trackItemId!: string;

  @ApiProperty({ type: Number, nullable: true })
  maxAttempts!: number | null;
}
