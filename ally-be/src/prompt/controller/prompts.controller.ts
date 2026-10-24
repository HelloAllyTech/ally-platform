import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
  Delete,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PromptsService } from '../service/prompt.service';
import {
  PromptTranslationService,
  TranslateOneResult,
  TranslatePromptResult,
  BackfillResult,
} from '../service/prompt-translation.service';
import { PromptTranslation } from '../entity/prompt-translation.entity';
import { SetTranslationRuntimeModelDto } from '../dto/set-translation-runtime-model.dto';
import { UpdatePromptDto } from '../dto/update-prompt.dto';
import {
  CreatePromptVersionRequestDto,
  PromoteVersionRequestDto,
  RevertPromptRequestDto,
} from '../dto/skills-store.dto';
import { CreatePromptsDto } from '../dto/create-prompts.dto';
import { SyncPromptsDto } from '../dto/sync-prompts.dto';
import { SortOrder } from 'src/user/enum/user.enum';
import { Prompt } from '../entity/prompt.entity';
import { PromptResponse } from '../type/prompt-response.type';

@ApiTags('Prompts')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'prompts',
  version: '1',
})
export class PromptsController {
  constructor(
    private readonly promptsService: PromptsService,
    private readonly promptTranslationService: PromptTranslationService,
  ) {}

  // ===== PROMPT TRANSLATION ENDPOINTS =====

