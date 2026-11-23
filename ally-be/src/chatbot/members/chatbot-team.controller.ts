import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/auth.metadata';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AssistantScope, ChatbotCan } from '../access/chatbot-role.decorator';
import {
  AcceptChatbotInviteDto,
  CreateChatbotInviteDto,
  PublicAcceptChatbotInviteDto,
  TransferOwnershipDto,
} from '../dto/chatbot.dto';
import { ChatbotCapability } from '../enum/chatbot.enum';
import { ChatbotInvitesService } from './chatbot-invites.service';
import { ChatbotMembersService } from './chatbot-members.service';
import { ResponderAgreementService } from './responder-agreement.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_WHATSAPP_BOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };
const userId = (): number => Number(ExecutionManager.getUserId() ?? 0);

export class AcceptResponderAgreementDto {
  @ApiProperty({ example: 'v1', description: 'The version the person read' })
  @IsString()
  @MaxLength(16)
  version!: string;
}

/**
 * A chatbot's team beyond `PUT :id/members` (Stage 1b): removing one person, leaving, handing the
 * chatbot over, and invites. Member routes: being on the team (with the capability) is enough.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class ChatbotTeamController {
  constructor(
    private readonly members: ChatbotMembersService,
    private readonly invites: ChatbotInvitesService,
  ) {}

  @Delete(':id/members/:userId')
  @ChatbotCan(ChatbotCapability.MANAGE_PEOPLE)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Take one person off the team (owners). Never the last owner (`last_owner`) or the creator (`creator_must_transfer`)',
  })
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseIntPipe) memberId: number,
  ) {
    return this.members.remove(id, memberId);
  }

  @Post(':id/leave')
  @HttpCode(200)
  @ChatbotCan(ChatbotCapability.VIEW)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({
    summary:
      'Leave the team. The last owner (`last_owner`) and the creator (`creator_must_transfer`) cannot',
  })
  leave(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.leave(id);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @ChatbotCan(ChatbotCapability.MANAGE_PEOPLE)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Hand the chatbot over: the member becomes an owner and its creator (the creator only)',
  })
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferOwnershipDto,
  ) {
    return this.members.transfer(id, dto.userId);
  }

  @Post(':id/invites')
  @ChatbotCan(ChatbotCapability.MANAGE_PEOPLE)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Invite an email to the team with roles (owners). Emails a link that works only for that address',
  })
  createInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateChatbotInviteDto,
  ) {
    return this.invites.create(id, dto);
  }

  @Get(':id/invites')
  @ChatbotCan(ChatbotCapability.MANAGE_PEOPLE)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, VIEW)
  @ApiOperation({ summary: 'Invites still waiting (owners)' })
  listInvites(@Param('id', ParseUUIDPipe) id: string) {
    return this.invites.listPending(id);
  }

  @Delete(':id/invites/:inviteId')
  @ChatbotCan(ChatbotCapability.MANAGE_PEOPLE)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({ summary: 'Withdraw an invite (owners)' })
  revokeInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    return this.invites.revoke(id, inviteId);
  }
}

/**
 * What a signed-in person does about their own membership, with no chatbot in the path: accept an
 * invite sent to their email, and the responder agreement. No feature toggle: an invited member
 * holds none. Authenticated by the JWT guard alone (there is no global auth guard).
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/assistant-members')
@CallerScopedRoute()
@UseGuards(AuthGuard('jwt'))
export class AssistantMembersController {
  constructor(
    private readonly invites: ChatbotInvitesService,
    private readonly agreement: ResponderAgreementService,
  ) {}

  @Post('invites/accept')
  @HttpCode(200)
  @AssistantScope('service')
  @ApiOperation({
    summary:
      'Accept an invite as the signed-in person; their email must be the invite’s (`invite_wrong_email`)',
  })
  accept(@Body() dto: AcceptChatbotInviteDto) {
    return this.invites.accept(dto.token, { signedInUserId: userId() });
  }

  @Get('responder-agreement')
  @AssistantScope('service')
  @ApiOperation({
    summary: 'The responder agreement and whether you accepted it',
  })
  agreementStatus() {
    return this.agreement.status(userId());
  }

  @Post('responder-agreement')
  @HttpCode(200)
  @AssistantScope('service')
  @ApiOperation({
    summary:
      'Accept the current responder agreement (`stale_version` if it changed)',
  })
  acceptAgreement(
    @Body() dto: AcceptResponderAgreementDto,
    @Req() req: Request,
  ) {
    return this.agreement.accept(userId(), dto.version, req.ip ?? null);
  }
}

/**
 * The invite link's page, before sign-in. Accepting here needs the token AND the invited email;
 * the access always goes to that email's account, which then signs in with a code sent to it.
 */
@ApiTags('Chatbots (public)')
@Controller('v1/public/assistant-invites')
export class PublicAssistantInvitesController {
  constructor(private readonly invites: ChatbotInvitesService) {}

  @Public()
  @Post('preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'The chatbot, masked email and roles of a waiting invite',
  })
  preview(@Body() dto: AcceptChatbotInviteDto) {
    return this.invites.preview(dto.token);
  }

  @Public()
  @Post('accept')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Accept with the token and the invited email; then sign in with that email',
  })
  accept(@Body() dto: PublicAcceptChatbotInviteDto) {
    return this.invites.accept(dto.token, { email: dto.email });
  }
}
