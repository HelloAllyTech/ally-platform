import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import {
  ROLEPLAY_DESIGN_MODES,
  RoleplayDesignMode,
} from 'src/learn/util/roleplay-design.util';
import { StructuredRoleplayBrief } from '../type/roleplay-brief.type';
import { RoleplayFitCheckSpecialist } from '../service/specialists/roleplay-fit-check.specialist';

export class AgentBuilderCharacterSuggestionsDto {
  @ApiProperty({ description: 'The wizard\'s "Describe roleplay actor" text' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  competencyIds?: string[];

  @ApiProperty({ enum: ROLEPLAY_DESIGN_MODES, required: false })
  @IsOptional()
  @IsIn(ROLEPLAY_DESIGN_MODES as unknown as string[])
  mode?: RoleplayDesignMode;
}

/**
 * Studio's Agent Builder wizard casting from the Character Library, with the same search and fit
 * check Course Copilot uses for its roleplays. Lives here because the library search and the
 * fit check do; served under the wizard's own `learn/agent-builder` path.
 */
@ApiTags('Agent Builder')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'learn/agent-builder', version: '1' })
export class AgentBuilderCharacterController {
  constructor(private readonly fitCheck: RoleplayFitCheckSpecialist) {}

  @ApiOperation({
    summary:
      'Agent Builder Copilot: library characters that could play this roleplay, with the fit ' +
      "check's recommendation (or none: write a new character)",
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('character-suggestions')
  async suggest(
    @Body() dto: AgentBuilderCharacterSuggestionsDto,
    @CurrentUser() user: TokenUser,
  ) {
    const brief: StructuredRoleplayBrief = {
      mode: dto.mode ?? 'practice',
      outcomes: [],
      competencies: [],
      behaviours: { helpful: [], unhelpful: [] },
      opportunities: [],
      condition: { difficulty: 'MEDIUM' },
      character: { personaBrief: dto.description.trim() },
      gate: {},
      lengthMinutes: 6,
    };
    const result = await this.fitCheck.suggest(brief, {
      // The retrieval log keys searches by session; a wizard call is its own.
      sessionId: randomUUID(),
      tenantId: user.tenantId ?? null,
      competencyIds: dto.competencyIds ?? [],
      usageMetadata: { agentBuilderCharacterSuggestions: true },
    });
    return {
      characters: result.characters.map((c) => ({
        id: c.id,
        name: c.name,
        summary: c.summary,
        hasVoices: c.hasVoices,
        profileExcerpt: c.profileText.slice(0, 280),
      })),
      recommendedId: result.recommendedId,
      reason: result.reason,
      searchFailed: result.searchFailed,
    };
  }
}
