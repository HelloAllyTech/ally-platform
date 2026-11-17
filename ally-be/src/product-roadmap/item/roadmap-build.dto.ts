import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class RecordExternalBuildDto {
  @ApiPropertyOptional({
    enum: ['claude_code'],
    description: 'Where the brief went. Only Claude Code today (D18).',
  })
  @IsOptional()
  @IsIn(['claude_code'])
  tool?: 'claude_code';
}
