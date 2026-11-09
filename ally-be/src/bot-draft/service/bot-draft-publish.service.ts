import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { BotPageAccessService } from '../../chatbot/bot-page/bot-page-access.service';
import { BotPageService } from '../../chatbot/bot-page/bot-page.service';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import {
  BotPageAccess,
  BotPageAccessKind,
  BotPageStatus,
} from '../../chatbot/enum/bot-page.enum';
import {
  ChatbotAnswerMode,
  ChatbotMemberRole,
  ChatbotStatus,
} from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { ChatbotSettingsService } from '../../chatbot/service/chatbot-settings.service';
import {
  DEFAULT_BOT_PAGE_LIMITS,
  type BotPageLanguage,
} from '../../chatbot/type/bot-page.type';
import { KbDocumentSourceType } from '../../knowledge-base/enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';
import { LoggerService } from '../../logger/logger.service';
import type { PublishBotDraftDto } from '../dto/bot-draft.dto';
import { BotDraftEntity } from '../entity/bot-draft.entity';
import {
  BotDraftActor,
  BotDraftStatus,
  BotDraftStep,
  PurposeId,
  purposeOf,
} from '../enum/bot-draft.enum';
import { packFor } from '../safety-pack/safety-packs';
import type { BotDraft, DraftEvent } from '../type/bot-draft.type';
import { BotDraftEventsService } from './bot-draft-events.service';
import { BotDraftService } from './bot-draft.service';

export const OWNER_NOTES_TITLE = 'Owner notes';

export interface PublishResult {
  chatbotId: string;
  slug: string;
  link: string;
  access: BotPageAccess;
}

/**
 * Publish a draft (chunk 20a): the chatbot, its settings and its bot page, written through the
 * same services the dashboard uses (12b's `BotPageService` and `BotPageAccessService`), so a
 * published draft is indistinguishable from a bot set up by hand.
 *
 * Idempotent and keyed by the draft: publishing again converges the same chatbot, the same page
 * and the same access list. Nothing is duplicated, and a second publish after a failure part-way
 * finishes the job.
 */
@Injectable()
export class BotDraftPublishService {
  private readonly logger = LoggerService.getInstance(
    BotDraftPublishService.name,
  );

  constructor(
    private readonly drafts: BotDraftService,
    private readonly events: BotDraftEventsService,
    private readonly access: ChatbotAccessService,
    private readonly settings: ChatbotSettingsService,
    private readonly botPages: BotPageService,
    private readonly pageAccess: BotPageAccessService,
    private readonly knowledge: KnowledgeBaseService,
    @InjectRepository(Chatbot)
    private readonly chatbots: Repository<Chatbot>,
  ) {}

