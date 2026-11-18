import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { Tenant, TenantStatus } from '../entity/tenant.entity';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantStatusDto } from '../dto/update-tenant-status.dto';
import { UpdateTenantSettingsDto } from '../dto/update-tenant-settings.dto';
import { UpdateTenantMetadataDto } from '../dto/update-tenant-metadata.dto';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Put,
  Query,
  Patch,
  Delete,
  ForbiddenException,
} from '@nestjs/common';
import { TenantService } from '../service/tenant.service';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';
import { SortOrder } from 'src/user/enum/user.enum';
import { TenantSortBy } from '../enum/tenant.enum';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { GetAllTenantsResponseDto } from '../dto/get-tenants.dto';
import {
  LogoUploadRequestDto,
  OrganizationLogoUploadResponseDto,
} from '../dto/organization-logo-upload.dto';
import { UpdateTenantBrandingDto } from '../dto/update-tenant-branding.dto';
import { UpdateTenantBrandingResponseDto } from '../dto/tenant-branding-response.dto';
import {
  FaviconUploadRequestDto,
  FaviconUploadResponseDto,
} from '../dto/branding-favicon-upload.dto';

import { SuccessResponse } from 'src/common/type/common.type';
import { DeleteLogoDto } from '../dto/delete-organization-logo.dto';
import { TenantResponseDto } from '../dto/tenant-response.dto';

/**
 * Who may use the branding editor routes: a platform admin (EDIT_TENANT,
 * under the USERS toggle) or a tenant's own ADMIN (EDIT_TENANT_BRANDING, no
 * toggle — see FeatureToggleOptions.orgAdminPermission). Every route that
 * takes an org id still runs assertTenantInScope, which for an org admin
 * resolves to exactly their tenant.
 */
const BRANDING_EDITOR_GATE = {
  permissions: [PERMISSIONS.EDIT_TENANT, PERMISSIONS.EDIT_TENANT_BRANDING],
  operator: 'OR' as const,
  orgAdminPermission: PERMISSIONS.EDIT_TENANT_BRANDING,
};

