import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import {
  STAGE_DIRECTOR_MEMORY_MAPPING,
  renderPrompt,
} from 'src/prompt/contracts';
import { LlmTask } from '../enum/llm-task.enum';
import { ScenariosRepository } from '../repository/scenario.repository';
import { ScenarioService } from './scenario.service';

/** The main-agent prompt whose body uses {thoughts} and {memories}. */
export const STAGE_DIRECTOR_MAIN_PROMPT_CODE =
  'ally_ai_learn_system_main_agent_prompt_stage_director';
/** Main Agent Prompt #3, the prompt the bulk switch moves scenarios from. */
export const WORKING_MEMORY_MAIN_PROMPT_CODE =
  'ally_ai_learn_system_main_agent_prompt_working_memory_split';

/** AI-task-registry row id; the key for per-task model config. */
const AI_TASK_ID = 'stage-director-memory-mapping';
const MAPPING_TIMEOUT_MS = 45_000;
const MAPPING_MAX_TOKENS = 2048;

export interface ScenarioMemory {
  id: string;
  title: string;
  content?: string;
  unlocksFromStateId?: string | null;
}

export interface MapMemoriesInput {
  knowledgeSources?: ScenarioMemory[] | null;
  states?: { id?: string; name?: string; guidelines?: unknown }[] | null;
  characterProfileText?: string | null;
  roleInstructions?: string | null;
  title?: string | null;
}

export interface MapMemoriesResult {
  memories: ScenarioMemory[];
  /** False when the model could not be used and memories were copied as-is. */
  mapped: boolean;
}

export interface BulkSwitchRow {
  scenarioId: number;
  title: string;
  outcome: 'switched' | 'would-switch' | 'skipped' | 'failed';
  reason?: string;
  memories?: { title: string; unlocksAt: string | null }[];
}

/**
 * Moves a simulation onto Main Agent Prompt — Stage Director
 * (ally-ai-learn/docs/stage-director-and-memories.md).
 *
 * Memories are a separate field from Knowledge Sources, so a simulation keeps
 * both and switching prompts in either direction loses neither. On the first
 * switch the memories are built from the Knowledge Sources and an agent
 * assigns each to the stage the client is ready to share it from. The editor
 * calls `mapMemories` when an author picks the prompt; `bulkSwitch` runs the
 * same mapping for many simulations at once, so what was tested on a sample
 * is exactly what runs in bulk.
 */
