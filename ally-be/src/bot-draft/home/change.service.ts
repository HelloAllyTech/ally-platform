import {
  ConflictException,
  Injectable,
  NotFoundException,
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
  ) {}

  async propose(chatbotId: string, request: string): Promise<Proposal> {
    const { chatbot } = await this.access.assert(
      chatbotId,
      ChatbotMemberRole.EDITOR,
    );
    const view = await this.home.get(chatbotId);
    const f = view.fields as Record<string, { value: unknown }>;
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
    });
    if (out.refused) return { refused: true, message: REFUSAL, changes: [] };
    return { refused: false, message: out.reply, changes: out.changes };
  }

  /** Applies a proposal. Refused as stale if a value changed since it was proposed. */
  async apply(chatbotId: string, changes: ProposedChange[]) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    for (const change of changes) {
      await this.write(chatbotId, change.field, change.before, change.after);
    }
    const event = await this.record(chatbotId, changes);
    this.checkup.scheduleAfterChange(chatbotId);
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
    this.checkup.scheduleAfterChange(chatbotId);
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
    const fields = view.fields as Record<
      string,
      { value: unknown; version: string }
    >;
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
