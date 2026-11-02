import { AIMessage, createAgent, HumanMessage, ToolMessage, toolStrategy } from "langchain";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { GoogleAuth } from "google-auth-library";
import { createAppAuth } from "@octokit/auth-app";
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


const github = createAppAuth({
    appId : process.env.GITHUB_APP_ID!,
    privateKey : process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    installationId : process.env.GITHUB_APP_INSTALLATION_ID!,
})

const githubAuthProvider: OAuthClientProvider = {
    get redirectUrl() {
        return undefined
    },
    get clientMetadata() {
        return { redirect_uris: [] }
    },
    clientInformation: () => undefined,
    tokens: async () => {
        const { token } = await github({ type : "installation" })
        return { access_token: token, token_type: "Bearer" }
    },
    saveTokens: () => {},
    redirectToAuthorization: () => {
        throw new Error("Interactive OAuth is not supported; tokens come from the GitHub App")
    },
    saveCodeVerifier: () => {},
    codeVerifier: () => {
        throw new Error("Interactive OAuth is not supported; tokens come from the GitHub App")
    },
}


const client = new MultiServerMCPClient({
    servers : {
        bigQuery: {
            transport: "http",
            url: "https://bigquery.googleapis.com/mcp",
            authProvider
        },
        github: {
            transport: "http",
            url: "https://api.githubcopilot.com/mcp/readonly",
            headers: { "X-MCP-Toolsets": "repos,git" },
            authProvider: githubAuthProvider
        },
    }
});

// add intermediate tables as well 
const AVAILABLE_TABLES = {
  // Marts
  "ally-analytics-prod.dbt_dev_marts.dim_organizations": "dim_organizations.yml",
  "ally-analytics-prod.dbt_dev_marts.dim_scenarios": "dim_scenarios.yml",
  "ally-analytics-prod.dbt_dev_marts.dim_users": "dim_users.yml",
  "ally-analytics-prod.dbt_dev_marts.fct_assist_chats": "fct_assist_chats.yml",
  "ally-analytics-prod.dbt_dev_marts.fct_foundational_cuts": "fct_foundational_cuts.yml",
  "ally-analytics-prod.dbt_dev_marts.fct_foundational_skill_levels": "fct_foundational_skill_levels.yml",
  "ally-analytics-prod.dbt_dev_marts.fct_llm_calls": "fct_llm_calls.yml",
  "ally-analytics-prod.dbt_dev_marts.fct_product_events": "fct_product_events.yml",
  "ally-analytics-prod.dbt_dev_marts.fct_scenario_sessions": "fct_scenario_sessions.yml",
  "ally-analytics-prod.dbt_dev_marts.fct_track_enrollments": "fct_track_enrollments.yml",

  // Intermediate
  "ally-analytics-prod.dbt_dev_intermediate.int_ai_usage_joined": "int_ai_usage_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_case_sessions_joined": "int_case_sessions_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_organizations_joined": "int_organizations_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_posthog_events_joined": "int_posthog_events_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_path_sessions_joined": "int_scenario_path_sessions_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_behaviors_joined": "int_scenario_session_behaviors_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_debrief_chats_joined": "int_scenario_session_debrief_chats_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_events_joined": "int_scenario_session_events_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_feedback_claims_joined": "int_scenario_session_feedback_claims_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_glossary_joined": "int_scenario_session_glossary_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_journeys_joined": "int_scenario_session_journeys_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_language_joined": "int_scenario_session_language_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_lifecycle_joined": "int_scenario_session_lifecycle_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_reviews_joined": "int_scenario_session_reviews_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_turn_drift_joined": "int_scenario_session_turn_drift_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_session_turns_joined": "int_scenario_session_turns_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenario_sessions_joined": "int_scenario_sessions_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_scenarios_joined": "int_scenarios_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_tenant_cohorts_joined": "int_tenant_cohorts_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_track_enrollments_joined": "int_track_enrollments_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_track_item_progress_joined": "int_track_item_progress_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_user_badges_joined": "int_user_badges_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_users_joined": "int_users_joined.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_users_roles": "int_users_roles.yml",
  "ally-analytics-prod.dbt_dev_intermediate.int_xp_events_joined": "int_xp_events_joined.yml",

  // Seeds
  "ally-analytics-prod.dbt_dev_seeds.ai_task_categories": "ai_task_categories.yml",
  "ally-analytics-prod.dbt_dev_seeds.foundational_skills": "foundational_skills.yml",
  "ally-analytics-prod.dbt_dev_seeds.llm_pricing": "llm_pricing.yml",
  "ally-analytics-prod.dbt_dev_seeds.posthog_event_catalog": "posthog_event_catalog.csv",
  "ally-analytics-prod.dbt_dev_seeds.posthog_property_catalog": "posthog_property_catalog.csv"
};


export async function invokeAnalyticalAgent(query : string , userId? : string , chatId? : string){
    console.log("entered the new function")
    const tools = await client.listTools()

    const agent = createAgent({
        model : LLM,
        systemPrompt : AGENT_SYSTEM_PROMPT.replace("{{AVAILABLE_TABLES}}",Object.keys(AVAILABLE_TABLES).join("\n")),
        responseFormat : toolStrategy(outputSchema),
        tools
    })

    const answer = await agent.invoke({
        messages : [new HumanMessage(query)],
    } , {
        recursionLimit : 60
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
