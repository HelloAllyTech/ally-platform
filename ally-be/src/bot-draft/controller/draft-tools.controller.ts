import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AssistantScope } from '../../chatbot/access/chatbot-role.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  ApplyDraftChangeDto,
  ProposeDraftChangeDto,
  RunLikelyDto,
} from '../dto/draft-tools.dto';
import {
  BotDraftLikelyService,
  LIKELY_LIMITS,
} from '../service/bot-draft-likely.service';
import { DraftChangeService } from '../service/draft-change.service';

const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

/**
 * SB1: two things an owner does while building, both on the draft (the owner's source of truth
 * during setup) rather than the assistant row: look at how likely questions are answered, and
 * change the assistant by talking.
 */
@ApiTags('Onboarding')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/bot-drafts')
export class DraftToolsController {
  constructor(
    private readonly likely: BotDraftLikelyService,
    private readonly changes: DraftChangeService,
  ) {}

  @Post(':id/run-likely')
  @HttpCode(200)
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Ask the assistant being built its likely questions (nothing saved)',
    description:
      'Writes up to `count` (1-10, default 10) questions from what was learned, asks each as a single turn on the draft as it is now, and grades each reply with the checkup grader. Nothing is saved: no checkup question, no checkup run. 409 `setup_finished` once the setup is published or abandoned. `generated` is 0 (and `results` empty) when nothing has been learned yet. One question that fails comes back as `check`; the batch gives up after 90 seconds.',
  })
  run(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RunLikelyDto) {
    return this.likely.run(id, dto.count ?? LIKELY_LIMITS.defaultCount);
  }

  @Post(':id/changes/propose')
  @HttpCode(200)
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Change by chat on a setup: a proposed before and after',
    description:
      'Same shape as /v1/chatbots/:id/changes/propose, read from the draft. Body takes `request` (or `message`). Nothing is applied. `version` is the draft version to send back to apply.',
  })
  propose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProposeDraftChangeDto,
  ) {
    const request = (dto.request ?? dto.message ?? '').trim();
    if (!request) {
      throw new BadRequestException('Say what you would like to change.');
    }
    return this.changes.propose(id, request);
  }

  @Post(':id/changes/apply')
  @HttpCode(200)
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Apply a proposed change to the draft',
    description:
      'Written to the draft as the owner (path allow-list and safety lock apply) as one change. 409 `stale_version` if the draft moved since it was proposed; 400 `too_many_rules` past 20 own rules. Returns the event id Undo takes.',
  })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyDraftChangeDto,
  ) {
    return this.changes.apply(id, dto.changes, dto.version, dto.fieldVersions);
  }

  @Post(':id/changes/:eventId/undo')
  @HttpCode(200)
  @AssistantScope('service')
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary: 'Undo a change made by chat on a setup',
    description:
      'Refused (409) when a later change touched the same thing: undo that one first.',
  })
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.changes.undo(id, eventId);
  }
}
