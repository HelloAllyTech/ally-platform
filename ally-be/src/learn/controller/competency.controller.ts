import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiSecurity,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { AUTHZ_MESSAGES } from 'src/exception/failure-messages';
import { ErrorCode } from 'src/exception/error-code.enum';
import { CompetencyService } from '../service/competency.service';
import {
  CreateCompetencyDto,
  CreateCompetencyResponseDto,
  CompetencyResponseDto,
  UpdateCompetencyDto,
} from '../dto/competency.dto';
import { GetCompetenciesResponseDto } from '../dto/competency.dto';
import {
  CompetencyBehavioursResponseDto,
  SetCompetencyBehavioursDto,
} from '../dto/competency-behavior.dto';
import { CompetencySortBy } from '../enum/competency.enum';
import { SortOrder } from 'src/common/type/common.type';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';

@ApiTags('Competencies')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/competencies',
  version: '1',
})
/**
 * Who may do what with competencies:
 *
 * - Reading the list and a competency's behaviours is part of authoring: the
 *   roleplay builder's (mandatory) competency picker and the course editor's
 *   competency field both read it. So EDIT_SCENARIO alone — held only by
 *   platform-tier admins — opens it, not the Competencies toggle. Gating it on
 *   the toggle left every admin without it unable to pick a competency at all.
 * - The SHARED library (non-custom competencies, and clusters — see
 *   CompetencyClusterController) is managed by holders of the Competencies
 *   toggle, exactly as the Competencies tab is.
 * - A CUSTOM competency is the private copy a roleplay's scoring rubric forks
 *   when its rows are edited; it is part of authoring that roleplay, so
 *   EDIT_SCENARIO covers it. CompetencyService still limits renaming and
 *   deleting one to its owner.
 */
export class CompetencyController {
  constructor(
    private readonly competencyService: CompetencyService,
    private readonly featureToggleService: FeatureToggleService,
  ) {}

  /**
   * Refuse a change to the shared library from an admin without the
   * Competencies toggle — the same refusal FeatureToggleGuard gives, so a
   * client handles both alike. `competencyId` names the competency being
   * changed; omit it for a create, whose `isCustom` the caller checks.
   */
  private async assertMayManageShared(
    userId: number,
    competencyId?: string,
  ): Promise<void> {
    if (competencyId) {
      const competency = await this.competencyService
        .getCompetency(competencyId)
        .catch(() => null);
      // Missing: let the handler's own lookup answer 404.
      if (!competency || competency.isCustom) return;
    }
    if (
      await this.featureToggleService.hasToggle(
        userId,
        FeatureToggleKey.COMPETENCIES,
      )
    ) {
      return;
    }
    throw new ForbiddenException({
      message: AUTHZ_MESSAGES.missingFeature(FeatureToggleKey.COMPETENCIES),
      error: 'Forbidden',
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: ErrorCode.FEATURE_NOT_ENABLED,
      featureKey: FeatureToggleKey.COMPETENCIES,
    });
  }

  @ApiOperation({ summary: 'Get all competencies' })
  @ApiResponse({
    status: 200,
    description: 'List of competencies retrieved successfully',
    type: GetCompetenciesResponseDto,
  })
  @ApiQuery({
    name: 'name',
    required: false,
    type: String,
    description: 'Filter by name',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of records to skip',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of records to return',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: CompetencySortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @ApiQuery({
    name: 'includeOwnCustom',
    required: false,
    type: Boolean,
    description:
      "Include the requester's own custom competencies alongside the global " +
      'ones (defaults to false — custom competencies are otherwise hidden).',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Get()
  async getAllCompetencies(
    @CurrentUser() tokenUser: TokenUser,
    @Query('name') name?: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy: CompetencySortBy = CompetencySortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
    @Query('includeOwnCustom') includeOwnCustom?: string,
  ): Promise<GetCompetenciesResponseDto> {
    return this.competencyService.getCompetencies(
      name,
      {
        offset,
        limit,
        sortBy,
        order,
      },
      {
        includeOwnCustom: includeOwnCustom === 'true',
        userId: tokenUser.id,
      },
    );
  }

  @ApiOperation({ summary: 'Create a new competency' })
  @ApiResponse({
    status: 201,
    description: 'Competency created successfully',
    type: CreateCompetencyResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post()
  async createCompetency(
    @CurrentUser() tokenUser: TokenUser,
    @Body() createCompetencyDto: CreateCompetencyDto,
  ): Promise<CreateCompetencyResponseDto> {
    if (!createCompetencyDto.isCustom) {
      await this.assertMayManageShared(tokenUser.id);
    }
    return this.competencyService.createCompetency(
      createCompetencyDto,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Update a competency' })
  @ApiResponse({
    status: 200,
    description: 'Competency updated successfully',
    type: CompetencyResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Put(':id')
  async updateCompetency(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
    @Body() updateCompetencyDto: UpdateCompetencyDto,
  ): Promise<CompetencyResponseDto> {
    await this.assertMayManageShared(tokenUser.id, id);
    return this.competencyService.updateCompetency(
      id,
      updateCompetencyDto,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Delete a competency' })
  @ApiResponse({
    status: 200,
    description: 'Competency deleted successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Delete(':id')
  async deleteCompetency(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.assertMayManageShared(tokenUser.id, id);
    return this.competencyService.deleteCompetency(id, tokenUser.id);
  }

  @ApiOperation({
    summary: 'Get the helpful/unhelpful behaviours for a competency',
  })
  @ApiResponse({
    status: 200,
    description: 'Competency behaviours retrieved successfully',
    type: CompetencyBehavioursResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Get(':id/behaviours')
  async getCompetencyBehaviours(
    @Param('id') id: string,
  ): Promise<CompetencyBehavioursResponseDto> {
    return this.competencyService.getCompetencyBehaviours(id);
  }

  @ApiOperation({
    summary: 'Set the helpful/unhelpful behaviours for a competency',
  })
  @ApiResponse({
    status: 200,
    description: 'Competency behaviours updated successfully',
    type: CompetencyBehavioursResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Put(':id/behaviours')
  async setCompetencyBehaviours(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
    @Body() dto: SetCompetencyBehavioursDto,
  ): Promise<CompetencyBehavioursResponseDto> {
    await this.assertMayManageShared(tokenUser.id, id);
    return this.competencyService.setCompetencyBehaviours(id, dto);
  }
}
