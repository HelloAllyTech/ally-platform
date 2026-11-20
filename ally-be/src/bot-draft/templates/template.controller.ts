import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  AssistantScope,
  ChatbotRole,
} from '../../chatbot/access/chatbot-role.decorator';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { draftView } from '../service/bot-draft-view';
import { BotDraftService } from '../service/bot-draft.service';
import { answersOf } from './template-answers';
import { TemplateService } from './template.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

export class InstallTemplateDto {
  @ApiPropertyOptional({
    description:
      'Setup answers by question key: text, true/false, or the choices ticked. Left out is skipped.',
  })
  @IsOptional()
  @IsObject()
  answers?: Record<string, unknown>;
}

export class DraftTemplateDto extends InstallTemplateDto {
  @ApiPropertyOptional({ example: 'helpline' })
  @IsString()
  @MaxLength(40)
  template!: string;
}

/** Use-case templates (Agents v2, T1): the catalogue, and one-click install in setup or Tools. */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1')
@CallerScopedRoute()
export class TemplateController {
  constructor(
    private readonly templates: TemplateService,
    private readonly drafts: BotDraftService,
  ) {}

  @Get('chatbots/:id/templates')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary: 'The use-case templates, for organisations then businesses',
    description:
      'The suggested one first in its group, and which of each template’s lists the assistant already has.',
  })
  catalogue(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.catalogueFor(id);
  }

  @Get('chatbots/:id/templates/origin')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary:
      'Which template an assistant was set up from, and its examples still to replace',
  })
  async origin(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.originView(id);
  }

  @Post('chatbots/:id/templates/:templateId')
  @ChatbotRole(ChatbotMemberRole.OWNER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Add from a template',
    description:
      'Adds the template’s lists, what the assistant may do with each, their lines and its checkup questions, in one go. Lists the assistant already has are named and left as they are; the safety pack only ever gets stricter. Never publishes.',
  })
  install(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('templateId') templateId: string,
    @Body() dto: InstallTemplateDto,
  ) {
    return this.templates.installOnAssistant(
      id,
      templateId,
      answersOf(dto.answers),
    );
  }

  // Not under bot-drafts/: that path's `:id` route would take it. Part of creating an assistant.
  @Get('assistant-templates')
  @AssistantScope('create')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'The use-case templates, before a setup starts' })
  draftCatalogue() {
    return this.templates.catalogue();
  }

  @Post('bot-drafts/:id/template')
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Start from a template, during setup',
    description:
      'Applies the template to the draft: its purpose, safety pack (only when stricter), instructions, lists, checkup questions and the owner’s answers. Never publishes.',
  })
  async installOnDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DraftTemplateDto,
  ) {
    const draft = await this.drafts.get(id);
    const { result, draft: saved } = await this.templates.installOnDraft(
      draft,
      dto.template,
      answersOf(dto.answers),
    );
    return { result, draft: draftView(saved) };
  }
}
