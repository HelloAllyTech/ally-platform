import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  AgentLlmProviderFactory,
  normaliseAgentProvider,
  providerForModel,
} from 'src/llm-agent/service/agent-llm.factory';
import {
  loadPromptTemplate,
  promptModelChoice,
} from 'src/common/util/prompt-template.util';
import { BUILDER_RESEARCH_SYSTEM, renderPrompt } from 'src/prompt/contracts';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { AgentTurnResult } from 'src/llm-agent/type/agent-llm.type';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderPrdService } from './builder-prd.service';
import { BuilderKnowledgeService } from './builder-knowledge.service';
import { BuilderPlatformContextService } from './builder-platform-context.service';
import { BuilderInterviewToolsService } from './builder-interview-tools.service';
import { BUILDER_MAX_TOKENS } from '../constants/builder.constants';

/** What the admin asked for. */
export type BuilderResearchMode = 'technical_plan' | 'draft_prd';

/**
 * "Research this for me": one server-side pass that reads the codebase and
 * writes into the PRD, instead of the admin waiting a turn per tool call.
 *
 * The interview already has every tool this needs. What it does not have is
 * permission to spend twenty minutes using them — a streamed turn is a
 * conversation, and a conversation where the other party goes quiet for twenty
 * tool calls is a bad one. So this is the same tools with a different budget
 * and no expectation of a reply.
 *
 * Deliberately one agentic loop rather than a fan-out of parallel researchers.
 * With a bounded tool budget the single loop captures most of the value at a
 * fraction of the complexity, and the failure mode of the fan-out — several
 * agents writing to one PRD at once — is the expensive kind. If this proves
 * too slow in practice, sharding it per repo is the upgrade.
 */
@Injectable()
export class BuilderResearchService {
  private readonly logger = LoggerService.getInstance(
    BuilderResearchService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly prdService: BuilderPrdService,
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly toolsService: BuilderInterviewToolsService,
    private readonly llmUsage: LlmUsageService,
    private readonly agentLlmFactory: AgentLlmProviderFactory,
    /** The pass's instructions and, when it names one, its model. */
    private readonly prompts: PromptSharedService,
    @Optional()
    private readonly platformContext?: BuilderPlatformContextService,
  ) {}

  /**
   * Which model runs this pass.
   *
   * The research prompt's row wins when it names a model, the same knob the
   * interviewer uses; otherwise the configured tier, with the provider
   * following from the model id.
   *
   * The INTERVIEW tier, not the mechanical one: this pass drives the same
   * tool belt the interview does and writes to the same PRD, and quietly
   * moving it to a cheaper model while migrating the client would have been a
   * behaviour change wearing a refactor's clothes.
   */
  private async resolveModel(): Promise<{ provider: string; model: string }> {
    const choice = await promptModelChoice(
      this.prompts,
      BUILDER_RESEARCH_SYSTEM.code,
    );
    if (choice.model) {
      const chosen =
        normaliseAgentProvider(choice.provider) ??
        providerForModel(choice.model);
      if (chosen) return { provider: chosen, model: choice.model };
      this.logger.warn(
        `Builder research prompt names model "${choice.model}" with no ` +
          'provider this service can run; falling back to config.',
      );
    }
    const model = this.configService.builder.interviewModel;
    const provider = providerForModel(model);
    if (!provider) {
      throw new Error(
        `No provider is known for Builder research model "${model}". Set ` +
          'BUILDER_MECHANICAL_MODEL to a model whose id names one.',
      );
    }
    return { provider, model };
  }