  @ApiOperation({
    summary:
      'Backfill: (re)translate every enabled source across eligible languages',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Post('translations/backfill')
  async backfillTranslations(): Promise<BackfillResult> {
    return this.promptTranslationService.backfillEnabledPrompts();
  }

  @ApiOperation({
    summary:
      "List a version's translations (read-only, per language). Defaults to the live version.",
  })
  @AuthPermissions([PERMISSIONS.VIEW_PROMPT])
  @Get(':id/translations')
  async listPromptTranslations(
    @Param('id') id: string,
    @Query('version') version?: string,
  ): Promise<PromptTranslation[]> {
    if (version) {
      const body = await this.promptsService.getVersionBody(
        id,
        Number(version),
      );
      if (body === null) return [];
      return this.promptTranslationService.listTranslations(id, body);
    }
    return this.promptTranslationService.listTranslations(id);
  }

  // ===== VERSION ENDPOINTS (the one write path for text and model settings) =====

  @ApiOperation({
    summary:
      'A prompt’s versions, newest first: live, candidates (with translation readiness) and history',
  })
  @AuthPermissions([PERMISSIONS.VIEW_PROMPT])
  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.promptsService.listVersions(id);
  }

  @ApiOperation({
    summary:
      'Save text and model settings as a new candidate version. 409 stale_base if a newer version exists; 422 contract_violation if it breaks the contract.',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Post(':id/versions')
  createVersion(
    @Param('id') id: string,
    @Body() dto: CreatePromptVersionRequestDto,
  ) {
    return this.promptsService.createVersion(id, dto);
  }

  @ApiOperation({
    summary:
      'Put a version live. 409 stale_base if the live version changed; 409 translations_pending while translations run. Failed translations are reported and keep English.',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Post(':id/versions/:version/promote')
  promoteVersion(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: PromoteVersionRequestDto,
  ) {
    return this.promptsService.promoteVersion(
      id,
      version,
      dto.expectedCurrentVersion,
      {
        allowRollback: dto.rollback === true,
        confirmJudgeRubricChange: dto.confirmJudgeRubricChange === true,
      },
    );
  }

  @ApiOperation({
    summary:
      "(Re)translate one version's text into every eligible language, retrying failed ones",
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Post(':id/versions/:version/translations')
  async translateVersion(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<{ ok: true }> {
    await this.promptsService.translateVersion(id, version);
    return { ok: true };
  }

  @ApiOperation({
    summary: 'Re-translate a prompt into all eligible languages',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Post(':id/translations')
  async retranslatePrompt(
    @Param('id') id: string,
  ): Promise<TranslatePromptResult> {
    return this.promptTranslationService.translatePrompt(id);
  }

  @ApiOperation({
    summary:
      'Re-translate a prompt into a single language (per-language retry)',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Post(':id/translations/:languageId')
  async retranslatePromptLanguage(
    @Param('id') id: string,
    @Param('languageId', ParseIntPipe) languageId: number,
  ): Promise<TranslateOneResult> {
    return this.promptTranslationService.translateOne(id, languageId);
  }

  @ApiOperation({
    summary:
      'Set the runtime model that runs the main agent for one language (multilingual path)',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Put(':id/translations/:languageId/runtime-model')
  async setTranslationRuntimeModel(
    @Param('id') id: string,
    @Param('languageId', ParseIntPipe) languageId: number,
    @Body() dto: SetTranslationRuntimeModelDto,
  ): Promise<{ ok: true }> {
    await this.promptTranslationService.setRuntimeModel(
      id,
      languageId,
      dto.provider,
      dto.model,
    );
    return { ok: true };
  }

  // ===== PROMPT ENDPOINTS =====

  @ApiOperation({
    summary: 'Get prompts by codes (e.g. for ally-ai-learn report)',
  })
  @UseGuards(ApiAuthGuard)
  @ApiSecurity('api-key')
  @Get('by-codes')
  async getPromptsByCodes(
    @Query('codes') codes: string,
  ): Promise<Record<string, string>> {
    const codeList = codes
      ? codes
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
    if (codeList.length === 0) {
      return {};
    }
    return this.promptsService.getPromptsByCodes(codeList);
  }

  @ApiOperation({ summary: 'Get all prompts' })
  @AuthPermissions([PERMISSIONS.VIEW_PROMPT])
  @Get('')
  async getPrompts(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: SortOrder = SortOrder.ASC,
    @Query('searchName') searchName?: string,
    @Query('includeBlocks') includeBlocks?: string,
  ): Promise<PromptResponse[]> {
    const includeBlocksBool = includeBlocks !== 'false';
    return this.promptsService.getPrompts(searchName, includeBlocksBool, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiOperation({
    summary:
      'List prompt variants by promptType (e.g. main_agent) for the studio picker',
    description:
      'Includes variants with visibleInStudio=false. Hiding a variant only ' +
      'removes it from the pickers’ selectable options (enforced ' +
      'client-side); the row must still be returned so the studio can resolve ' +
      'the name, states and available variables of a hidden-but-still-in-use ' +
      'variant on scenarios that already reference it.',
  })
  @AuthPermissions([PERMISSIONS.VIEW_PROMPT])
  @Get('by-type/:promptType')
  async getPromptsByType(
    @Param('promptType') promptType: string,
  ): Promise<PromptResponse[]> {
    return this.promptsService.getPromptsByType(promptType);
  }

  @ApiOperation({
    summary: 'Duplicate an existing prompt to start a new variant',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Post(':id/duplicate')
  async duplicatePrompt(@Param('id') id: string): Promise<Prompt> {
    return this.promptsService.duplicatePrompt(id);
  }

  @ApiOperation({ summary: 'Create new prompts' })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Post('')
  async createPrompts(
    @Body() createPromptsDto: CreatePromptsDto,
  ): Promise<Prompt[]> {
    return this.promptsService.createPrompts(createPromptsDto);
  }

  @ApiOperation({
    summary:
      'Sync prompts from folder/codebase (add-only, update defaultPrompt)',
    description:
      'Accepts x-api-key for deployment scripts (e.g. ally-ai-learn sync).',
  })
  @UseGuards(ApiAuthGuard)
  @ApiSecurity('api-key')
  @Post('sync')
  async syncPrompts(
    @Body() syncPromptsDto: SyncPromptsDto,
  ): Promise<{ added: number; updated: number }> {
    return this.promptsService.syncPrompts(syncPromptsDto);
  }

  @ApiOperation({
    summary:
      'Update prompt metadata (name, description, visibility, translation opt-in). Text and model settings change through versions.',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Put(':id')
  async updatePrompt(
    @Param('id') id: string,
    @Body() updatePromptDto: UpdatePromptDto,
  ): Promise<boolean> {
    return this.promptsService.updatePrompt(id, updatePromptDto);
  }

  @ApiOperation({
    summary:
      'Revert to the default text in Git: a new version put live, translations included',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Post(':id/revert')
  async revertPrompt(
    @Param('id') id: string,
    @Body() dto: RevertPromptRequestDto = {},
  ): Promise<boolean> {
    return this.promptsService.revertPrompt(id, {
      confirmJudgeRubricChange: dto?.confirmJudgeRubricChange === true,
    });
  }

  @ApiOperation({
    summary:
      'Delete a prompt. Allowed for obsolete prompts and for "Duplicate ' +
      'as variant" rows (DB-only, promptCode contains `_copy_`). File-' +
      'backed prompts must be obsoleted first (remove their .txt file). ' +
      'Refused with 409 when any scenario still references the variant.',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.EDIT_PROMPT],
  })
  @Delete(':id')
  async deleteObsoletePrompt(@Param('id') id: string): Promise<void> {
    return this.promptsService.deleteObsoletePrompt(id);
  }

  @ApiOperation({
    summary:
      'Get the count + a sample (up to 10) of scenarios referencing this ' +
      'prompt via metadata.selectedMainPromptCode. Drives the in-use guard ' +
      'and tooltip on the "Delete variant" button in the studio side panel.',
  })
  @RequireFeatureToggle(FeatureToggleKey.PROMPTS, {
    permissions: [PERMISSIONS.VIEW_PROMPT],
  })
  @Get(':id/usage')
  async getPromptUsage(@Param('id') id: string): Promise<{
    count: number;
    scenarios: Array<{ id: number; title: string }>;
  }> {
    return this.promptsService.getPromptUsage(id);
  }
}
