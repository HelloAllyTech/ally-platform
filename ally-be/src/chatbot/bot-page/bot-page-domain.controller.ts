import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { Public } from '../../auth/decorators/auth.metadata';
import { CallerScopedRoute } from '../../auth/decorators/caller-scoped-route.decorator';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { ChatbotRole } from '../access/chatbot-role.decorator';
import { ChatbotMemberRole } from '../enum/chatbot.enum';
import { ChatbotAccessService } from '../service/chatbot-access.service';
import { BotPageDomainService } from './bot-page-domain.service';

const EDIT = { permissions: [PERMISSIONS.EDIT_WHATSAPP_BOT] };

export class AddBotPageDomainDto {
  @ApiProperty({ example: 'chat.sunrisemind.in' })
  @IsString()
  @MaxLength(300)
  host!: string;
}

/**
 * Custom domains for the bot page (stage 7): editors add a host, read the two DNS records to add,
 * and run the live check. The default `/chat/<id>` address keeps working whatever happens here.
 */
@ApiTags('Chatbots')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/chatbots')
@CallerScopedRoute()
export class BotPageDomainController {
  constructor(
    private readonly access: ChatbotAccessService,
    private readonly domains: BotPageDomainService,
  ) {}

  @Get(':id/page/domains')
  @ChatbotRole(ChatbotMemberRole.VIEWER)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      "The page's custom domains, the DNS records each needs, and the last check",
  })
  async list(@Param('id', ParseUUIDPipe) id: string) {
    await this.access.assertOrStaffView(id, ChatbotMemberRole.EDITOR);
    return { domains: await this.domains.list(id) };
  }

  @Post(':id/page/domains')
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Add a custom domain (one per assistant); answers with the records to add',
    description:
      '400 domain_invalid | domain_shared | domain_ours; 409 domain_taken | domain_limit. Adding the same host again answers it unchanged.',
  })
  add(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddBotPageDomainDto,
  ) {
    return this.access
      .assert(id, ChatbotMemberRole.EDITOR)
      .then(() => this.domains.add(id, dto.host));
  }

  @Post(':id/page/domains/:domainId/check')
  @HttpCode(200)
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  @ApiOperation({
    summary:
      'Check the DNS records now and set the status (verified or failed)',
    description:
      'Each record answers ok | missing | wrong | error with what DNS returned, so the screen can say what to fix.',
  })
  async check(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    return this.domains.check(id, domainId);
  }

  @Delete(':id/page/domains/:domainId')
  @HttpCode(204)
  @ChatbotRole(ChatbotMemberRole.EDITOR)
  @RequireFeatureToggle(FeatureToggleKey.WHATSAPP_BOT, EDIT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    await this.access.assert(id, ChatbotMemberRole.EDITOR);
    await this.domains.remove(id, domainId);
  }
}

/**
 * For the TLS front door (Caddy `on_demand_tls ask`, or a CloudFront provisioning job): 200 for a
 * verified custom domain, 404 otherwise, so certificates are issued only for real pages.
 */
@ApiTags('Bot page (public)')
@Controller('v1/public/bot-domains')
export class BotPageDomainPublicController {
  constructor(private readonly domains: BotPageDomainService) {}

  @Public()
  @Get('check')
  @ApiOperation({
    summary: 'Whether a custom domain is verified (for on-demand certificates)',
  })
  async check(@Query('domain') domain?: string): Promise<{ ok: true }> {
    if (!(await this.domains.isServed(domain))) {
      throw new NotFoundException();
    }
    return { ok: true };
  }
}
