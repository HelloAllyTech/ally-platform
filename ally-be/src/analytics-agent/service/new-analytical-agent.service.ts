import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  AIMessage,
  BaseMessage,
  createAgent,
  HumanMessage,
  ToolMessage,
  toolStrategy,
} from 'langchain';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { GoogleAuth } from 'google-auth-library';
import { createAppAuth } from '@octokit/auth-app';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { ChatOpenAI } from '@langchain/openai';
import z from 'zod';
import {
  AGENT_LIMITS,
  AGENT_SYSTEM_PROMPT,
  resolveAnalyticsChatModel,
} from '../constants/analytics-agent.constants';
import {
  AnalyticalAgentTraceHandler,
  buildAgentTrace,
  DbtHeadCommit,
  isTool,
  parseToolResult,
} from './analytical-agent-trace';
import { createDatalyzeTaskTokenMiddleware } from '../util/datalyze-task-token.util';
import { analyticsGoogleAuthOptions } from '../util/analytics-google-credentials.util';

const logger = new Logger('AnalyticalAgent');

const outputSchema = z.object({
  response: z.string(),
  followUps: z.array(z.string()).optional(),
  needsUserInput: z
    .boolean()
    .optional()
    .describe(
      'true only when `response` is questions for the user that must be answered before the analysis can go on; leave it out when `response` is an answer',
    ),
});

