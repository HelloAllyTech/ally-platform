import { AIMessage, createAgent, HumanMessage, ToolMessage, toolStrategy } from "langchain";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { GoogleAuth } from "google-auth-library";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { ChatOpenAI } from "@langchain/openai";
import z from "zod"
import { AGENT_SYSTEM_PROMPT } from "../constants/analytics-agent.constants";


const LLM = new ChatOpenAI({
    model : process.env.OPENAI_CHAT_MODEL,
    apiKey : process.env.OPENAI_API_KEY,
    supportsStrictToolCalling : false,
    useResponsesApi : true
})

const outputSchema = z.object({
    response : z.string(),
    followUps : z.array(z.string()).optional()
})


const google = new GoogleAuth({
    scopes : ["https://www.googleapis.com/auth/bigquery"],
})

const authProvider: OAuthClientProvider = {
    get redirectUrl() {
        return undefined
    },
    get clientMetadata() {
        return { redirect_uris: [] }
    },
    clientInformation: () => undefined,
    tokens: async () => {
        const accessToken = await google.getAccessToken()
        if (!accessToken) {
            throw new Error("Failed to obtain a Google access token for the BigQuery MCP server")
        }
        return { access_token: accessToken, token_type: "Bearer" }
    },
    saveTokens: () => {},
    redirectToAuthorization: () => {
        throw new Error("Interactive OAuth is not supported; tokens come from GoogleAuth")
    },
    saveCodeVerifier: () => {},
    codeVerifier: () => {
        throw new Error("Interactive OAuth is not supported; tokens come from GoogleAuth")
    },
}


const client = new MultiServerMCPClient({
    servers : {
        bigQuery: {
            transport: "http",
            url: "https://bigquery.googleapis.com/mcp",
            authProvider
        },
    }
});

// add intermediate tables as well 
const AVAILABLE_TABLES = {
  // Marts
  "ally-analytics-prod.dbt_dev_marts.dim_organizations": "One row per customer organization: feature switches and lifetime totals of its learners, engagement buckets, practice, credits, AI cost and app use. Use for org health.",
  "ally-analytics-prod.dbt_dev_marts.dim_scenarios": "One row per roleplay scenario: settings and play stats (sessions, completions, scores, ratings, AI cost). Use for content performance and unused scenarios.",
  "ally-analytics-prod.dbt_dev_marts.dim_users": "One row per user: org, roles, XP, credits, lifetime practice, scores, tracks, badges, engagement status (active, at risk, dormant, never started).",
  "ally-analytics-prod.dbt_dev_marts.fct_assist_chats": "Scribe/Assist chats (counselor call notes). Description inferred from the name.",
  "ally-analytics-prod.dbt_dev_marts.fct_foundational_cuts": "Foundational skills assessment cuts. Description inferred from the name.",
  "ally-analytics-prod.dbt_dev_marts.fct_foundational_skill_levels": "Learners' foundational skill levels. Description inferred from the name.",
  "ally-analytics-prod.dbt_dev_marts.fct_llm_calls": "One row per AI call (LLM, speech-to-text, text-to-speech) with task, model, org, session and estimated USD cost. Use for AI usage and cost; flags internal tooling.",
  "ally-analytics-prod.dbt_dev_marts.fct_product_events": "One row per PostHog event (page views, clicks, tracked actions) with section, funnel step, user and org. Use for app usage and the Learn-to-rating funnel.",
  "ally-analytics-prod.dbt_dev_marts.fct_scenario_sessions": "One row per roleplay session: who, what, when, completion, minutes, AI judge score, attempt number, AI cost, quality checks, review and debrief. The main fact table.",
  "ally-analytics-prod.dbt_dev_marts.fct_track_enrollments": "One row per learner per track (course): items started and completed by type, quiz attempts, progress and days to complete.",

  // Intermediate
  "ally-analytics-prod.dbt_dev_intermediate.int_ai_usage_joined": "One row per AI call with estimated cost, model, org and session. Row-level base for AI cost analysis.",
  "ally-analytics-prod.dbt_dev_intermediate.int_case_sessions_joined": "One row per learner run through a case (ordered sequence of scenarios): steps reached and completed, sessions played.",
  "ally-analytics-prod.dbt_dev_intermediate.int_organizations_joined": "One row per real customer organization with account status and one true/false column per feature switch.",
  "ally-analytics-prod.dbt_dev_intermediate.int_posthog_events_joined": "One row per PostHog event with resolved user, org, staff flag, roleplay session, IST date and product area.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_path_sessions_joined": "One row per learner run through a scenario path (legacy Learning Pathway): steps reached and completed, sessions played.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_behaviors_joined": "One row per behavior-detection trigger in a session (SHOULD_DO / SHOULD_NOT_DO instructions the learner showed).",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_debrief_chats_joined": "One row per debrief chat thread: a learner's post-session conversation with the AI coach.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_events_joined": "One row per in-session event firing (authored events and guardrail triggers) with event name and detection settings.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_feedback_claims_joined": "One row per post-session feedback claim, judged by an AI judge against the transcript. Filter is_current_judgment.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_glossary_joined": "One row per session glossary report: how often the AI character said avoid-listed terms in a language.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_journeys_joined": "One row per session saying whether it was standalone or part of a case, scenario path or track.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_language_joined": "One row per language-quality judgment of a session, with error annotation counts by severity. Filter is_current_judgment.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_lifecycle_joined": "One row per infrastructure milestone of a session (room created, agent joined, etc.). From 9 July 2026.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_reviews_joined": "One row per session shared for peer or trainer review, with thread and comment counts.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_turn_drift_joined": "One row per judged AI-character turn: conversation-drift labels (coherence, on topic, in character). Filter is_current_judgment.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_turns_joined": "One row per turn measurement: AI response latency and its breakdown (STT, LLM, TTS). Split by speech_transport.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_sessions_joined": "One row per roleplay session with everything on the session itself. Row-level base of fct_scenario_sessions.",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenarios_joined": "One row per scenario with editorial settings and its published version.",
  "ally-analytics-prod.dbt_dev_intermediate.int_tenant_cohorts_joined": "One row per organization cohort with org name and live/deleted membership counts.",
  "ally-analytics-prod.dbt_dev_intermediate.int_track_enrollments_joined": "One row per learner enrollment in a track (course) with the track's catalog details.",
  "ally-analytics-prod.dbt_dev_intermediate.int_track_item_progress_joined": "One row per enrollment and track item: status, per-type progress, quiz attempts and journal responses.",
  "ally-analytics-prod.dbt_dev_intermediate.int_user_badges_joined": "One row per earned badge per learner with badge name, category, threshold and org.",
  "ally-analytics-prod.dbt_dev_intermediate.int_users_joined": "One row per user account with org, roles, cohort, XP and level, credits, AI-supervisor memory counts and Ally-staff flag.",
  "ally-analytics-prod.dbt_dev_intermediate.int_users_roles": "One row per role held by a user (users can have several), with org and grant time.",
  "ally-analytics-prod.dbt_dev_intermediate.int_xp_events_joined": "XP ledger: one row per XP award to a learner, linked to the session when applicable.",

  // Seeds
  "ally-analytics-prod.dbt_dev_seeds.ai_task_categories": "Lookup mapping each AI task to its task group and session-cost component.",
  "ally-analytics-prod.dbt_dev_seeds.foundational_skills": "Lookup of foundational skills. Description inferred from the name.",
  "ally-analytics-prod.dbt_dev_seeds.llm_pricing": "Per-model LLM token prices, plus speech-to-text per-minute and text-to-speech per-character rates, used to estimate AI cost.",
  "ally-analytics-prod.dbt_dev_seeds.posthog_event_catalog": "Dictionary of PostHog events (tracking plan): meaning, section and roleplay funnel step.",
  "ally-analytics-prod.dbt_dev_seeds.posthog_property_catalog": "Dictionary of PostHog event properties, showing which are loaded into the warehouse."
};