@Injectable()
export class StageDirectorMemoriesService {
  private readonly logger = LoggerService.getInstance(
    StageDirectorMemoriesService.name,
  );

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
    private readonly scenariosRepository: ScenariosRepository,
    private readonly scenarioService: ScenarioService,
  ) {}

  async mapMemories(input: MapMemoriesInput): Promise<MapMemoriesResult> {
    const sources = (input.knowledgeSources ?? []).filter(
      (s) => s && typeof s.title === 'string' && s.title.trim() && s.id,
    );
    const copies: ScenarioMemory[] = sources.map((s) => ({
      id: s.id,
      title: s.title,
      ...(s.content ? { content: s.content } : {}),
      ...(s.unlocksFromStateId
        ? { unlocksFromStateId: s.unlocksFromStateId }
        : {}),
    }));
    const states = (input.states ?? []).filter(
      (st) => st && st.id && String(st.name ?? '').trim(),
    );
    // With fewer than two stages there is nothing to hold a memory back for.
    if (copies.length === 0 || states.length < 2) {
      return { memories: copies, mapped: copies.length > 0 };
    }

    try {
      const assignments = await this.askModel(input, sources, states);
      const stateIds = new Set(states.map((st) => String(st.id)));
      const firstStateId = String(states[0].id);
      const memories = copies.map((memory) => {
        // An author's own lock wins over the model.
        if (memory.unlocksFromStateId) return memory;
        const stateId = assignments.get(memory.id);
        if (!stateId || !stateIds.has(stateId) || stateId === firstStateId) {
          return memory;
        }
        return { ...memory, unlocksFromStateId: stateId };
      });
      return { memories, mapped: true };
    } catch (error) {
      this.logger.warn(
        `memory mapping failed; copying knowledge sources as they are: ${
          (error as Error)?.message ?? error
        }`,
      );
      return { memories: copies, mapped: false };
    }
  }

  private async askModel(
    input: MapMemoriesInput,
    sources: ScenarioMemory[],
    states: { id?: string; name?: string; guidelines?: unknown }[],
  ): Promise<Map<string, string | null>> {
    const template =
      (await this.promptSharedService.getPromptByCode(
        STAGE_DIRECTOR_MEMORY_MAPPING.code,
      )) ?? '';
    if (!template) {
      throw new Error(
        `prompt '${STAGE_DIRECTOR_MEMORY_MAPPING.code}' not found`,
      );
    }
    const prompt = renderPrompt(STAGE_DIRECTOR_MEMORY_MAPPING, template, {
      title: input.title ?? '',
      roleInstructions: input.roleInstructions ?? '',
      backstory: input.characterProfileText ?? '',
      states: states
        .map((st) => {
          const guidelines =
            typeof st.guidelines === 'string' ? st.guidelines.trim() : '';
          return `${st.id}: ${String(st.name).trim()}${
            guidelines ? ` — ${guidelines}` : ''
          }`;
        })
        .join('\n'),
      memories: sources
        .map((s) => `${s.id}: ${s.title}${s.content ? ` — ${s.content}` : ''}`)
        .join('\n'),
    });
    const response = await this.llmCompletion.complete({
      taskId: AI_TASK_ID,
      task: LlmTask.STAGE_DIRECTOR_MEMORY_MAPPING,
      promptCode: STAGE_DIRECTOR_MEMORY_MAPPING.code,
      prompt,
      maxTokens: MAPPING_MAX_TOKENS,
      timeoutMs: MAPPING_TIMEOUT_MS,
      jsonMode: true,
    });
    const raw = response.text ?? '';
    const parsed = JSON.parse(
      raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1),
    ) as { assignments?: { id?: string; stateId?: string | null }[] };
    const out = new Map<string, string | null>();
    for (const row of parsed.assignments ?? []) {
      if (row?.id)
        out.set(String(row.id), row.stateId ? String(row.stateId) : null);
    }
    return out;
  }

  /**
   * Switch simulations from Main Agent Prompt #3 to the Stage Director prompt.
   * A simulation that already has memories keeps them (so one Ankita tested is
   * not mapped again); the rest are mapped exactly as in the editor. `dryRun`
   * reports what would happen and writes nothing.
   */
  async bulkSwitch(params: {
    userId: number;
    scenarioIds?: number[];
    dryRun: boolean;
    onlyWithStates?: boolean;
  }): Promise<BulkSwitchRow[]> {
    const scenarios = await this.scenariosRepository.find({
      where: params.scenarioIds?.length ? { id: In(params.scenarioIds) } : {},
      order: { id: 'ASC' },
    });
    const rows: BulkSwitchRow[] = [];
    for (const scenario of scenarios) {
      const metadata = (scenario.metadata ?? {}) as Record<string, any>;
      const base = { scenarioId: scenario.id, title: scenario.title ?? '' };
      if (metadata.selectedMainPromptCode !== WORKING_MEMORY_MAIN_PROMPT_CODE) {
        if (params.scenarioIds?.length) {
          rows.push({
            ...base,
            outcome: 'skipped',
            reason: `on ${metadata.selectedMainPromptCode ?? 'no prompt'}, not #3`,
          });
        }
        continue;
      }
      const states = Array.isArray(metadata.states) ? metadata.states : [];
      if (params.onlyWithStates !== false && states.length < 2) {
        rows.push({
          ...base,
          outcome: 'skipped',
          reason: 'fewer than two states',
        });
        continue;
      }
      try {
        const existing = Array.isArray(metadata.memories)
          ? metadata.memories
          : [];
        const memories = existing.length
          ? existing
          : (
              await this.mapMemories({
                knowledgeSources: metadata.knowledgeSources,
                states,
                characterProfileText: metadata.characterProfileText,
                roleInstructions: scenario.prompt,
                title: scenario.title,
              })
            ).memories;
        const nameById = new Map(
          states.map((st: any) => [String(st.id), String(st.name ?? '')]),
        );
        const summary = memories.map((m: ScenarioMemory) => ({
          title: m.title,
          unlocksAt: m.unlocksFromStateId
            ? (nameById.get(String(m.unlocksFromStateId)) ??
              m.unlocksFromStateId)
            : null,
        }));
        if (!params.dryRun) {
          await this.scenarioService.updateScenario(
            scenario.id,
            {
              selectedMainPromptCode: STAGE_DIRECTOR_MAIN_PROMPT_CODE,
              memories,
            } as any,
            params.userId,
          );
        }
        rows.push({
          ...base,
          outcome: params.dryRun ? 'would-switch' : 'switched',
          memories: summary,
        });
      } catch (error) {
        rows.push({
          ...base,
          outcome: 'failed',
          reason: (error as Error)?.message ?? String(error),
        });
      }
    }
    return rows;
  }
}
