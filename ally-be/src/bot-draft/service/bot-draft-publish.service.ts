import { PlanService } from 'src/billing/service/plan.service';
import { ListOwnerService } from '../../chatbot/lists/list-owner.service';
import { realName } from '../name-placeholders';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { prechatFor } from '../../chatbot/bot-page/prechat-minors';
import { OnEvent } from '@nestjs/event-emitter';
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
  ChatbotAccessMode,
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
import { GoLiveGateService } from '../../chatbot/safety/go-live-gate.service';
import type { BotDraft, DraftEvent } from '../type/bot-draft.type';
import { BotDraftEventsService } from './bot-draft-events.service';
import { BotDraftService } from './bot-draft.service';
import {
  LEARNED_FACTS_CHANGED,
  LEARNED_FACTS_TAG,
  LEARNED_FACTS_TITLE,
  learnedFactsText,
  type LearnedFactsChanged,
} from './learned-facts-document';

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
    // CR1: the plan's publish limit and the included seats (optional for existing specs).
    @Optional() private readonly plans?: PlanService,
    // Stage 4: the go-live gate (D10), on publish like every other path. Optional for specs.
    @Optional() private readonly goLive?: GoLiveGateService,
    // Q4 B10: "Bring in customers" gets its Callback requests list on publish.
    @Optional() private readonly lists?: ListOwnerService,
  ) {}

  async publish(
    draft: BotDraftEntity,
    dto: PublishBotDraftDto,
  ): Promise<PublishResult> {
    // The old onboarding walked READING → … → SHARE and publish waited for SHARE. Create and Build
    // never walks those steps (a templated or form-built draft stays at `learned`), so with the
    // go-live gate enforced (D10) the gate below is the readiness check and the step is not read.
    // With ASSISTANT_GO_LIVE_GATE_ENABLED=false (or no gate service) the old rule holds.
    if (
      !this.goLive?.enforced?.() &&
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
    // A draft the new flow built may lack fields the old steps always filled: defaults, so nothing
    // below throws part-way and leaves the chatbot live without its page.
    const config = publishableConfig(draft.draftConfig, chatbot.name);
    // Stage 4: the go-live gate, read as the chatbot will be once the draft's purpose is written.
    await this.goLive?.assertCanGoLive(chatbot.id, {
      purpose: purposeOf(config),
    });
    // CR1: refused before anything is written ("Free publishes up to 3 assistants…").
    await this.plans?.assertCanPublish(chatbot.id);
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
    // D4: invite only means the chatbot's own access list ("Who may chat", listed mode) on every
    // channel; the web page's invite gate reads that list too. An empty list is allowed: nobody can
    // chat until the owner adds people.
    const updated = await this.updateChatbot(
      chatbot,
      config,
      draft,
      ChatbotStatus.LIVE,
      pageAccess === BotPageAccess.INVITE
        ? ChatbotAccessMode.LISTED
        : undefined,
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
        // Stage 5: the live chatbot replies only in its enabled languages.
        ...enabledLanguagesPatch(config.languages),
      },
    );
    await this.callbackListFor(updated, config);
    const ownerNotesDocumentId = await this.ownerNotes(draft, config);
    const learnedFactsDocumentId = await this.learnedFacts(draft);

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
          title: realName(
            config.branding.title,
            realName(config.name, updated.name),
          ),
          assistantName: realName(
            config.branding.assistantName,
            realName(config.assistantName, updated.name),
          ),
        },
        suggestedQuestions: config.suggestedQuestions,
        // Young people (Q3-fast Part 1): no name or contact questions before the chat.
        prechat: prechatFor(config.prechat, config.safetyPackId),
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
        source: {
          ...fresh.source,
          ownerNotesDocumentId,
          learnedFactsDocumentId,
        },
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
    // CR1: a published assistant has its included seats: owners, then editors, then invitees.
    await this.plans
      ?.ensureIncludedSeats(chatbot.id)
      .catch((error: unknown) =>
        this.logger.warn(
          `Included seats not created for chatbot ${chatbot.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
        ),
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
    const config = publishableConfig(draft.draftConfig, chatbot.name);
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
        // Stage 5: the live chatbot replies only in its enabled languages.
        ...enabledLanguagesPatch(config.languages),
      },
    );
    const ownerNotesDocumentId = await this.ownerNotes(draft, config);
    const learnedFactsDocumentId = await this.learnedFacts(draft);
    if (
      ownerNotesDocumentId !== (draft.source?.ownerNotesDocumentId ?? null) ||
      learnedFactsDocumentId !== (draft.source?.learnedFactsDocumentId ?? null)
    ) {
      const fresh = (await this.drafts.findById(draft.id)) ?? draft;
      await this.drafts.update(fresh, {
        source: {
          ...fresh.source,
          ownerNotesDocumentId,
          learnedFactsDocumentId,
        },
      });
    }
  }

  /**
   * "Bring in customers" takes people's details for the team (Q4 B10, BHIVE: a live customer asking
   * for a sales call was told "I can't pass your details"): on publish, an assistant with that
   * purpose and no Callback requests list gets one, with Add entries at Do it. An existing list is
   * left exactly as the owner set it. A failure leaves publishing as it was.
   */
  private async callbackListFor(chatbot: Chatbot, config: BotDraft) {
    if (config.purpose !== PurposeId.ENQUIRIES || !this.lists) return;
    try {
      const [has] = await this.chatbots.manager.query(
        `SELECT 1 FROM collections WHERE chatbot_id = $1 AND key = 'callback_requests' AND deleted_at IS NULL`,
        [chatbot.id],
      );
      if (has) return;
      const fresh = await this.chatbots.findOneByOrFail({ id: chatbot.id });
      await this.lists.install(fresh, 'callback_requests');
      await this.lists.setAbilities(chatbot.id, 'callback_requests', {
        create: 'do_it',
      });
    } catch (error) {
      this.logger.warn(
        `Callback requests list not added on publish for ${chatbot.id}: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }

  /** The chatbot as the draft describes it, with its safety pack and the owner's rules. */
  private async updateChatbot(
    chatbot: Chatbot,
    config: BotDraft,
    draft: BotDraftEntity,
    status: ChatbotStatus = ChatbotStatus.LIVE,
    accessMode?: ChatbotAccessMode,
  ): Promise<Chatbot> {
    const pack = packFor(config.safetyPackId);
    // Q4 N1: never a placeholder ("unchanged") as the assistant's name.
    const name = realName(
      config.name,
      realName(chatbot.name, 'Your assistant'),
    );
    const patch: Partial<Chatbot> = {
      name,
      persona: {
        ...(chatbot.persona ?? {}),
        displayName: realName(config.assistantName, name),
        systemPrompt: config.instructions,
        tone: config.tone,
        greeting: config.introduction,
        defaultLanguage: config.languages[0] ?? 'en',
      },
      answerMode: ChatbotAnswerMode.DOCUMENTS_ONLY,
      safetyPack: pack?.id ?? null,
      safetyPackVersion: pack?.version ?? draft.safetyPackVersion ?? null,
      // Topics to avoid are set on the assistant itself (Make it yours, the home), so kept.
      rules: {
        ...(chatbot.rules ?? {}),
        never: config.extraNever,
        // Q4 A3: the owner's correction of the pack in setup, as the home records it.
        ...(config.packChange ? { packChange: config.packChange } : {}),
      },
      purpose: purposeOf(config),
      purposeNote:
        purposeOf(config) === PurposeId.CUSTOM
          ? config.purposeNote?.trim() || null
          : null,
      status,
      ...(accessMode ? { accessMode } : {}),
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

  /**
   * The facts setup learned, as a "What we learned" document of one passage each (Q3-fast
   * Part 2, fix 1), written where Owner notes are: before the checkup (`stage`) and at publish.
   * Afterwards it follows the draft (`onLearnedFactsChanged`). No facts, no document.
   */
  async learnedFacts(draft: BotDraftEntity): Promise<string | null> {
    const text = learnedFactsText(draft.learned?.facts ?? []);
    const existingId = draft.source?.learnedFactsDocumentId ?? null;
    if (!text) return existingId;
    if (existingId) {
      await this.knowledge.updateForChatbot(draft.chatbotId!, existingId, {
        text,
      });
      return existingId;
    }
    const document = await this.knowledge.createForChatbot(draft.chatbotId!, {
      sourceType: KbDocumentSourceType.PASTE,
      title: LEARNED_FACTS_TITLE,
      text,
      tags: ['onboarding', LEARNED_FACTS_TAG],
    } as never);
    await this.drafts.addKnowledgeDocument(draft.id, document.id);
    await this.drafts.attachDocument(draft, document.id);
    return document.id;
  }

  /** A saved draft's facts changed: the document follows (unchanged text is a no-op). */
  @OnEvent(LEARNED_FACTS_CHANGED, { async: true })
  async onLearnedFactsChanged(event: LearnedFactsChanged): Promise<void> {
    const text = learnedFactsText(event.facts);
    if (!text) return;
    const update = () =>
      this.knowledge.updateForChatbot(event.chatbotId, event.documentId, {
        text,
      });
    try {
      // A save outside a request (a background re-read) has no user: run as the owner.
      if (ExecutionManager.getUserId()) await update();
      else
        await ExecutionManager.runWithContext(
          async () => {
            ExecutionManager.setAuthContext(
              String(event.ownerUserId),
              event.tenantId ?? '',
            );
            await update();
          },
          { path: 'bot-draft-learned-facts' },
        );
    } catch (error) {
      this.logger.warn(
        `Could not update the learned facts for chatbot ${event.chatbotId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }
}

/**
 * The draft's config with every field publish reads present: a draft from Create and Build (a
 * template, the form) may never have been through the steps that filled them. Keeps every value
 * the draft has; only fills what is missing or of the wrong shape.
 */
export function publishableConfig(
  config: Partial<BotDraft> | null | undefined,
  fallbackName = 'Your assistant',
): BotDraft {
  const c = (config ?? {}) as Partial<BotDraft>;
  const base = BotDraftService.defaultDraft(
    typeof c.name === 'string' && c.name.trim() ? c.name : fallbackName,
  );
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const list = <T>(v: unknown, d: T[]): T[] =>
    Array.isArray(v) ? (v as T[]) : d;
  const filled = (v: unknown, d: string) =>
    typeof v === 'string' && v.trim() ? v : d;
  const branding = { ...base.branding, ...(c.branding ?? {}) };
  return {
    ...base,
    ...c,
    name: filled(c.name, base.name),
    assistantName: filled(c.assistantName, base.assistantName),
    introduction: str(c.introduction, ''),
    instructions: str(c.instructions, ''),
    ownerNotes: str(c.ownerNotes, ''),
    declineText: str(c.declineText, ''),
    purposeNote: str(c.purposeNote, ''),
    languages: list<string>(c.languages, []).length
      ? list<string>(c.languages, [])
      : base.languages,
    topics: list(c.topics, base.topics),
    suggestedQuestions: list<string>(c.suggestedQuestions, []),
    prechat: list(c.prechat, base.prechat),
    extraNever: list<string>(c.extraNever, []),
    knowledgeDocumentIds: list<string>(c.knowledgeDocumentIds, []),
    // An explicit null (no pack) is kept as it was; only a missing key gets the default.
    safetyPackId:
      'safetyPackId' in c ? (c.safetyPackId as never) : base.safetyPackId,
    branding: {
      ...branding,
      title: str(branding.title, ''),
      assistantName: str(branding.assistantName, ''),
    },
  } as BotDraft;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** One language: that one; several: each person's own, from the page's choice of two. */
/** Stage 5: the draft's languages as the live chatbot's `enabledLanguages`, when there are any. */
export function enabledLanguagesPatch(languages: string[] | null | undefined): {
  enabledLanguages?: string[];
} {
  const tags = [
    ...new Set(
      (languages ?? []).filter(
        (l) =>
          typeof l === 'string' &&
          /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l),
      ),
    ),
  ].slice(0, 30);
  return tags.length ? { enabledLanguages: tags } : {};
}

export function pageLanguage(languages: string[]): BotPageLanguage {
  if (languages.length > 1) return 'auto';
  return languages[0] === 'hi' ? 'hi' : 'en';
}
