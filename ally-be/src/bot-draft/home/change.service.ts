import { LimitsService } from 'src/billing/service/limits.service';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AiService } from '../../ai/service/ai.service';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { BotDraftActor } from '../enum/bot-draft.enum';
import { CheckupService } from '../checkup/checkup.service';
import { packFor } from '../safety-pack/safety-packs';
import { SafetyLockedError } from '../safety-pack/safety-lock';
import { BotDraftService } from '../service/bot-draft.service';
import type { DraftEvent } from '../type/bot-draft.type';
import { AssistantHomeService } from './assistant-home.service';
import { versionOf } from './home-fields';

/** A field change by chat can propose, by ally-ai's name → the home's field. */
/**
 * TF1 F8: the working copy's key for each field change by chat can make. The owner sees and
 * publishes the working copy (Build's form); writing only the live row lost the change at Go live.
 */
const WORKING_COPY_KEYS: Record<string, string> = {
  assistantName: 'assistantName',
  introduction: 'introduction',
  tone: 'tone',
  instructions: 'instructions',
  declineText: 'declineText',
  suggestedQuestions: 'suggestedQuestions',
};

const FIELDS: Record<string, string> = {
  assistant_name: 'assistantName',
  introduction: 'introduction',
  tone: 'tone',
  instructions: 'instructions',
  decline_text: 'declineText',
  suggested_questions: 'suggestedQuestions',
  language: 'language',
};

export interface ProposedChange {
  field: string;
  before?: unknown;
  after: unknown;
}

export interface Proposal {
  refused: boolean;
  message: string;
  changes: ProposedChange[];
}

const REFUSAL = new SafetyLockedError('change by chat').message;

/** A request that is about the suggested questions (the chips under the chat). */
const ABOUT_QUESTIONS = /\b(suggest\w*|questions?|starters?|chips?|faqs?)\b/i;

/**
 * TF1 round 2: the model sometimes rewrites the suggested questions when asked for something
 * else. They change only when the request mentions them; every other proposed change stays.
 */
export function onlyAskedFor(
  request: string,
  changes: ProposedChange[],
): ProposedChange[] {
  if (ABOUT_QUESTIONS.test(request)) return changes;
  return changes.filter(
    (c) => (FIELDS[c.field] ?? c.field) !== 'suggestedQuestions',
  );
}

/** Sent with each proposal, so an edit in Manage Prompts takes effect (chunk H0). */
const CHANGE_PROMPT_CODES = ['ally_ai_builder_change'] as const;

/**
 * Change by chat on the assistant home (chunk 20a-2): the owner asks, ally-ai proposes a before
 * and after, and nothing changes until the owner applies it. Applying goes through the home's own
 * field saves (one validation, the version check), is recorded with its inverse, and can be
 * undone. Safety can't be weakened: a request to is refused, and no change can name the pack.
 */
@Injectable()
export class ChangeService {
  constructor(
    private readonly home: AssistantHomeService,
    private readonly drafts: BotDraftService,
    private readonly ai: AiService,
    private readonly access: ChatbotAccessService,
    private readonly checkup: CheckupService,
    // CR1: owner-side runs and tokens (optional, so existing specs build without it).
    @Optional() private readonly limits?: LimitsService,
  ) {}

  async propose(chatbotId: string, request: string): Promise<Proposal> {
    const { chatbot } = await this.access.assert(
      chatbotId,
      ChatbotMemberRole.EDITOR,
    );
    // CR1: change by chat is an owner-side run on the creator's plan.
    await this.limits?.assertOwnerRun(
      chatbot.createdBy,
      `change_by_chat:${chatbotId}:${randomUUID()}`,
      'change_by_chat',
    );
    const view = await this.home.get(chatbotId);
    const f = await this.withWorkingCopy(
      chatbotId,
      view.fields as Record<string, { value: unknown; version: string }>,
    );
    const prompts = await this.prompts();
    const out = await this.ai.proposeChange({
      request,
      current: {
        assistant_name: String(f.assistantName?.value ?? ''),
        introduction: String(f.introduction?.value ?? ''),
        tone: String(f.tone?.value ?? ''),
        instructions: String(f.instructions?.value ?? ''),
        decline_text: String(f.declineText?.value ?? ''),
        suggested_questions: (f.suggestedQuestions?.value as string[]) ?? [],
        language: String(f.language?.value ?? 'en'),
        own_rules: chatbot.rules?.never ?? [],
        avoid_topics: (f.avoidTopics?.value as string[]) ?? [],
      },
      safety_rules: packFor(chatbot.safetyPack)?.rules ?? [],
      ...(prompts ? { prompts } : {}),
    });
    if (out.refused) return { refused: true, message: REFUSAL, changes: [] };
    return {
      refused: false,
      message: out.reply,
      changes: onlyAskedFor(request, out.changes),
    };
  }

  private async prompts(): Promise<Record<string, unknown> | undefined> {
    try {
      return (await this.ai.getPromptOverrides([
        ...CHANGE_PROMPT_CODES,
      ])) as Record<string, unknown>;
    } catch {
      return undefined; // ally-ai falls back to its default prompt text
    }
  }

