import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  RequireSkillsStoreScope,
  SkillsStoreKeyGuard,
} from '../guard/skills-store-key.guard';
import {
  SkillsStoreKey,
  SkillsStoreKeyScope,
} from '../entity/skills-store-key.entity';
import {
  SkillsStoreService,
  SkillsStoreExport,
} from '../service/skills-store.service';
import { SkillsStoreKeyService } from '../service/skills-store-key.service';
import {
  CreatePromptVersionRequestDto,
  CreateSkillsStoreKeyDto,
} from '../dto/skills-store.dto';

/**
 * The Skills Store API the `prompts` CLI talks to, plus key management for the
 * admin dashboard. CLI routes authenticate with a Skills Store key
 * (`x-skills-store-key`); key management uses the admin's session.
 */
@ApiTags('Skills Store')
@Controller({ path: 'skills-store', version: '1' })
export class SkillsStoreController {
  constructor(
    private readonly store: SkillsStoreService,
    private readonly keys: SkillsStoreKeyService,
  ) {}

  @ApiOperation({
    summary:
      'Export live prompts (and optionally candidates) with their ready translations',
  })
  @ApiSecurity('skills-store-key')
  @UseGuards(SkillsStoreKeyGuard)
  @RequireSkillsStoreScope(SkillsStoreKeyScope.PULL)
  @Get('export')
  export(
    @Query('codes') codes?: string,
    @Query('candidates') candidates?: string,
  ): Promise<SkillsStoreExport> {
    return this.store.export({
      codes: codes
        ?.split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      includeCandidates: candidates === 'true',
    });
  }

  @ApiOperation({ summary: "A prompt's live version, candidates and history" })
  @ApiSecurity('skills-store-key')
  @UseGuards(SkillsStoreKeyGuard)
  @RequireSkillsStoreScope(SkillsStoreKeyScope.PULL)
  @Get('prompts/:code')
  getPrompt(@Param('code') code: string) {
    return this.store.getPrompt(code);
  }

  @ApiOperation({
    summary:
      'Push a candidate version. Refused with 409 stale_base if the store moved since your pull, 422 contract_violation if it breaks the contract.',
  })
  @ApiSecurity('skills-store-key')
  @UseGuards(SkillsStoreKeyGuard)
  @RequireSkillsStoreScope(SkillsStoreKeyScope.PUSH)
  @Post('prompts/:code/versions')
  push(
    @Param('code') code: string,
    @Body() dto: CreatePromptVersionRequestDto,
    @Req() request: { skillsStoreKey: SkillsStoreKey },
  ) {
    return this.store.pushVersion(code, dto, request.skillsStoreKey);
  }

  @ApiOperation({
    summary:
      'Load an export into this store and serve it. Local stacks only (SKILLS_STORE_IMPORT_ENABLED=true).',
  })
  @ApiSecurity('api-key')
  @UseGuards(ApiAuthGuard)
  @Post('import')
  import(@Body() payload: SkillsStoreExport) {
    return this.store.import(payload);
  }

  @ApiOperation({
    summary: 'List Skills Store keys (never the keys themselves)',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Get('keys')
  listKeys() {
    return this.keys.list();
  }

  @ApiOperation({
    summary: 'Generate a key for the prompts CLI. The key is returned once.',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Post('keys')
  createKey(@Body() dto: CreateSkillsStoreKeyDto) {
    return this.keys.issue(
      dto.name,
      dto.scopes,
      Number(ExecutionManager.getUserId()) || null,
    );
  }

  @ApiOperation({ summary: 'Revoke a Skills Store key' })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Delete('keys/:id')
  async revokeKey(@Param('id') id: string): Promise<{ ok: true }> {
    await this.keys.revoke(id, Number(ExecutionManager.getUserId()) || null);
    return { ok: true };
  }
}
