import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { usageContext } from '../../billing/context/usage-context';
import { UsageChannel, UsageKind } from '../../billing/enum/billing.enum';
import { fieldVersion } from '../working-copy/staged-fields';
import {
  CREDITS_GATE,
  creditsRequired,
  type CreditsGate,
} from '../working-copy/credits-gate';
import { randomUUID } from 'crypto';
import { LimitsService } from '../../billing/service/limits.service';
import { AiService } from '../../ai/service/ai.service';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import type { BotDraftEntity } from '../entity/bot-draft.entity';
import { BotDraftActor, BotDraftStatus } from '../enum/bot-draft.enum';
import { packFor } from '../safety-pack/safety-packs';
import { SafetyLockedError } from '../safety-pack/safety-lock';
import type { PatchOp } from '../type/bot-draft.type';
import { BotDraftService } from './bot-draft.service';
import type { Proposal, ProposedChange } from '../home/change.service';

/** The most own rules a draft keeps, and the longest one (BotDraftDto.extraNever). */
export const EXTRA_NEVER_LIMITS = { rules: 20, chars: 200 } as const;

/** ally-ai's field names for a change by chat, to the draft's own paths. */
const SCALAR_PATHS: Record<string, string> = {
  assistant_name: '/assistantName',
  introduction: '/introduction',
  tone: '/tone',
  instructions: '/instructions',
  decline_text: '/declineText',
  suggested_questions: '/suggestedQuestions',
};

/** The one fixed refusal (same words as the home flow). */
const REFUSAL = new SafetyLockedError('change by chat').message;

const CHANGE_PROMPT_CODES = ['ally_ai_builder_change'] as const;

/** The words a rule to avoid a topic is kept in. */
export const avoidTopicRule = (topic: string): string =>
  `Don't talk about ${topic.trim().replace(/[.\s]+$/, '')}.`;

const badRequest = (errorCode: string, message: string) =>
  new BadRequestException({ errorCode, message });

/**
 * SB1 "Edit by talking" on a setup in progress. While onboarding, the draft is the owner's source
 * of truth (every test re-projects it over the draft assistant), so a change by chat has to land
 * on the draft. Proposing is the same call to ally-ai as the home's change by chat; applying goes
 * through `BotDraftService.applyPatch` as the owner, so the path allow-list, the safety lock and
 * the version check all apply, and one change is one event that Undo can take back.
 */
@Injectable()
export class DraftChangeService {
  constructor(
    private readonly drafts: BotDraftService,
    private readonly ai: AiService,
    private readonly access: ChatbotAccessService,
    @Optional() private readonly limits?: LimitsService,
    // Stage 3: Copilot messages need credits (refused with `credits_required` at $0).
    @Optional() @Inject(CREDITS_GATE) private readonly credits?: CreditsGate,
  ) {}

  async propose(
    draftId: string,
    request: string,
  ): Promise<
    Proposal & { version: number; fieldVersions: Record<string, string> }
  > {
    const draft = await this.editable(draftId);
    const { chatbot } = await this.access.assert(
      draft.chatbotId!,
      ChatbotMemberRole.EDITOR,
    );
    if (
      this.credits &&
      !(await this.credits.creditsAvailable(chatbot.createdBy))
    ) {
      throw creditsRequired();
    }
    await this.drafts.touch(draft.id);
    // CR1: change by chat is an owner-side run on the creator's plan.
    await this.limits?.assertOwnerRun(
      chatbot.createdBy,
      `change_by_chat:${draft.chatbotId}:${randomUUID()}`,
      'change_by_chat',
    );
    const c = draft.draftConfig;
    const overrides = await this.promptOverrides();
    // Metered to the builder as a change by chat, attributed to this chatbot and draft.
    const out = await usageContext.run(
      {
        channel: UsageChannel.OWNER,
        runKind: UsageKind.CHANGE_BY_CHAT,
        chatbotId: draft.chatbotId,
        draftId: draft.id,
        creatorUserId: chatbot.createdBy ?? null,
      },
      () =>
        this.ai.proposeChange({
          request,
          current: {
            assistant_name: c.assistantName ?? '',
            introduction: c.introduction ?? '',
            tone: c.tone ?? '',
            instructions: c.instructions ?? '',
            decline_text: c.declineText ?? '',
            suggested_questions: c.suggestedQuestions ?? [],
            language: c.languages?.[0] ?? 'en',
            own_rules: c.extraNever ?? [],
            // A topic to avoid is kept as one of the owner's own rules on the draft.
            avoid_topics: [],
          },
          safety_rules: packFor(c.safetyPackId)?.rules ?? [],
          ...overrides,
        }),
    );
    // Stage 3: the request and Copilot's answer are kept on the draft, so the chat comes back on
    // a reload or another browser. A failure to keep them never fails the proposal.
    await this.drafts
      .appendTranscriptLines(draft.id, [
        { role: 'owner', text: request, kind: 'copilot' },
        {
          role: 'builder',
          text: out.refused ? REFUSAL : out.reply,
          kind: 'copilot',
        },
      ])
      .catch(() => undefined);
    if (out.refused) {
      return {
        refused: true,
        message: REFUSAL,
        changes: [],
        version: draft.version,
        fieldVersions: {},
      };
    }
    // Only what the draft can take; anything else would be refused on apply.
    const changes = out.changes.filter((change) => this.mapped(change.field));
    return {
      refused: false,
      message: out.reply,
      changes,
      version: draft.version,
      // Stage 3: the version of each field the proposal touches, so Apply checks only those (a
      // pending edit to another field never makes the proposal stale).
      fieldVersions: Object.fromEntries(
        [...new Set(changes.map((change) => this.pathOf(String(change.field))))]
          .filter(Boolean)
          .map((path) => [
            path,
            fieldVersion(c[path as keyof typeof c] ?? null),
          ]),
      ),
    };
  }

