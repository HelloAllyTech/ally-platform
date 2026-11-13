import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { SessionBookmarkSource } from '../entity/session-bookmark.entity';

export class CreateSessionBookmarkDto {
  @ApiProperty({ description: 'The roleplay session to save' })
  @IsUUID()
  sessionId!: string;

  @ApiPropertyOptional({ description: 'A note to yourself', maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;

  @ApiPropertyOptional({ enum: ['web', 'mobile'], default: 'web' })
  @IsOptional()
  @IsIn(['web', 'mobile'])
  source?: SessionBookmarkSource;
}

export class SessionBookmarkDto {
  @ApiProperty() id!: string;
  @ApiProperty() sessionId!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() createdAt!: string;
}
