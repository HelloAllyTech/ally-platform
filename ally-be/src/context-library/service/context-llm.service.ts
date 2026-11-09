import { Injectable } from '@nestjs/common';
import { computeCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { parseJsonObject } from 'src/builder/util/builder-json.util';
import { AppConfigService } from 'src/config/config.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  CONTEXT_LIBRARY_ADJUDICATE_SYSTEM,
  CONTEXT_LIBRARY_CITATION_CHECK_SYSTEM,
  CONTEXT_LIBRARY_QUERY_PLAN_SYSTEM,
  CONTEXT_LIBRARY_RERANK_SYSTEM,
  CONTEXT_LIBRARY_CONSOLIDATE_SYSTEM,
  CONTEXT_LIBRARY_CRITIC_SYSTEM,
  CONTEXT_LIBRARY_ENRICH_SYSTEM,
  CONTEXT_LIBRARY_OVERVIEW_SYSTEM,
} from 'src/prompt/contracts';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';

export interface LlmSpend {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
}

export interface LlmJsonResult<T> {
  value: T | null;
  spend: LlmSpend;
}

/**
 * Every model call the Context Library makes, in one place.
 *
 * Extraction and the overview run on Builder's interview model (the owner's decision: the
 * chunks are what everything downstream reads, so they get the strong model). The checks
 * around them — critic, adjudicator, consolidation, enrichment — are mechanical and high
 * volume, so they run on the fast tier. Every call reads its prompt's live text and model
 * from the Skills Store first, so either can be changed without a deploy.
 *
 * Each call returns its spend, because a document's cost is a first-class number here: the
 * first job of phase 1 is to measure what one real document costs before anything scales.
 */
@Injectable()
export class ContextLlmService {
  private readonly logger = LoggerService.getInstance(ContextLlmService.name);

  constructor(
    private readonly llm: LlmCompletionService,
    private readonly prompts: PromptSharedService,
    private readonly config: AppConfigService,
  ) {}

  private get strongModel(): string | undefined {
    return this.config.builder?.interviewModel || undefined;
  }

  private async system(code: string): Promise<string> {
    const text = await this.prompts.getPromptByCode(code);
    if (!text) {
      // The prompt store seeds every contract's default on boot; reaching this means the
      // store is unreachable, and running without a system prompt would extract garbage.
      throw new Error(`Context Library prompt "${code}" is unavailable`);
    }
    return text;
  }

  private async completeJson<T>(args: {
    taskId: string;
    task: LlmTask;
    promptCode: string;
    user: string;
    maxTokens: number;
    strong: boolean;
    sourceId?: string;
    timeoutMs?: number;
  }): Promise<LlmJsonResult<T>> {
    const system = await this.system(args.promptCode);
    const result = await this.llm.complete({
      taskId: args.taskId,
      task: args.task,
      promptCode: args.promptCode,
      system,
      prompt: args.user,
      maxTokens: args.maxTokens,
      jsonMode: true,
      timeoutMs: args.timeoutMs ?? (args.strong ? 180_000 : 90_000),
      ...(args.strong && this.strongModel ? { model: this.strongModel } : {}),
      usageMetadata: args.sourceId
        ? { contextSourceId: args.sourceId }
        : undefined,
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    const cached = usage.cachedTokens ?? 0;
    const { costUsd } = computeCostUsd(
      result.model,
      usage.inputTokens,
      usage.outputTokens,
      {
        cacheReadTokens: cached,
        cacheCreationTokens: usage.cacheCreationTokens ?? 0,
      },
    );
    const value = parseJsonObject<T>(result.text);
    if (!value) {
      this.logger.warn(`${args.taskId}: model answer was not a JSON object`);
    }
    return {
      value,
      spend: {
        model: result.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: cached,
        costUsd,
      },
    };
  }

  overview(user: string, sourceId: string) {
    return this.completeJson<{
      overview?: string;
      keyTerms?: Array<{ term: string; meaning: string }>;
      fillerSections?: string[];
    }>({
      taskId: 'context-library-overview',
      task: LlmTask.CONTEXT_LIBRARY_OVERVIEW,
      promptCode: CONTEXT_LIBRARY_OVERVIEW_SYSTEM.code,
      user,
      maxTokens: 1200,
      strong: true,
      sourceId,
    });
  }

  /** `promptCode` is the collection's own extractor (see the profile's `extraction`). */
  extract<T>(promptCode: string, user: string, sourceId: string) {
    return this.completeJson<T>({
      taskId: 'context-library-extract',
      task: LlmTask.CONTEXT_LIBRARY_EXTRACT,
      promptCode,
      user,
      maxTokens: 6000,
      strong: true,
      sourceId,
    });
  }

  critic<T>(user: string, sourceId?: string) {
    return this.completeJson<T>({
      taskId: 'context-library-critic',
      task: LlmTask.CONTEXT_LIBRARY_CRITIC,
      promptCode: CONTEXT_LIBRARY_CRITIC_SYSTEM.code,
      user,
      maxTokens: 3000,
      strong: false,
      sourceId,
    });
  }

  adjudicate<T>(user: string, sourceId?: string) {
    return this.completeJson<T>({
      taskId: 'context-library-adjudicate',
      task: LlmTask.CONTEXT_LIBRARY_ADJUDICATE,
      promptCode: CONTEXT_LIBRARY_ADJUDICATE_SYSTEM.code,
      user,
      maxTokens: 400,
      strong: false,
      sourceId,
    });
  }

  consolidate<T>(user: string, sourceId: string) {
    return this.completeJson<T>({
      taskId: 'context-library-consolidate',
      task: LlmTask.CONTEXT_LIBRARY_CONSOLIDATE,
      promptCode: CONTEXT_LIBRARY_CONSOLIDATE_SYSTEM.code,
      user,
      maxTokens: 4000,
      strong: false,
      sourceId,
    });
  }

  enrich<T>(user: string) {
    return this.completeJson<T>({
      taskId: 'context-library-enrich',
      task: LlmTask.CONTEXT_LIBRARY_ENRICH,
      promptCode: CONTEXT_LIBRARY_ENRICH_SYSTEM.code,
      user,
      maxTokens: 800,
      strong: false,
    });
  }

  /** Listwise grading for a search. Short timeout: the caller falls back without it. */
  rerank<T>(user: string, timeoutMs: number) {
    return this.completeJson<T>({
      taskId: 'context-library-rerank',
      task: LlmTask.CONTEXT_LIBRARY_RERANK,
      promptCode: CONTEXT_LIBRARY_RERANK_SYSTEM.code,
      user,
      maxTokens: 1200,
      strong: false,
      timeoutMs,
    });
  }

  citationCheck<T>(user: string) {
    return this.completeJson<T>({
      taskId: 'context-library-citation-check',
      task: LlmTask.CONTEXT_LIBRARY_CITATION_CHECK,
      promptCode: CONTEXT_LIBRARY_CITATION_CHECK_SYSTEM.code,
      user,
      maxTokens: 1200,
      strong: false,
    });
  }

  queryPlan<T>(user: string) {
    return this.completeJson<T>({
      taskId: 'context-library-query-plan',
      task: LlmTask.CONTEXT_LIBRARY_QUERY_PLAN,
      promptCode: CONTEXT_LIBRARY_QUERY_PLAN_SYSTEM.code,
      user,
      maxTokens: 1000,
      strong: false,
      timeoutMs: 30_000,
    });
  }
}
