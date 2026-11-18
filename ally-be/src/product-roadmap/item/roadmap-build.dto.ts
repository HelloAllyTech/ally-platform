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

export class SetBuildModeDto {
  @ApiProperty({
    enum: ['builder_agent', 'outside'],
    description:
      'How the assigned builder builds it: with the Builder agent here, or outside it (Claude Code, by hand).',
  })
  @IsIn(['builder_agent', 'outside'])
  mode!: 'builder_agent' | 'outside';
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