// Nothing below runs at import: the model, the Google/GitHub auth and the MCP client are built on
// first use. `AnalyticsAgentModule` is always loaded by `AppModule`, so a missing GitHub App key
// or API key must only fail the analytics feature that needs it, never the whole backend boot.
let llm: ChatOpenAI | undefined;
export function getLlm(): ChatOpenAI {
  llm ??= new ChatOpenAI({
    model: resolveAnalyticsChatModel(),
    apiKey: process.env.OPENAI_API_KEY,
    supportsStrictToolCalling: false,
    useResponsesApi: true,
  });
  return llm;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set; the analytics agent cannot use it`);
  }
  return value;
}

function buildMcpClient(): MultiServerMCPClient {
  // Its own credential (ANALYTICS_GOOGLE_CREDENTIALS), not the shared GOOGLE_APPLICATION_CREDENTIALS.
  const google = new GoogleAuth(
    analyticsGoogleAuthOptions(['https://www.googleapis.com/auth/bigquery']),
  );

  const authProvider: OAuthClientProvider = {
    get redirectUrl() {
      return undefined;
    },
    get clientMetadata() {
      return { redirect_uris: [] };
    },
    clientInformation: () => undefined,
    tokens: async () => {
      const accessToken = await google.getAccessToken();
      if (!accessToken) {
        throw new Error(
          'Failed to obtain a Google access token for the BigQuery MCP server',
        );
      }
      return { access_token: accessToken, token_type: 'Bearer' };
    },
    saveTokens: () => {},
    redirectToAuthorization: () => {
      throw new Error(
        'Interactive OAuth is not supported; tokens come from GoogleAuth',
      );
    },
    saveCodeVerifier: () => {},
    codeVerifier: () => {
      throw new Error(
        'Interactive OAuth is not supported; tokens come from GoogleAuth',
      );
    },
  };

  const github = createAppAuth({
    appId: requireEnv('GITHUB_APP_ID'),
    privateKey: requireEnv('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n'),
    installationId: requireEnv('GITHUB_APP_INSTALLATION_ID'),
  });

  const githubAuthProvider: OAuthClientProvider = {
    get redirectUrl() {
      return undefined;
    },
    get clientMetadata() {
      return { redirect_uris: [] };
    },
    clientInformation: () => undefined,
    tokens: async () => {
      const { token } = await github({ type: 'installation' });
      return { access_token: token, token_type: 'Bearer' };
    },
    saveTokens: () => {},
    redirectToAuthorization: () => {
      throw new Error(
        'Interactive OAuth is not supported; tokens come from the GitHub App',
      );
    },
    saveCodeVerifier: () => {},
    codeVerifier: () => {
      throw new Error(
        'Interactive OAuth is not supported; tokens come from the GitHub App',
      );
    },
  };

  return new MultiServerMCPClient({
    servers: {
      bigQuery: {
        transport: 'http',
        url: 'https://bigquery.googleapis.com/mcp',
        authProvider,
      },
      github: {
        transport: 'http',
        url: 'https://api.githubcopilot.com/mcp/readonly',
        headers: { 'X-MCP-Toolsets': 'repos,git' },
        authProvider: githubAuthProvider,
      },
      datalyze: {
        transport: 'http',
        url: 'https://www.joindatalyze.com/api/datalyze/mcp',
        headers: {
          Authorization: `Bearer ${process.env.DATALYZE_MCP_KEY}`,
        },
      },
    },
  });
}

// Shared by the chat agent and the auditor. Built once, on first use; a failed build is not cached.
let mcpClient: MultiServerMCPClient | undefined;
export function getMcpClient(): MultiServerMCPClient {
  mcpClient ??= buildMcpClient();
  return mcpClient;
}

export const AVAILABLE_TABLES = {
  // Marts
  'ally-analytics-prod.dbt_dev_marts.dim_organizations':
    'dim_organizations.yml',
  'ally-analytics-prod.dbt_dev_marts.dim_scenarios': 'dim_scenarios.yml',
  'ally-analytics-prod.dbt_dev_marts.dim_users': 'dim_users.yml',
  'ally-analytics-prod.dbt_dev_marts.fct_assist_chats': 'fct_assist_chats.yml',
  'ally-analytics-prod.dbt_dev_marts.fct_foundational_cuts':
    'fct_foundational_cuts.yml',
  'ally-analytics-prod.dbt_dev_marts.fct_foundational_skill_levels':
    'fct_foundational_skill_levels.yml',
  'ally-analytics-prod.dbt_dev_marts.fct_llm_calls': 'fct_llm_calls.yml',
  'ally-analytics-prod.dbt_dev_marts.fct_product_events':
    'fct_product_events.yml',
  'ally-analytics-prod.dbt_dev_marts.fct_scenario_sessions':
    'fct_scenario_sessions.yml',
  'ally-analytics-prod.dbt_dev_marts.fct_track_enrollments':
    'fct_track_enrollments.yml',

  // Intermediate
  'ally-analytics-prod.dbt_dev_intermediate.int_ai_usage_joined':
    'int_ai_usage_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_case_sessions_joined':
    'int_case_sessions_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_organizations_joined':
    'int_organizations_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_posthog_events_joined':
    'int_posthog_events_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_path_sessions_joined':
    'int_scenario_path_sessions_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_behaviors_joined':
    'int_scenario_session_behaviors_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_debrief_chats_joined':
    'int_scenario_session_debrief_chats_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_events_joined':
    'int_scenario_session_events_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_feedback_claims_joined':
    'int_scenario_session_feedback_claims_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_glossary_joined':
    'int_scenario_session_glossary_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_journeys_joined':
    'int_scenario_session_journeys_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_language_joined':
    'int_scenario_session_language_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_lifecycle_joined':
    'int_scenario_session_lifecycle_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_reviews_joined':
    'int_scenario_session_reviews_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_turn_drift_joined':
    'int_scenario_session_turn_drift_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_turns_joined':
    'int_scenario_session_turns_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenario_sessions_joined':
    'int_scenario_sessions_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_scenarios_joined':
    'int_scenarios_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_tenant_cohorts_joined':
    'int_tenant_cohorts_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_track_enrollments_joined':
    'int_track_enrollments_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_track_item_progress_joined':
    'int_track_item_progress_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_user_badges_joined':
    'int_user_badges_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_users_joined':
    'int_users_joined.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_users_roles':
    'int_users_roles.yml',
  'ally-analytics-prod.dbt_dev_intermediate.int_xp_events_joined':
    'int_xp_events_joined.yml',

  // Staging
  'ally-analytics-prod.dbt_dev_staging.stg_agent_test_cases':
    'stg_agent_test_cases_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_analytics_quality_thresholds':
    'stg_analytics_quality_thresholds_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_analytics_xp_goals':
    'stg_analytics_xp_goals_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_badge_groups':
    'stg_badge_groups_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_badge_tenants':
    'stg_badge_tenants_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_badge_users':
    'stg_badge_users_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_badges': 'stg_badges_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_behaviors':
    'stg_behaviors_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_call_details':
    'stg_call_details_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_case_items':
    'stg_case_items_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_case_session_items':
    'stg_case_session_items_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_case_sessions':
    'stg_case_sessions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_case_tenants':
    'stg_case_tenants_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_cases': 'stg_cases_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_chat_audio_uploads':
    'stg_chat_audio_uploads_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_chat_custom_field_values':
    'stg_chat_custom_field_values_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_chat_summary_attempts':
    'stg_chat_summary_attempts_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_chats': 'stg_chats_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_competencies':
    'stg_competencies_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_competency_behaviors':
    'stg_competency_behaviors_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_course_discussion_posts':
    'stg_course_discussion_posts_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_course_discussions':
    'stg_course_discussions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_custom_field_definitions':
    'stg_custom_field_definitions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_feedback':
    'stg_feedback_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_feedback_claim_judgment':
    'stg_feedback_claim_judgment_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_foundational_skill_assessments':
    'stg_foundational_skill_assessments_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_foundational_skill_benchmark_assessments':
    'stg_foundational_skill_benchmark_assessments_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_foundational_skill_cuts':
    'stg_foundational_skill_cuts_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_glossary_adherence_reports':
    'stg_glossary_adherence_reports_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_groups': 'stg_groups_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_in_app_notifications':
    'stg_in_app_notifications_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_language_error_annotations':
    'stg_language_error_annotations_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_language_judgment_sessions':
    'stg_language_judgment_sessions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_languages':
    'stg_languages_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_learner_supervisor_memory':
    'stg_learner_supervisor_memory_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_llm_models':
    'stg_llm_models_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_llm_usage':
    'stg_llm_usage_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_messages':
    'stg_messages_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_posthog_events':
    'stg_posthog_events_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_preference':
    'stg_preference_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_queue_entries':
    'stg_queue_entries_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_agent_test_case_selections':
    'stg_scenario_agent_test_case_selections_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_behavior_instruction_behaviors':
    'stg_scenario_behavior_instruction_behaviors_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_behavior_instructions':
    'stg_scenario_behavior_instructions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_characters':
    'stg_scenario_characters_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_cohort_restrictions':
    'stg_scenario_cohort_restrictions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_events':
    'stg_scenario_events_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_path_items':
    'stg_scenario_path_items_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_path_session_items':
    'stg_scenario_path_session_items_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_path_sessions':
    'stg_scenario_path_sessions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_path_tenants':
    'stg_scenario_path_tenants_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_paths':
    'stg_scenario_paths_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_behavior_instructions':
    'stg_scenario_session_behavior_instructions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_chat_messages':
    'stg_scenario_session_chat_messages_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_chats':
    'stg_scenario_session_chats_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_details':
    'stg_scenario_session_details_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_events':
    'stg_scenario_session_events_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_feedbacks':
    'stg_scenario_session_feedbacks_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_lifecycle_events':
    'stg_scenario_session_lifecycle_events_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_message_tags':
    'stg_scenario_session_message_tags_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_messages':
    'stg_scenario_session_messages_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_recordings':
    'stg_scenario_session_recordings_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_review_comment_reactions':
    'stg_scenario_session_review_comment_reactions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_review_comments':
    'stg_scenario_session_review_comments_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_review_reactions':
    'stg_scenario_session_review_reactions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_review_read_status':
    'stg_scenario_session_review_read_status_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_review_threads':
    'stg_scenario_session_review_threads_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_reviews':
    'stg_scenario_session_reviews_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_start_metrics':
    'stg_scenario_session_start_metrics_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_supervisor_notes':
    'stg_scenario_session_supervisor_notes_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_tags':
    'stg_scenario_session_tags_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_session_turn_metrics':
    'stg_scenario_session_turn_metrics_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_sessions':
    'stg_scenario_sessions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_tenants':
    'stg_scenario_tenants_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_trigger_warnings':
    'stg_scenario_trigger_warnings_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_versions':
    'stg_scenario_versions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenario_voices':
    'stg_scenario_voices_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scenarios':
    'stg_scenarios_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scribe_session_review_comment_reactions':
    'stg_scribe_session_review_comment_reactions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scribe_session_review_comments':
    'stg_scribe_session_review_comments_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scribe_session_review_reactions':
    'stg_scribe_session_review_reactions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scribe_session_review_read_status':
    'stg_scribe_session_review_read_status_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scribe_session_review_threads':
    'stg_scribe_session_review_threads_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_scribe_session_reviews':
    'stg_scribe_session_reviews_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_session_events':
    'stg_session_events_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_session_feedback_skill_links':
    'stg_session_feedback_skill_links_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_simulation_credits':
    'stg_simulation_credits_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_summary_feedback':
    'stg_summary_feedback_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_tenant_cohort_members':
    'stg_tenant_cohort_members_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_tenant_cohorts':
    'stg_tenant_cohorts_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_tenants': 'stg_tenants_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_track_annotation_attempts':
    'stg_track_annotation_attempts_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_track_cohort_restrictions':
    'stg_track_cohort_restrictions_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_track_enrollments':
    'stg_track_enrollments_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_track_item_progress':
    'stg_track_item_progress_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_track_items':
    'stg_track_items_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_track_journal_entries':
    'stg_track_journal_entries_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_track_quiz_attempts':
    'stg_track_quiz_attempts_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_track_sections':
    'stg_track_sections_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_track_tenants':
    'stg_track_tenants_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_tracks': 'stg_tracks_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_trigger_warnings':
    'stg_trigger_warnings_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_turn_drift_judgment':
    'stg_turn_drift_judgment_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_user_daily_scores':
    'stg_user_daily_scores_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_user_groups':
    'stg_user_groups_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_user_progress':
    'stg_user_progress_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_users': 'stg_users_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_wm_recall_judgments':
    'stg_wm_recall_judgments_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_wm_recall_selections':
    'stg_wm_recall_selections_pk_test.yml',
  'ally-analytics-prod.dbt_dev_staging.stg_xp_events':
    'stg_xp_events_pk_test.yml',

  // Seeds
  'ally-analytics-prod.dbt_dev_seeds.ai_task_categories':
    'ai_task_categories.yml',
  'ally-analytics-prod.dbt_dev_seeds.foundational_skills':
    'foundational_skills.yml',
  'ally-analytics-prod.dbt_dev_seeds.llm_pricing': 'llm_pricing.yml',
  'ally-analytics-prod.dbt_dev_seeds.posthog_event_catalog':
    'posthog_event_catalog.csv',
  'ally-analytics-prod.dbt_dev_seeds.posthog_property_catalog':
    'posthog_property_catalog.csv',
};

const RECURSION_LIMIT = 100;

export type AnalyticalAgentHistoryTurn = {
  question: string;
  sql?: string;
  answer?: string;
};

// The server holds no conversation: the client replays prior answered turns so follow-ups
// ("and by language?") have context. They go in as ONE labelled human message rather than as
// assistant messages: replayed assistant turns are plain text, and the model copies that format
// and answers in plain text instead of calling the structured-output tool - which leaves
// `structuredResponse` empty. History is context only; every query still runs through the tools.
function buildInputMessages(
  query: string,
  history: AnalyticalAgentHistoryTurn[] = [],
) {
  const turns = history.slice(-AGENT_LIMITS.MAX_HISTORY_TURNS);
  if (turns.length === 0) return [new HumanMessage(query)];

  const transcript = turns
    .map((turn, i) =>
      [
        `Previous question ${i + 1}: ${turn.question}`,
        turn.sql ? `SQL that ran:\n${turn.sql}` : undefined,
        turn.answer ? `Answer given: ${turn.answer}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');

  return [
    new HumanMessage(
      'Earlier in this conversation (context only - use it to resolve references like "that" or "the same period"; ' +
        're-run queries rather than reusing numbers from it):\n\n' +
        `${transcript}\n\n---\n\nCurrent question: ${query}`,
    ),
  ];
}

