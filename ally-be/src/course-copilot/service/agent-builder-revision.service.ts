import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  parseFirstJsonObject,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  AGENT_BUILDER_WIZARD_REVISE_PLAN,
  renderPrompt,
} from 'src/prompt/contracts';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';

/** One field the wizard can rewrite, as it is on the form now. */
export interface RevisableField {
  /** A field id the wizard knows ("roleInstruction", "openingStatements", "state:<id>"). */
  id: string;
  /** What the field is, in words. */
  label: string;
  value: string;
}

export interface RevisionPlan {
  fields: { id: string; change: string }[];
  reply: string;
}

/** The client's details (name, age, gender…) as one JSON field; see `EnhanceableField`. */
export const CHARACTER_DETAILS_FIELD_ID = 'characterDetails';

/**
 * A request about who the client is: their gender or age (a rename the planner sees itself, in the
 * character details). Pronouns alone are not enough
 * ("make her more guarded" is about how she talks, not who she is).
 */
const IDENTITY_CHANGE =
  /\b(boy|girl|man|woman|male|female|non-?binary|gender|pronouns?|age|aged|older|younger|years?[ -]old|teen(ager)?|child|adult)\b/i;

const MAX_FIELDS = 30;
const MAX_FIELD_CHARS = 1500;
const PLAN_MAX_TOKENS = 1200;

/**
 * Studio's Agent Builder wizard, after generating: a trainer's change request in their own words
 * becomes a plan of which fields to rewrite and how. The wizard rewrites only those (enhance-field)
 * and keeps every other field, including the trainer's own edits.
 */
@Injectable()
export class AgentBuilderRevisionService {
  private readonly logger = LoggerService.getInstance(
    AgentBuilderRevisionService.name,
  );

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
  ) {}

  async plan(
    instruction: string,
    fields: RevisableField[],
    usageMetadata: Record<string, any> = {},
  ): Promise<RevisionPlan> {
    const offered = fields
      .filter((f) => f.id && f.value?.trim())
      .slice(0, MAX_FIELDS);
    if (!offered.length) {
      return { fields: [], reply: 'There is nothing to change yet.' };
    }
    const template =
      (await this.promptSharedService.getPromptByCode(
        AGENT_BUILDER_WIZARD_REVISE_PLAN.code,
      )) ?? '';
    if (!template) {
      throw new Error(
        `Prompt template not found: ${AGENT_BUILDER_WIZARD_REVISE_PLAN.code}`,
      );
    }
    const response = await this.llmCompletion.complete({
      taskId: 'agent-builder-revise-plan',
      task: LlmTask.AGENT_BUILDER_REVISE_PLAN,
      promptCode: AGENT_BUILDER_WIZARD_REVISE_PLAN.code,
      prompt: renderPrompt(AGENT_BUILDER_WIZARD_REVISE_PLAN, template, {
        instruction: instruction.trim().slice(0, 2000),
        fields: offered
          .map(
            (f) =>
              `[${f.id}] ${f.label}:\n${f.value.trim().slice(0, MAX_FIELD_CHARS)}`,
          )
          .join('\n\n'),
      }),
      maxTokens: PLAN_MAX_TOKENS,
      jsonMode: true,
      usageMetadata,
    });
    return withDependentFields(
      parseRevisionPlan(
        response.text,
        offered.map((f) => f.id),
      ),
      instruction,
      offered.map((f) => f.id),
    );
  }
}

/**
 * A change to who the client is runs through the whole roleplay, not one field: a boy who
 * becomes a girl needs a new name, gender identity and voice, and every text that names or
 * describes him (role instruction, backstory, description, opening lines, states, reminders)
 * rewritten to match. The planner may pick only the obvious field, so this rule is in code:
 * a request about the client's identity always changes the character details, and once those
 * change, every other field is rewritten for consistency (each keeps what does not depend on
 * the change).
 */
export function withDependentFields(
  plan: RevisionPlan,
  instruction: string,
  offeredIds: string[],
): RevisionPlan {
  if (!offeredIds.includes(CHARACTER_DETAILS_FIELD_ID)) return plan;
  let fields = plan.fields;
  let character = fields.find((f) => f.id === CHARACTER_DETAILS_FIELD_ID);
  if (!character && IDENTITY_CHANGE.test(instruction)) {
    character = {
      id: CHARACTER_DETAILS_FIELD_ID,
      change: instruction.trim().slice(0, 500),
    };
    fields = [character, ...fields];
  }
  if (!character) return plan;
  // The character details first: the wizard reads the new details before the rest land.
  fields = [character, ...fields.filter((f) => f !== character)];
  const chosen = new Set(fields.map((f) => f.id));
  const consistency =
    `Keep this consistent with the change to the client (${character.change}): where this text ` +
    'names or describes the client, update their name, pronouns, gendered words, age and what ' +
    'follows from them, such as how they speak of a partner. Do not add details this text did not ' +
    'have, and leave anything that does not depend on the client as it is.';
  const dependents = offeredIds
    .filter((id) => !chosen.has(id))
    .map((id) => ({ id, change: consistency }));
  const expanded = fields.map((f) =>
    f === character || f.change.includes(consistency)
      ? f
      : { ...f, change: `${f.change} ${consistency}` },
  );
  return {
    fields: [...expanded, ...dependents],
    reply:
      plan.fields.length && plan.reply
        ? plan.reply
        : 'I will change the character and update everything that describes them to match.',
  };
}

/**
 * The model's plan, held to the fields it was offered (an invented id is dropped, a field listed
 * twice is kept once). An unreadable answer is an empty plan, never a rewrite of everything.
 */
export function parseRevisionPlan(
  raw: string,
  offeredIds: string[],
): RevisionPlan {
  const parsed = parseFirstJsonObject(stripMarkdownFences(raw ?? '')) ?? {};
  const allowed = new Set(offeredIds);
  const seen = new Set<string>();
  const fields = (Array.isArray(parsed.fields) ? parsed.fields : [])
    .map((f: any) => ({
      id: typeof f?.id === 'string' ? f.id.trim() : '',
      change: typeof f?.change === 'string' ? f.change.trim() : '',
    }))
    .filter((f: { id: string; change: string }) => {
      if (!allowed.has(f.id) || seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
  const reply =
    typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim()
      : fields.length
        ? 'I will change the fields below and keep everything else.'
        : 'Nothing in this roleplay needs to change for that.';
  return { fields, reply };
}
