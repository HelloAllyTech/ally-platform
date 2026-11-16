import { Inject, Injectable } from '@nestjs/common';
import type { ChatbotSettingsOverride } from '../type/chatbot.type';
import type { AgentRunClaims } from './agent-run-token.service';

/**
 * What a gateway tool may act on: only the token's bot, conversation and contact. No tool reads a
 * bot, conversation or contact id from its input.
 */
export type AgentToolContext = Pick<
  AgentRunClaims,
  'chatbotId' | 'conversationId' | 'runId' | 'contactId'
>;

/**
 * What a tool did. A failure is an answer the agent reads, never a thrown error: a short code, and
 * for a list refusal (chunk 6) its message and alternatives in `result`.
 */
export type AgentToolOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; result?: Record<string, unknown> };

/**
 * One tool the chatbot agent can call through the gateway (chunk 3b). Adding a tool is one module
 * here, listed in `AGENT_GATEWAY_TOOLS`, and one in ally-ai's `agent_runtime/tools/`.
 */
export interface AgentGatewayTool<Input = unknown> {
  /** As ally-ai names it, and as a bot's `abilities` lists it. */
  readonly name: string;
  /** The input, checked: throws BadRequestException for a bad or unknown field. */
  parse(input: Record<string, unknown>): Input;
  run(ctx: AgentToolContext, input: Input): Promise<AgentToolOutcome>;
}

/** The tools the gateway serves, provided by the chatbot module. */
export const AGENT_GATEWAY_TOOLS = Symbol('AGENT_GATEWAY_TOOLS');

/** One answer to a bot's `abilities[tool]`. A tool that isn't listed is `never` (14a adds `ask_me_first`). */
export const ABILITY_VALUES = ['do_it', 'never'] as const;
export type Ability = (typeof ABILITY_VALUES)[number];

/**
 * Whether this bot has the tool on: `do_it` in its OWN stored settings. Never the effective,
 * default or platform settings, which a WhatsApp-settings editor can write for every bot.
 */
export const abilityOn = (
  stored: ChatbotSettingsOverride | null | undefined,
  tool: string,
): boolean => stored?.abilities?.[tool] === 'do_it';

@Injectable()
export class AgentToolRegistry {
  private readonly byName: Map<string, AgentGatewayTool>;

  constructor(@Inject(AGENT_GATEWAY_TOOLS) tools: AgentGatewayTool[]) {
    this.byName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  get(name: string): AgentGatewayTool | undefined {
    return this.byName.get(name);
  }

  /** The tools this bot has on, from its stored settings: what a run's token may list. */
  servedFor(stored: ChatbotSettingsOverride | null | undefined): string[] {
    return [...this.byName.keys()].filter((name) => abilityOn(stored, name));
  }
}