  /** The working-copy field a proposed change writes. */
  private pathOf(field: string): string {
    if (field === 'language' || field === 'languages') return 'languages';
    if (field === 'add_rule' || field === 'avoid_topic') return 'extraNever';
    return (SCALAR_PATHS[field] ?? '').replace(/^\//, '');
  }

  /**
   * Applies a proposal as one change. With `fieldVersions` (stage 3) only the fields it touches
   * are checked: 409 `stale_field` with that field's current value and version. Without, the SB1
   * check on the whole draft's version: 409 `stale_version` if the draft moved since.
   */
  async apply(
    draftId: string,
    changes: ProposedChange[],
    version?: number,
    fieldVersions?: Record<string, string>,
  ) {
    let draft = await this.editable(draftId);
    await this.access.assert(draft.chatbotId!, ChatbotMemberRole.EDITOR);
    const perField = fieldVersions && Object.keys(fieldVersions).length > 0;
    if (!perField && version === undefined) {
      throw badRequest(
        'version_required',
        'Send the version the proposal was made on.',
      );
    }
    for (let attempt = 0; ; attempt++) {
      if (perField) {
        for (const [field, expected] of Object.entries(fieldVersions!)) {
          const current =
            draft.draftConfig[field as keyof typeof draft.draftConfig] ?? null;
          if (fieldVersion(current) !== expected) {
            throw new ConflictException({
              errorCode: 'stale_field',
              message:
                'This changed while you were editing. Here is what it says now.',
              details: {
                field,
                value: current,
                version: fieldVersion(current),
              },
            });
          }
        }
      }
      const ops = this.opsFor(draft, changes);
      try {
        const { draft: saved, event } = await this.drafts.applyPatch(
          draft,
          ops,
          BotDraftActor.OWNER,
          {
            target: 'draft',
            expectedVersion: perField ? undefined : version,
            summary: `Changed by chat: ${changes.map((c) => c.field).join(', ')}`,
            workingCopy: true,
          },
        );
        await this.drafts.touch(saved.id);
        await this.drafts
          .appendTranscriptLines(saved.id, [
            {
              role: 'note',
              // COPY: needs approval
              text: `Applied: ${changes.map((c) => String(c.field)).join(', ')}`,
              kind: 'copilot',
            },
          ])
          .catch(() => undefined);
        return { eventId: event.id, version: saved.version };
      } catch (error) {
        // Another field's edit moved the draft first: re-read and re-check this proposal's fields.
        const stale =
          perField &&
          error instanceof ConflictException &&
          (error.getResponse() as { errorCode?: string })?.errorCode ===
            'stale_version';
        if (!stale || attempt >= 3) throw error;
        draft = await this.editable(draftId);
      }
    }
  }

  /** Takes back a change made by chat, unless a later change touched the same things. */
  async undo(draftId: string, eventId: string) {
    const draft = await this.editable(draftId);
    await this.access.assert(draft.chatbotId!, ChatbotMemberRole.EDITOR);
    const target = draft.events.find((e) => e.id === eventId);
    if (!target || target.actor !== BotDraftActor.OWNER) {
      throw new NotFoundException('That change was not found.');
    }
    const saved = await this.drafts.undo(draft, eventId);
    const undone = saved.events.find((e) => e.id === eventId)?.undoneBy;
    return { eventId: undone ?? eventId, version: saved.version };
  }

  private mapped(field: string): boolean {
    return (
      field in SCALAR_PATHS ||
      field === 'language' ||
      field === 'languages' ||
      field === 'add_rule' ||
      field === 'avoid_topic'
    );
  }

  /** The patch for a proposal. Anything outside the mapping is refused before anything is written. */
  private opsFor(draft: BotDraftEntity, changes: ProposedChange[]): PatchOp[] {
    const ops: PatchOp[] = [];
    const rules = [...(draft.draftConfig.extraNever ?? [])];
    for (const change of changes) {
      const field = String(change.field);
      if (!this.mapped(field)) {
        throw badRequest('field_not_allowed', "That can't be changed here.");
      }
      if (field === 'language' || field === 'languages') {
        // Stage 3: languages are a list. A list (or "en, hi") replaces it; one tag becomes the
        // first language and the others are kept, so "answer in Hindi" never drops English.
        const languages = languagesAfter(
          change.after,
          draft.draftConfig.languages ?? [],
        );
        if (!languages.length) {
          throw badRequest('invalid_change', 'Choose at least one language.');
        }
        ops.push({ op: 'replace', path: '/languages', value: languages });
      } else if (field === 'add_rule' || field === 'avoid_topic') {
        const text =
          field === 'add_rule'
            ? String(change.after ?? '').trim()
            : avoidTopicRule(String(change.after ?? ''));
        if (!text) throw badRequest('invalid_change', 'That rule is empty.');
        if (text.length > EXTRA_NEVER_LIMITS.chars) {
          throw badRequest('rule_too_long', 'That rule is too long.');
        }
        if (rules.includes(text)) continue; // already there
        if (rules.length >= EXTRA_NEVER_LIMITS.rules) {
          throw badRequest(
            'too_many_rules',
            `You can keep up to ${EXTRA_NEVER_LIMITS.rules} rules of your own.`,
          );
        }
        rules.push(text);
        ops.push({ op: 'add', path: '/extraNever/-', value: text });
      } else {
        ops.push({
          op: 'replace',
          path: SCALAR_PATHS[field],
          value: change.after,
        });
      }
    }
    if (!ops.length) {
      throw badRequest('nothing_to_change', 'That is already set.');
    }
    return ops;
  }

  /** The caller's own, still-in-progress setup that has its assistant. */
  private async editable(draftId: string): Promise<BotDraftEntity> {
    const draft = await this.drafts.get(draftId);
    if (!draft.chatbotId) {
      throw new ConflictException({
        errorCode: 'not_ready',
        message: 'This setup has no assistant yet.',
      });
    }
    // Stage 3: a published setup's draft is the live chatbot's working copy; only an abandoned
    // one is closed.
    if (draft.status === BotDraftStatus.ABANDONED) {
      throw new ConflictException({
        errorCode: 'setup_finished',
        message: 'This setup is finished. Change the assistant from its home.',
      });
    }
    return draft;
  }

  private async promptOverrides(): Promise<{
    prompts?: Record<string, unknown>;
  }> {
    try {
      const prompts = (await this.ai.getPromptOverrides([
        ...CHANGE_PROMPT_CODES,
      ])) as Record<string, unknown>;
      return prompts ? { prompts } : {};
    } catch {
      return {}; // ally-ai falls back to its default prompt text
    }
  }
}

/** The most languages a working copy keeps. */
export const MAX_LANGUAGES = 10;

/** A language change as a list: see `opsFor`. Tags are BCP-47-ish, deduplicated, at most 10. */
export function languagesAfter(after: unknown, current: string[]): string[] {
  const clean = (tag: unknown) =>
    String(tag ?? '')
      .trim()
      .replace(/_/g, '-');
  const valid = (tag: string) =>
    /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag);
  let list: string[];
  if (Array.isArray(after)) {
    list = after.map(clean);
  } else {
    const parts = String(after ?? '')
      .split(/\s*(?:,|;|\band\b)\s*/i)
      .map(clean)
      .filter(Boolean);
    list = parts.length === 1 ? [parts[0], ...current] : parts;
  }
  return [...new Set(list.filter(valid))].slice(0, MAX_LANGUAGES);
}