export async function invokeAnalyticalAgent(query : string , userId? : string , chatId? : string){
    console.log("entered the new function")
    const tools = await client.listTools()

    const agent = createAgent({
        model : LLM,
        systemPrompt : AGENT_SYSTEM_PROMPT.replace("{{AVAILABLE_TABLES}}",JSON.stringify(AVAILABLE_TABLES)),
        responseFormat : toolStrategy(outputSchema),
        tools,
    })

    const answer = await agent.invoke({
        messages : [new HumanMessage(query)],
    })

    const toolMessages = new Map(
        answer.messages
            .filter((el)=> el.type === "tool")
            .map((el)=> [(el as ToolMessage).tool_call_id, el as ToolMessage] as const)
    )

    // every call the agent made, paired with what the tool sent back
    const toolCalls = answer.messages
        .filter((el)=> el.type === "ai")
        .flatMap((el)=>(el as AIMessage).tool_calls ?? [])
        .map((call)=>{
            const result = call.id ? toolMessages.get(call.id) : undefined
            return {
                name : call.name,
                args : call.args,
                status : result?.status,
                data : parseToolResult(result?.content),
            }
        })

    // just the SQL that ran and the rows it returned, for display
    const queries = toolCalls
        .filter((el)=> el.name.includes("execute_sql"))
        .map((el)=>({
            sql : String(el.args?.query ?? el.args?.sql ?? ""),
            status : el.status,
            data : el.data,
        }))

    console.log({
        toolCalls : toolCalls.map((el)=>({
            name : el.name,
            args : el.args,
        })),
        response : answer.structuredResponse
    })

    return {
        toolCalls,
        queries,
        response : answer.structuredResponse,
    }

}

// MCP tools reply with text or content blocks; most carry JSON, so hand back parsed data when it is.
function parseToolResult(content : unknown){
    const text = typeof content === "string"
        ? content
        : Array.isArray(content)
            ? content.map((block)=> (typeof block === "string" ? block : (block as { text? : string })?.text ?? "")).join("")
            : undefined
    if (text === undefined) return content
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}
