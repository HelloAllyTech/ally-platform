import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt } from 'class-validator';

/** Ids may arrive as numbers or numeric strings; user ids are integers here. */
const toIds = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v) => Number(v)) : value;

/**
 * The lists the Owner looked at and confirmed (§3.3). The run refuses with 409 unless they
 * equal who becomes Builder and Owner right now.
 */
export class RunRoadmapCutoverDto {
  @ApiProperty({ type: [Number], description: 'User ids shown as Builder' })
  @Transform(toIds)
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  confirmedBuilderIds!: number[];

  @ApiProperty({ type: [Number], description: 'User ids shown as Owner' })
  @Transform(toIds)
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  confirmedOwnerIds!: number[];
}