// When the model writes the structured answer out as text (sometimes inside a code fence)
// instead of calling the tool, recover the fields; otherwise treat the whole text as the answer.
function parseStructuredText(text: string) {
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const parsed = outputSchema.safeParse(JSON.parse(unfenced));
    if (parsed.success)
      return {
        response: parsed.data.response,
        followUps: parsed.data.followUps ?? [],
        needsUserInput: parsed.data.needsUserInput,
      };
  } catch {
    // not JSON - plain prose answer
  }
  return { response: text, followUps: [] as string[] };
}

// Plain text of the last assistant message, for when the model answered without the structured tool.
function lastAiText(messages: BaseMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== 'ai') continue;
    const content = message.content as unknown;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((block) =>
                typeof block === 'string'
                  ? block
                  : ((block as { text?: string })?.text ?? ''),
              )
              .join('')
          : '';
    if (text.trim()) return text.trim();
  }
  return undefined;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const clip = (text: string, max = 200) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

// A few readable lines about one finished run: where the time went, what it cost, what failed.
// Built from the trace, so it only ever reports what the full JSON line also carries.
function logRunSummary(
  runId: string,
  trace: ReturnType<typeof buildAgentTrace>,
) {
  const steps = trace.steps;
  const byServer = new Map<string, number>();
  for (const step of steps) {
    const server = step.toolName.includes('_')
      ? step.toolName.split('_')[0]
      : 'other';
    byServer.set(server, (byServer.get(server) ?? 0) + 1);
  }
  const inTools = steps.reduce((n, step) => n + (step.durationMs ?? 0), 0);
  const tokens = trace.config.tokens;
  const slowest = [...steps]
    .filter((step) => step.durationMs !== null)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, 3)
    .map(
      (step) =>
        `${step.toolName} ${seconds(step.durationMs ?? 0)} (step ${step.step})`,
    );

  logger.log(
    [
      `[${runId}] Answered in ${seconds(trace.durationMs)}`,
      tokens
        ? `${tokens.llmCalls} LLM calls, ${tokens.totalTokens.toLocaleString('en-US')} tokens (${tokens.cachedInputTokens.toLocaleString('en-US')} cached)`
        : 'no token usage reported',
      `${steps.length} tool calls (${[...byServer].map(([name, n]) => `${name} ${n}`).join(', ') || 'none'})`,
      `${seconds(inTools)} in tools, the rest model time`,
    ].join(' | '),
  );
  if (slowest.length > 0) {
    logger.log(`[${runId}] Slowest tool calls: ${slowest.join('; ')}`);
  }
  if (trace.sqlQueries.length > 0 || trace.dbtFilesRead.length > 0) {
    logger.log(
      `[${runId}] Ran ${trace.sqlQueries.length} SQL queries, read ${trace.dbtFilesRead.length} dbt files, inspected ${trace.tablesInspected.length} tables`,
    );
  }
  for (const error of trace.errors) {
    logger.warn(
      `[${runId}] ${error.source === 'tool' ? `${error.toolName} failed at step ${error.step}` : 'LLM error'}: ${clip(error.message)}`,
    );
  }
  if (trace.retries.length > 0) {
    const stuck = trace.retries.filter((r) => r.retryStatus === 'error').length;
    logger.warn(
      `[${runId}] ${trace.retries.length} tool calls repeated after a failure (${stuck} failed again)`,
    );
  }
}

