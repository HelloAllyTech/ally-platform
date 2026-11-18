import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AudioChatPlatform } from '../../common/constants/chat.constants';

export class StartSegmentedRecordingDto {
  @ApiProperty({ enum: AudioChatPlatform })
  @IsEnum(AudioChatPlatform)
  platform!: AudioChatPlatform;

  @ApiProperty({
    enum: ['webm', 'm4a', 'wav'],
    description: 'Format each segment is recorded in',
  })
  @IsIn(['webm', 'm4a', 'wav'])
  format!: 'webm' | 'm4a' | 'wav';
}

export class SegmentUploadUrlDto {
  @ApiProperty({ example: 'audio/webm' })
  @IsString()
  @IsNotEmpty()
  contentType!: string;
}

export class FinalizeSegmentedRecordingDto {
  @ApiProperty({
    description: 'How many segments the client recorded (indexes 0..n-1)',
  })
  @IsInt()
  @Min(0)
  @Max(2880)
  segmentCount!: number;

  @ApiProperty({
    required: false,
    description: 'Recorded length, excluding pauses',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  durationSeconds?: number;

  @ApiProperty({
    required: false,
    description:
      'Finish with the segments that arrived even if some are missing (flagged incomplete)',
  })
  @IsOptional()
  @IsBoolean()
  allowPartial?: boolean;
}