  /** Applies a proposal. Refused as stale if a value changed since it was proposed. */
  async apply(chatbotId: string, changes: ProposedChange[]) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    for (const change of changes) {
      await this.write(chatbotId, change.field, change.before, change.after);
    }
    const event = await this.record(chatbotId, changes);
    return { eventId: event.id };
  }

  /** Puts a change back, as long as nothing changed those fields since. */
  async undo(chatbotId: string, eventId: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const draft = await this.drafts.findByChatbot(chatbotId);
    const event = draft?.events.find(
      (e) => e.id === eventId && e.kind === 'change' && !e.undoneBy,
    );
    if (!draft || !event)
      throw new NotFoundException('That change was not found.');
    const changes = (event.ops ?? []).map((op) => op.value as ProposedChange);
    for (const change of [...changes].reverse()) {
      await this.write(
        chatbotId,
        change.field,
        change.after,
        change.before,
        true,
      );
    }
    const undo: DraftEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: BotDraftActor.OWNER,
      kind: 'undo',
      summary: `Undid: ${event.summary}`,
    };
    const fresh = (await this.drafts.findByChatbot(chatbotId)) ?? draft;
    await this.drafts.update(
      fresh,
      {
        events: fresh.events.map((e) =>
          e.id === eventId ? { ...e, undoneBy: undo.id } : e,
        ),
      },
      [undo],
    );
    return { eventId: undo.id };
  }

  private async write(
    chatbotId: string,
    field: string,
    from: unknown,
    to: unknown,
    undoing = false,
  ): Promise<void> {
    if (field === 'add_rule') {
      const { safety } = await this.home.get(chatbotId);
      const own = safety.rules.filter((r) => !r.fixed);
      const text = String(undoing ? from : to);
      if (!undoing) {
        await this.home.changeRule(
          chatbotId,
          { op: 'add', text, version: safety.version } as never,
          { record: false },
        );
        return;
      }
      const rule = own.find((r) => r.text === text);
      if (!rule) return; // already gone
      await this.home.changeRule(
        chatbotId,
        { op: 'remove', id: rule.id, version: safety.version } as never,
        { record: false },
      );
      return;
    }
    const view = await this.home.get(chatbotId);
    const fields = await this.withWorkingCopy(
      chatbotId,
      view.fields as Record<string, { value: unknown; version: string }>,
    );
    if (field === 'avoid_topic') {
      const current = (fields.avoidTopics?.value as string[]) ?? [];
      const topic = String(undoing ? from : to);
      const next = undoing
        ? current.filter((t) => t !== topic)
        : [...current, topic];
      await this.home.saveField(
        chatbotId,
        {
          field: 'avoidTopics',
          value: next,
          version: fields.avoidTopics.version,
        },
        // Recorded once, as this change (below), not again as an edit by hand.
        { record: false },
      );
      return;
    }
    const name = FIELDS[field];
    if (!name) throw new SafetyLockedError(`unknown field ${field}`);
    if (versionOf(fields[name].value) !== versionOf(from)) {
      throw new ConflictException({
        errorCode: 'stale',
        message:
          'This changed while you were editing. Here is what it says now.',
      });
    }
    await this.home.saveField(
      chatbotId,
      { field: name, value: to, version: fields[name].version },
      { record: false },
    );
    // TF1 F8: and the working copy, which the form shows and Go live publishes.
    const key = WORKING_COPY_KEYS[name];
    const draft = key ? await this.drafts.findByChatbot(chatbotId) : null;
    if (draft && key) {
      await this.drafts.update(draft, {
        draftConfig: { ...draft.draftConfig, [key]: to } as never,
      });
    }
  }

  /**
   * TF1 F8: the fields as the owner sees them: the working copy's value where it has one (before
   * go-live the live row is still empty, so the preview's "before" read "—").
   */
  private async withWorkingCopy(
    chatbotId: string,
    fields: Record<string, { value: unknown; version: string }>,
  ): Promise<Record<string, { value: unknown; version: string }>> {
    const draft = await this.drafts.findByChatbot(chatbotId).catch(() => null);
    const config = (draft?.draftConfig ?? {}) as Record<string, unknown>;
    const out = { ...fields };
    for (const [name, key] of Object.entries(WORKING_COPY_KEYS)) {
      const value = config[key];
      const has = Array.isArray(value)
        ? value.length > 0
        : typeof value === 'string' && value.trim() !== '';
      if (has) out[name] = { ...(out[name] ?? { version: '' }), value };
    }
    return out;
  }

  private async record(chatbotId: string, changes: ProposedChange[]) {
    const draft = await this.drafts.findByChatbot(chatbotId);
    const event: DraftEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: BotDraftActor.OWNER,
      kind: 'change',
      // Who, and from where, for the History (chunk 20d-2).
      userId: Number(ExecutionManager.getUserId() ?? 0) || null,
      origin: 'panel',
      summary: changes.map((c) => c.field).join(', '),
      ops: changes.map((c) => ({
        op: 'replace',
        path: `/${c.field}`,
        value: c,
      })),
    };
    if (draft) await this.drafts.update(draft, {}, [event]);
    return event;
  }
}
