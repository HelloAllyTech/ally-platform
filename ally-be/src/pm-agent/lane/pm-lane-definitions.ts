import { PmLane } from '../enum/pm-agent.enum';
import {
  PM_PROMPT_CODES,
  PM_TASK_IDS,
} from '../constants/pm-agent-pipeline.constants';

/** Tools the lanes may be given. Every one is read-only; see PmLaneToolsService. */
export enum PmTool {
  ANALYTICS_SECTION = 'analytics_section',
  UX_SIGNALS_LIST = 'ux_signals_list',
  LLM_USAGE_SUMMARY = 'llm_usage_summary',
  AI_TASK_REGISTRY = 'ai_task_registry',
  PRODUCT_GOALS = 'product_goals',
  SEARCH_ROADMAP = 'search_roadmap',
  GET_OPPORTUNITY = 'get_opportunity',
  SEARCH_USER_INTERVIEWS = 'search_user_interviews',
  BUG_FINDINGS_SEARCH = 'bug_findings_search',
  DOCS_SEARCH = 'docs_search',
  GITHUB_SEARCH_CODE = 'github_search_code',
  GITHUB_READ_FILE = 'github_read_file',
  GITHUB_REPO_TREE = 'github_repo_tree',
  WIKI_SEARCH = 'wiki_search',
  WIKI_READ = 'wiki_read',
}

/** The roadmap copilot's read tools the lanes reuse as-is (ProductRoadmap/Builder code). */
export const PM_DELEGATED_TOOLS: ReadonlySet<string> = new Set([
  PmTool.SEARCH_ROADMAP,
  PmTool.GET_OPPORTUNITY,
  PmTool.SEARCH_USER_INTERVIEWS,
  PmTool.BUG_FINDINGS_SEARCH,
  PmTool.DOCS_SEARCH,
  PmTool.GITHUB_SEARCH_CODE,
  PmTool.GITHUB_READ_FILE,
  PmTool.GITHUB_REPO_TREE,
  PmTool.WIKI_SEARCH,
  PmTool.WIKI_READ,
]);

export interface PmLaneDefinition {
  lane: PmLane;
  promptCode: string;
  taskId: string;
  /** The allow-list. A call to anything else is refused without running. */
  tools: readonly PmTool[];
  /** Words describing the lane, for memory and exemplar retrieval. */
  topic: string;
}

const CODE_TOOLS = [
  PmTool.DOCS_SEARCH,
  PmTool.GITHUB_SEARCH_CODE,
  PmTool.GITHUB_READ_FILE,
  PmTool.GITHUB_REPO_TREE,
] as const;

export const PM_LANES: Record<PmLane, PmLaneDefinition> = {
  [PmLane.ANALYTICS]: {
    lane: PmLane.ANALYTICS,
    promptCode: PM_PROMPT_CODES[PmLane.ANALYTICS],
    taskId: PM_TASK_IDS[PmLane.ANALYTICS],
    tools: [
      PmTool.ANALYTICS_SECTION,
      PmTool.SEARCH_ROADMAP,
      PmTool.DOCS_SEARCH,
      PmTool.GITHUB_SEARCH_CODE,
      PmTool.GITHUB_READ_FILE,
    ],
    topic:
      'learner activation completion retention roleplay usage scribe adoption skill growth track dropoff quality score coaching',
  },
  [PmLane.UX_SIGNALS]: {
    lane: PmLane.UX_SIGNALS,
    promptCode: PM_PROMPT_CODES[PmLane.UX_SIGNALS],
    taskId: PM_TASK_IDS[PmLane.UX_SIGNALS],
    tools: [
      PmTool.UX_SIGNALS_LIST,
      PmTool.SEARCH_ROADMAP,
      PmTool.BUG_FINDINGS_SEARCH,
      ...CODE_TOOLS,
    ],
    topic:
      'friction rage click dead click abandoned route zero result search funnel drop-off ui ux screen',
  },
  [PmLane.CODE_HEALTH]: {
    lane: PmLane.CODE_HEALTH,
    promptCode: PM_PROMPT_CODES[PmLane.CODE_HEALTH],
    taskId: PM_TASK_IDS[PmLane.CODE_HEALTH],
    tools: [
      ...CODE_TOOLS,
      PmTool.BUG_FINDINGS_SEARCH,
      PmTool.WIKI_SEARCH,
      PmTool.WIKI_READ,
    ],
    topic:
      'code health architecture refactor duplication test coverage module boundary dependency performance error handling',
  },
  [PmLane.INFRA_COST]: {
    lane: PmLane.INFRA_COST,
    promptCode: PM_PROMPT_CODES[PmLane.INFRA_COST],
    taskId: PM_TASK_IDS[PmLane.INFRA_COST],
    tools: [PmTool.LLM_USAGE_SUMMARY, PmTool.AI_TASK_REGISTRY, ...CODE_TOOLS],
    topic:
      'cost model spend tokens llm usage cache infrastructure latency registry provider fallback',
  },
  [PmLane.STRATEGY_CONTENT]: {
    lane: PmLane.STRATEGY_CONTENT,
    promptCode: PM_PROMPT_CODES[PmLane.STRATEGY_CONTENT],
    taskId: PM_TASK_IDS[PmLane.STRATEGY_CONTENT],
    tools: [
      PmTool.PRODUCT_GOALS,
      PmTool.SEARCH_ROADMAP,
      PmTool.GET_OPPORTUNITY,
      PmTool.SEARCH_USER_INTERVIEWS,
      PmTool.DOCS_SEARCH,
      PmTool.WIKI_SEARCH,
      PmTool.WIKI_READ,
    ],
    topic:
      'strategy goal roadmap content course track scenario curriculum audience tenant vision mandate',
  },
  [PmLane.REVISIONS]: {
    lane: PmLane.REVISIONS,
    promptCode: PM_PROMPT_CODES[PmLane.REVISIONS],
    taskId: PM_TASK_IDS[PmLane.REVISIONS],
    tools: [
      PmTool.ANALYTICS_SECTION,
      PmTool.UX_SIGNALS_LIST,
      PmTool.LLM_USAGE_SUMMARY,
      PmTool.SEARCH_ROADMAP,
      PmTool.BUG_FINDINGS_SEARCH,
      ...CODE_TOOLS,
    ],
    topic: 'revision feedback smaller scope different approach evidence',
  },
};