  async publish(
    draft: BotDraftEntity,
    dto: PublishBotDraftDto,
  ): Promise<PublishResult> {
    if (
      draft.step !== BotDraftStep.SHARE &&
      draft.step !== BotDraftStep.PUBLISHED
    ) {
      throw new ConflictException({
        errorCode: 'not_ready',
        message: 'Finish building your assistant before you publish it.',
      });
    }
    if (draft.status === BotDraftStatus.ABANDONED || !draft.chatbotId) {
      throw new ConflictException('That setup was not found.');
    }
    const { chatbot } = await this.access.assert(
      draft.chatbotId,
      ChatbotMemberRole.EDITOR,
    );
    const config = draft.draftConfig;
    const pageAccess = dto.access as BotPageAccess;

    // Refused before anything is written, so a refusal never leaves half a publish.
    const botSettings = await this.settings.getForChatbot(chatbot);
    if (
      pageAccess === BotPageAccess.PUBLIC &&
      !botSettings.botPagePublicAllowed
    ) {
      throw new BadRequestException(
        'Public links are turned off for now. Choose organisation or specific people.',
      );
    }
    const emails = unique(
      (dto.emails ?? []).map((e) => e.trim().toLowerCase()),
    );
    let organisationIds = unique(dto.organisationIds ?? []);
    if (pageAccess === BotPageAccess.ORGANISATION && !organisationIds.length) {
      const own = ExecutionManager.getTenantId();
      if (own) organisationIds = [String(own)];
    }

    const pack = packFor(config.safetyPackId);
    const updated = await this.updateChatbot(chatbot, config, draft);
    await this.settings.updateChatbotSettings(
      { id: chatbot.id, safetyPack: updated.safetyPack },
      {
        ...(chatbot.settings ?? {}),
        ...(config.declineText.trim()
          ? { declineText: config.declineText.trim() }
          : {}),
        ...(pack?.requiredSettings.crisisClassifierEnabled
          ? { crisisClassifierEnabled: true }
          : {}),
      },
    );
    const ownerNotesDocumentId = await this.ownerNotes(draft, config);

    const existing = await this.botPages.findForChatbot(chatbot.id);
    // Onboarding may have created the page early, off, to hold the logo it found (chunk 20d), while
    // the draft was still named after the site's domain. Until the first publish its link isn't
    // anyone's yet, so it is suggested again from the assistant's final name.
    const unclaimed =
      existing &&
      existing.status === BotPageStatus.OFF &&
      draft.status !== BotDraftStatus.PUBLISHED;
    const slug =
      existing && !unclaimed
        ? existing.slug
        : unclaimed
          ? await this.botPages.suggestSlug(updated)
          : (await this.botPages.view(updated)).slug;
    const view = await this.botPages.save(updated, {
      status: BotPageStatus.ON,
      slug,
      access: pageAccess,
      settings: {
        branding: {
          ...config.branding,
          // The logo is the page's stored image (`settings.brand.logo`, chunk 20d), never the
          // site's own URL: the page must not hotlink it.
          logoUrl: null,
          title: config.branding.title.trim() || config.name,
          assistantName:
            config.branding.assistantName.trim() || config.assistantName,
        },
        suggestedQuestions: config.suggestedQuestions,
        prechat: config.prechat,
        limits: existing?.settings?.limits ?? DEFAULT_BOT_PAGE_LIMITS,
        language: pageLanguage(config.languages),
      } as never,
    });
    const page = await this.botPages.findForChatbot(chatbot.id);
    if (page) {
      await this.pageAccess.add(page.id, [
        ...emails.map((value) => ({ kind: BotPageAccessKind.EMAIL, value })),
        ...organisationIds.map((value) => ({
          kind: BotPageAccessKind.ORGANISATION,
          value,
        })),
      ]);
    }

    const event: DraftEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: BotDraftActor.OWNER,
      kind: 'publish',
      summary: `Published at ${view.slug} (${pageAccess})`,
    };
    const fresh = (await this.drafts.findById(draft.id)) ?? draft;
    const saved = await this.drafts.update(
      fresh,
      {
        status: BotDraftStatus.PUBLISHED,
        step: BotDraftStep.PUBLISHED,
        source: { ...fresh.source, ownerNotesDocumentId },
        draftConfig: {
          ...fresh.draftConfig,
          access: { mode: dto.access, emails, organisationIds },
        },
      },
      [event],
    );
    await this.events.publish(draft.id, {
      type: 'published',
      link: view.link,
      slug: view.slug,
      version: saved.version,
    });
    // Counts only: no addresses in the log.
    this.logger.info(
      `Draft ${draft.id} published as chatbot ${chatbot.id} (${pageAccess}, ${emails.length} emails, ${organisationIds.length} organisations)`,
    );
    return {
      chatbotId: chatbot.id,
      slug: view.slug,
      link: view.link,
      access: pageAccess,
    };
  }

  /**
   * The draft's assistant on its chatbot, as publish writes it (persona, safety pack and rules,
   * settings, Owner notes), without going live or touching the page: the checkup (chunk 20a-2)
   * asks the assistant its questions before it's published. A DRAFT chatbot stays a draft.
   */
  async stage(draft: BotDraftEntity): Promise<void> {
    if (!draft.chatbotId) return;
    const { chatbot } = await this.access.assert(
      draft.chatbotId,
      ChatbotMemberRole.EDITOR,
    );
    const config = draft.draftConfig;
    const pack = packFor(config.safetyPackId);
    const updated = await this.updateChatbot(
      chatbot,
      config,
      draft,
      chatbot.status,
    );
    await this.settings.updateChatbotSettings(
      { id: chatbot.id, safetyPack: updated.safetyPack },
      {
        ...(chatbot.settings ?? {}),
        ...(config.declineText.trim()
          ? { declineText: config.declineText.trim() }
          : {}),
        ...(pack?.requiredSettings.crisisClassifierEnabled
          ? { crisisClassifierEnabled: true }
          : {}),
      },
    );
    const ownerNotesDocumentId = await this.ownerNotes(draft, config);
    if (ownerNotesDocumentId !== (draft.source?.ownerNotesDocumentId ?? null)) {
      const fresh = (await this.drafts.findById(draft.id)) ?? draft;
      await this.drafts.update(fresh, {
        source: { ...fresh.source, ownerNotesDocumentId },
      });
    }
  }

  /** The chatbot as the draft describes it, with its safety pack and the owner's rules. */
  private async updateChatbot(
    chatbot: Chatbot,
    config: BotDraft,
    draft: BotDraftEntity,
    status: ChatbotStatus = ChatbotStatus.LIVE,
  ): Promise<Chatbot> {
    const pack = packFor(config.safetyPackId);
    const patch: Partial<Chatbot> = {
      name: config.name,
      persona: {
        ...(chatbot.persona ?? {}),
        displayName: config.assistantName,
        systemPrompt: config.instructions,
        tone: config.tone,
        greeting: config.introduction,
        defaultLanguage: config.languages[0] ?? 'en',
      },
      answerMode: ChatbotAnswerMode.DOCUMENTS_ONLY,
      safetyPack: pack?.id ?? null,
      safetyPackVersion: pack?.version ?? draft.safetyPackVersion ?? null,
      // Topics to avoid are set on the assistant itself (Make it yours, the home), so kept.
      rules: { ...(chatbot.rules ?? {}), never: config.extraNever },
      purpose: purposeOf(config),
      purposeNote:
        purposeOf(config) === PurposeId.CUSTOM
          ? config.purposeNote?.trim() || null
          : null,
      status,
      updatedBy: Number(ExecutionManager.getUserId() ?? 0) || null,
    } as Partial<Chatbot>;
    await this.chatbots.update({ id: chatbot.id }, patch as never);
    return { ...chatbot, ...patch } as Chatbot;
  }

  /** The owner's answers as a library document the assistant can cite: created once, then kept. */
  /** Write the "Owner notes" document from the draft's notes; also used by "Correct this". */
  async ownerNotes(
    draft: BotDraftEntity,
    config: Pick<BotDraft, 'ownerNotes'>,
  ): Promise<string | null> {
    const text = config.ownerNotes.trim();
    const existingId = draft.source?.ownerNotesDocumentId ?? null;
    if (!text) return existingId;
    if (existingId) {
      await this.knowledge.updateForChatbot(draft.chatbotId!, existingId, {
        text,
      });
      return existingId;
    }
    const document = await this.knowledge.createForChatbot(draft.chatbotId!, {
      sourceType: KbDocumentSourceType.PASTE,
      title: OWNER_NOTES_TITLE,
      text,
      tags: ['onboarding', 'owner-notes'],
    } as never);
    await this.drafts.addKnowledgeDocument(draft.id, document.id);
    await this.drafts.attachDocument(draft, document.id);
    return document.id;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** One language: that one; several: each person's own, from the page's choice of two. */
export function pageLanguage(languages: string[]): BotPageLanguage {
  if (languages.length > 1) return 'auto';
  return languages[0] === 'hi' ? 'hi' : 'en';
}
