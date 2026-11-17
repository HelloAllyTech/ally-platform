import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class RecordExternalBuildDto {
  @ApiPropertyOptional({
    enum: ['claude_code'],
    description: 'Where the brief went. Only Claude Code today (D18).',
  })
  @IsOptional()
  @IsIn(['claude_code'])
  tool?: 'claude_code';
}

export class SetRoadmapRoleDto {
  @ApiProperty({
    enum: ['none', 'idea', 'builder', 'owner'],
    description:
      'The Users screen radio. Writes product_roadmap, builder and product_roadmap_manage together.',
  })
  @IsIn(['none', 'idea', 'builder', 'owner'])
  role!: 'none' | 'idea' | 'builder' | 'owner';
}

export class SetRoadmapPreferencesDto {
  @ApiPropertyOptional({
    description: '"Your ideas this week" by email on Mondays. Off by default.',
  })
  @IsOptional()
  @IsBoolean()
  weeklyDigest?: boolean;
}