  /**
   * Run the pass and write what it finds into the PRD.
   *
   * Writes go through `BuilderPrdService`, so the result is an ordinary
   * agent-authored version: it shows in the version history, it is diffable,
   * and an admin who dislikes it can revert it like any other edit. That is
   * the whole reason not to special-case the storage.
   */
  async run(
    session: BuilderSession,
    userId: number,
    mode: BuilderResearchMode,
  ): Promise<{ iterations: number; patched: boolean }> {
    if (
      session.status === 'BUILDING' ||
      session.status === 'WAITING_FOR_INPUT'
    ) {
      throw new BadRequestException(
        'A build is reading this PRD right now, so research cannot rewrite it.',
      );
    }

    const doc = await this.prdService.getOrCreateDoc(
      session.id,
      userId,
      session.title,
    );
    const { provider: providerName, model } = await this.resolveModel();
    const provider = this.agentLlmFactory.create(providerName, model);
    const [template, context, platformRules, platformMap] = await Promise.all([
      loadPromptTemplate(this.prompts, BUILDER_RESEARCH_SYSTEM.code),
      this.knowledgeService.buildContextBlock(session.repos ?? undefined),
      this.knowledgeService.platformRules(),
      this.platformContext?.render() ?? Promise.resolve(''),
    ]);

    // The read-only research tools plus `update_prd`. `ask_admin` is
    // deliberately absent: nobody is watching this run, and a question it
    // asked would stop the pass and be seen by no one.
    const tools = this.toolsService
      .getToolDefinitions()
      .filter((tool: any) => tool.name !== 'ask_admin');

    const messages: any[] = [
      { role: 'user', content: this.openingInstruction(mode, doc.draft) },
    ];

    const instructions = renderPrompt(BUILDER_RESEARCH_SYSTEM, template, {});

    let iterations = 0;
    let patched = false;
    const maxIterations = Math.max(
      8,
      Number(this.configService.builder.maxToolIterations) || 16,
    );

    while (iterations < maxIterations) {
      iterations += 1;

      let turn: AgentTurnResult | null = null;
      for await (const event of provider.stream({
        model,
        maxTokens: BUILDER_MAX_TOKENS,
        // The context block is the cacheable half — large, and identical on
        // every iteration of this loop — so it is marked and kept last. The
        // system prompt ahead of it is small and equally stable.
        system: [
          // Rules beside the instructions: a research pass patches the
          // technical plan, and is held to the same platform as anything else.
          { text: `${instructions}\n\n${platformRules}` },
          { text: context, cache: true },
          ...(platformMap.trim() ? [{ text: platformMap, cache: true }] : []),
        ],
        messages: messages as any,
        tools,
      })) {
        if (event.type === 'final') turn = event.message;
      }
      if (!turn) {
        throw new Error(
          `The ${provider.name} model returned no response for this pass.`,
        );
      }

      void this.llmUsage.record({
        provider: providerName,
        model,
        task: LlmTask.BUILDER_RESEARCH,
        promptTokens: turn.usage.inputTokens,
        completionTokens: turn.usage.outputTokens,
        totalTokens: turn.usage.inputTokens + turn.usage.outputTokens,
        cachedTokens: turn.usage.cachedTokens,
        cacheCreationTokens: turn.usage.cacheCreationTokens,
        metadata: { builderSessionId: session.id, mode, iteration: iterations },
      });

      const toolUses = turn.content.filter(
        (block: any) => block.type === 'tool_use',
      );
      if (!toolUses.length) break;

      messages.push({ role: 'assistant', content: turn.content });

      const results: any[] = [];
      for (const toolUse of toolUses as any[]) {
        try {
          const result = await this.toolsService.execute(
            toolUse.name,
            toolUse.input,
            { session, doc, userId },
          );
          if (toolUse.name === 'update_prd') patched = true;
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result ?? { ok: true }),
          });
        } catch (error) {
          // Same contract as the interview: a tool error becomes a result the
          // model can read and work around, not an exception that ends the run.
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          });
        }
      }
      messages.push({ role: 'user', content: results });
    }

    this.logger.info(
      `Builder research (${mode}) on session ${session.id}: ${iterations} iteration(s), PRD ${
        patched ? 'updated' : 'unchanged'
      }.`,
    );
    return { iterations, patched };
  }

  private openingInstruction(
    mode: BuilderResearchMode,
    prd: Record<string, any>,
  ): string {
    const current = JSON.stringify(prd ?? {}, null, 2);

    if (mode === 'draft_prd') {
      return [
        'Draft this PRD from what you can find in the code.',
        '',
        'The admin has said what they want in the title and summary and little',
        'else. Read enough of the codebase to fill in a first draft they can',
        'correct — a draft to react to is worth far more than an empty document',
        'and a list of questions.',
        '',
        'Write the prose sections, the requirements with observable acceptance',
        'criteria, and the technical plan. Where you had to assume something,',
        'record it as an **unconfirmed** assumption rather than stating it as',
        'fact: the admin will confirm or correct each one.',
        '',
        '<current_prd>',
        current,
        '</current_prd>',
      ].join('\n');
    }

    return [
      'Fill in the technical plan for this PRD.',
      '',
      'The requirements are already written. Your job is the part that needs',
      'the codebase: which repos this lands in, which files and modules change',
      'in each, what the data model and API need, and what else depends on the',
      'code you are about to change.',
      '',
      'Do not rewrite the requirements or the prose sections — the admin wrote',
      'those and changing them under them is not what was asked for.',
      '',
      '<current_prd>',
      current,
      '</current_prd>',
    ].join('\n');
  }
}