@ApiTags('Tenant')
@Controller('v1/tenants')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class TenantController {
  // Every route that names one organization checks it against the caller's
  // scope here, at the HTTP boundary — TenantService's lookups are shared
  // with internal callers that must not be scoped. An organization-restricted
  // platform admin holds VIEW_/EDIT_TENANT like any other, so the permission
  // alone used to open every org on the platform.
  constructor(
    private readonly tenantService: TenantService,
    private readonly tenantScopeService: TenantScopeService,
  ) {}

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.USERS, {
    permissions: [PERMISSIONS.EDIT_TENANT],
  })
  async create(@Body() createTenantDto: CreateTenantDto): Promise<Tenant> {
    // A new organization would sit outside their own allowlist the moment it
    // existed.
    if (await this.tenantScopeService.isRestricted()) {
      throw new ForbiddenException(
        'Organization-restricted admins cannot create organizations',
      );
    }
    return this.tenantService.create(createTenantDto, TenantStatus.ACTIVE);
  }

  @ApiQuery({
    name: 'includeUserCount',
    required: false,
    type: Boolean,
    description: 'Include user count for this tenant',
    default: false,
  })
  @RequireFeatureToggle(FeatureToggleKey.USERS, {
    permissions: [PERMISSIONS.VIEW_TENANT],
  })
  @Get(':id')
  async findById(
    @Param('id') id: string,
    @Query('includeUserCount') includeUserCount?: boolean,
  ): Promise<TenantResponseDto | null> {
    await this.tenantScopeService.assertTenantInScope(id);
    return this.tenantService.findById(id, {
      includeUserCount,
    });
  }

  @AuthPermissions([PERMISSIONS.VIEW_TENANT])
  @Get('code/:code')
  async findByCode(
    @Param('code') code: string,
  ): Promise<TenantResponseDto | null> {
    await this.tenantScopeService.assertTenantInScope(code);
    return this.tenantService.findByCode(code);
  }

  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateTenantStatusDto: UpdateTenantStatusDto,
  ): Promise<Tenant | null> {
    await this.tenantScopeService.assertTenantInScope(id);
    return this.tenantService.updateStatus(id, updateTenantStatusDto.status);
  }

  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  @Put(':id/settings')
  async updateSettings(
    @Param('id') id: string,
    @Body() updateTenantSettingsDto: UpdateTenantSettingsDto,
  ): Promise<Tenant | null> {
    await this.tenantScopeService.assertTenantInScope(id);
    return this.tenantService.updateSettings(
      id,
      updateTenantSettingsDto.settings,
    );
  }

  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  @Put(':id/metadata')
  async updateMetadata(
    @Param('id') id: string,
    @Body() updateTenantMetadataDto: UpdateTenantMetadataDto,
  ): Promise<Tenant | null> {
    await this.tenantScopeService.assertTenantInScope(id);
    return this.tenantService.updateMetadata(
      id,
      updateTenantMetadataDto.metadata,
    );
  }

  @ApiOperation({ summary: 'Get all tenants' })
  @ApiResponse({
    status: 200,
    description: 'List of tenants',
    type: Tenant,
    isArray: true,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of users to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of users to skip',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: TenantSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: SortOrder,
    description: 'Sort order: ASC or DESC',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    isArray: true,
    type: String,
    description: 'Search by name',
  })
  @AuthPermissions([PERMISSIONS.VIEW_TENANTS])
  @Get()
  async getAllTenants(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: TenantSortBy,
    @Query('sortOrder') order?: SortOrder,
    @Query('search') search?: string,
  ): Promise<GetAllTenantsResponseDto> {
    return this.tenantService.getAllTenants(search, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Edit tenant details' })
  @ApiResponse({ status: 200, description: 'updated tenant successfully' })
  @RequireFeatureToggle(FeatureToggleKey.USERS, {
    permissions: [PERMISSIONS.EDIT_TENANT],
  })
  @Patch(':id')
  async updateTenant(
    @Param('id') id: string,
    @Body() updateTenantDto: UpdateTenantDto,
  ): Promise<TenantResponseDto | null> {
    await this.tenantScopeService.assertTenantInScope(id);
    return this.tenantService.updateTenant(id, updateTenantDto);
  }

  // Organization branding. Two kinds of caller: a platform admin under the
  // USERS toggle with EDIT_TENANT (any org in their scope — an assigned
  // multi-tenant admin brands their own orgs only), and a tenant's own ADMIN
  // holding EDIT_TENANT_BRANDING, whose scope resolves to exactly their org.
  // The org-level switch is checked in the service, not here, so the refusal
  // can name the fix.
  @ApiOperation({ summary: 'Update organization branding' })
  @ApiResponse({ status: 200, type: UpdateTenantBrandingResponseDto })
  @RequireFeatureToggle(FeatureToggleKey.USERS, BRANDING_EDITOR_GATE)
  @Patch(':id/branding')
  async updateBranding(
    @Param('id') id: string,
    @Body() dto: UpdateTenantBrandingDto,
  ): Promise<UpdateTenantBrandingResponseDto> {
    await this.tenantScopeService.assertTenantInScope(id);
    return this.tenantService.updateBranding(id, dto);
  }

  @ApiOperation({ summary: 'Get presigned URL for a branding favicon upload' })
  @RequireFeatureToggle(FeatureToggleKey.USERS, BRANDING_EDITOR_GATE)
  @Post(':id/branding/favicon-url')
  async getPresignedUrlForBrandingFavicon(
    @Param('id') id: string,
    @Body() dto: FaviconUploadRequestDto,
  ): Promise<FaviconUploadResponseDto> {
    await this.tenantScopeService.assertTenantInScope(id);
    return this.tenantService.getPresignedUrlForBrandingFavicon(id, dto);
  }

  // The logo is part of branding too, so the branding editor's callers reach
  // the upload and delete routes as well. Neither names an organization: the
  // upload is an unreferenced file until a PATCH attaches it, and the delete
  // checks below that the file is not some out-of-reach org's logo.
  @ApiOperation({ summary: 'Get presigned URL for organization logo upload' })
  @RequireFeatureToggle(FeatureToggleKey.USERS, BRANDING_EDITOR_GATE)
  @Post('logo-url')
  async getPresignedUrlForOrganizationLogo(
    @Body() logoUploadRequestDto: LogoUploadRequestDto,
  ): Promise<OrganizationLogoUploadResponseDto> {
    return this.tenantService.getPresignedUrlForOrganizationLogo(
      logoUploadRequestDto,
    );
  }

  @ApiOperation({ summary: 'Delete organization logo ' })
  @RequireFeatureToggle(FeatureToggleKey.USERS, BRANDING_EDITOR_GATE)
  @Delete('logo')
  async deleteOrganizationLogo(
    @Body() deleteLogoDto: DeleteLogoDto,
  ): Promise<SuccessResponse> {
    // The body names a file, not an organization, so a caller whose scope is
    // bounded (an organization-restricted admin, or a tenant's own admin)
    // could otherwise delete any org's logo. Refuse one that is still some
    // out-of-reach org's logo; an unreferenced upload (replaced or abandoned)
    // stays theirs to clean up.
    if ((await this.tenantScopeService.resolveTenantIds()) !== null) {
      const owners = await this.tenantService.findTenantIdsUsingLogo(
        deleteLogoDto.logoUrl,
      );
      for (const tenantId of owners) {
        await this.tenantScopeService.assertTenantInScope(tenantId);
      }
    }
    return this.tenantService.deleteOrganizationLogo(deleteLogoDto);
  }
}