export async function invokeAnalyticalAgent(
  query: string,
  history: AnalyticalAgentHistoryTurn[] = [],
  userId?: string,
  chatId?: string,
) {
  const runId = randomUUID().slice(0, 8);
  logger.log(
    `[${runId}] Question received (${query.length} chars, ${history.length} earlier turns, user ${userId ?? '-'}, chat ${chatId ?? '-'})`,
  );
  const startedAtMs = Date.now();
  const tools = await getMcpClient().listTools();

  const systemPrompt = AGENT_SYSTEM_PROMPT.replace(
    '{{AVAILABLE_TABLES}}',
    Object.keys(AVAILABLE_TABLES).join('\n'),
  );
  const agent = createAgent({
    model: getLlm(),
    systemPrompt,
    responseFormat: toolStrategy(outputSchema),
    tools,
    // Fills in Datalyze's task token itself; a hand-copied token kept failing its signature check.
    middleware: [createDatalyzeTaskTokenMiddleware()],
  });

  const inputMessages = buildInputMessages(query, history);
  const traceHandler = new AnalyticalAgentTraceHandler();
  let answer: Awaited<ReturnType<typeof agent.invoke>>;
  try {
    answer = await agent.invoke(
      {
        messages: inputMessages,
      },
      {
        recursionLimit: RECURSION_LIMIT,
        callbacks: [traceHandler],
      },
    );
  } catch (err) {
    logger.error(
      `[${runId}] Run failed after ${seconds(Date.now() - startedAtMs)}: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }

  // The model should finish through the structured-output tool. If it replied in plain text
  // instead, use that text rather than returning no response at all.
  const structured =
    answer.structuredResponse ??
    (() => {
      const text = lastAiText(answer.messages.slice(inputMessages.length));
      if (text === undefined) return undefined;
      logger.warn(
        `[${runId}] Finished without a structured response; using the last message as the answer`,
      );
      return parseStructuredText(text);
    })();
  if (!structured) {
    throw new Error(
      'The analytical agent finished without producing an answer',
    );
  }

  const toolMessages = new Map(
    answer.messages
      .filter((el) => el.type === 'tool')
      .map(
        (el) => [(el as ToolMessage).tool_call_id, el as ToolMessage] as const,
      ),
  );

  // every call the agent made, paired with what the tool sent back
  const toolCalls = answer.messages
    .filter((el) => el.type === 'ai')
    .flatMap((el) => (el as AIMessage).tool_calls ?? [])
    .map((call) => {
      const result = call.id ? toolMessages.get(call.id) : undefined;
      return {
        name: call.name,
        args: call.args,
        status: result?.status,
        data: parseToolResult(result?.content),
      };
    });

  // just the SQL that ran and the rows it returned, for display
  const queries = toolCalls
    .filter((el) => el.name.includes('execute_sql'))
    .map((el) => ({
      sql: String(el.args?.query ?? el.args?.sql ?? ''),
      status: el.status,
      data: el.data,
    }));

  // Extra telemetry for this question. Built after the run, so it can never change the answer.
  const dbtFileReads = toolCalls.some((el) =>
    isTool(el.name, 'get_file_contents'),
  );
  const headCommit = dbtFileReads
    ? await resolveDbtHeadCommit(tools, toolCalls)
    : null;
  const trace = buildAgentTrace({
    question: query,
    startedAtMs,
    durationMs: Date.now() - startedAtMs,
    structured,
    handler: traceHandler,
    newMessages: answer.messages.slice(inputMessages.length),
    headCommit,
    config: {
      model: String(getLlm().model),
      systemPrompt,
      modelSettings: {
        temperature: getLlm().temperature ?? null,
        useResponsesApi: true,
        supportsStrictToolCalling: false,
        recursionLimit: RECURSION_LIMIT,
      },
      allowedTables: Object.keys(AVAILABLE_TABLES),
    },
  });

  logRunSummary(runId, trace);
  // The full record of the run, one JSON line on stdout (not behind the log level), for
  // whoever reads the logs to investigate a run. `runId` ties it to the lines above.
  console.log(
    JSON.stringify({
      runId,
      toolCalls: toolCalls.map((el) => ({
        name: el.name,
        args: el.args,
      })),
      response: structured,
      ...trace,
    }),
  );

  return {
    toolCalls,
    queries,
    response: structured,
    ...trace,
  };
}

// The commit the default branch of the dbt repo points at, used to say which version of the
// docs the agent read. Best effort: null if the lookup fails or the tool isn't exposed.
async function resolveDbtHeadCommit(
  tools: Awaited<ReturnType<MultiServerMCPClient['listTools']>>,
  toolCalls: { name: string; args: unknown }[],
): Promise<DbtHeadCommit> {
  try {
    const listCommits = tools.find((tool) => isTool(tool.name, 'list_commits'));
    const read = toolCalls.find((call) =>
      isTool(call.name, 'get_file_contents'),
    );
    const args = (read?.args ?? {}) as { owner?: string; repo?: string };
    if (!listCommits || !args.owner || !args.repo) return null;

    const result = parseToolResult(
      await listCommits.invoke({
        owner: args.owner,
        repo: args.repo,
        perPage: 1,
      }),
    );
    const first = Array.isArray(result) ? result[0] : undefined;
    const sha = (first as { sha?: unknown } | undefined)?.sha;
    return typeof sha === 'string'
      ? { sha, resolvedAt: new Date().toISOString() }
      : null;
  } catch (err) {
    logger.warn(
      `Could not resolve the dbt repo head commit: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
