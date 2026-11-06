import { AIMessage, BaseMessage, createAgent, HumanMessage, ToolMessage, toolStrategy } from "langchain";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { GoogleAuth } from "google-auth-library";
import { createAppAuth } from "@octokit/auth-app";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { ChatOpenAI } from "@langchain/openai";
import z from "zod"
import { AGENT_LIMITS, AGENT_SYSTEM_PROMPT } from "../constants/analytics-agent.constants";
import { AnalyticalAgentTraceHandler, buildAgentTrace, DbtHeadCommit, parseToolResult } from "./analytical-agent-trace";


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


const RECURSION_LIMIT = 60

export type AnalyticalAgentHistoryTurn = {
    question : string
    sql? : string
    answer? : string
}

// The server holds no conversation: the client replays prior answered turns so follow-ups
// ("and by language?") have context. They go in as ONE labelled human message rather than as
// assistant messages: replayed assistant turns are plain text, and the model copies that format
// and answers in plain text instead of calling the structured-output tool - which leaves
// `structuredResponse` empty. History is context only; every query still runs through the tools.
function buildInputMessages(query : string , history : AnalyticalAgentHistoryTurn[] = []){
    const turns = history.slice(-AGENT_LIMITS.MAX_HISTORY_TURNS)
    if (turns.length === 0) return [new HumanMessage(query)]

    const transcript = turns
        .map((turn , i)=> [
            `Previous question ${i + 1}: ${turn.question}`,
            turn.sql ? `SQL that ran:\n${turn.sql}` : undefined,
            turn.answer ? `Answer given: ${turn.answer}` : undefined,
        ].filter(Boolean).join("\n"))
        .join("\n\n")

    return [new HumanMessage(
        "Earlier in this conversation (context only - use it to resolve references like \"that\" or \"the same period\"; " +
        "re-run queries rather than reusing numbers from it):\n\n" +
        `${transcript}\n\n---\n\nCurrent question: ${query}`
    )]
}

// When the model writes the structured answer out as text (sometimes inside a code fence)
// instead of calling the tool, recover the fields; otherwise treat the whole text as the answer.
function parseStructuredText(text : string){
    const unfenced = text.replace(/^```(?:json)?\s*/i , "").replace(/\s*```$/ , "").trim()
    try {
        const parsed = outputSchema.safeParse(JSON.parse(unfenced))
        if (parsed.success) return { response : parsed.data.response , followUps : parsed.data.followUps ?? [] }
    } catch {
        // not JSON - plain prose answer
    }
    return { response : text , followUps : [] as string[] }
}

// Plain text of the last assistant message, for when the model answered without the structured tool.
function lastAiText(messages : BaseMessage[]) : string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message.type !== "ai") continue
        const content = message.content as unknown
        const text = typeof content === "string"
            ? content
            : Array.isArray(content)
                ? content.map((block)=> (typeof block === "string" ? block : (block as { text? : string })?.text ?? "")).join("")
                : ""
        if (text.trim()) return text.trim()
    }
    return undefined
}

export async function invokeAnalyticalAgent(query : string , history : AnalyticalAgentHistoryTurn[] = [] , userId? : string , chatId? : string){
    console.log("entered the new function")
    const startedAtMs = Date.now()
    const tools = await client.listTools()

    const systemPrompt = AGENT_SYSTEM_PROMPT.replace("{{AVAILABLE_TABLES}}",Object.keys(AVAILABLE_TABLES).join("\n"))
    const agent = createAgent({
        model : LLM,
        systemPrompt,
        responseFormat : toolStrategy(outputSchema),
        tools
    })

    const inputMessages = buildInputMessages(query , history)
    const traceHandler = new AnalyticalAgentTraceHandler()
    const answer = await agent.invoke({
        messages : inputMessages,
    } , {
        recursionLimit : RECURSION_LIMIT,
        callbacks : [traceHandler],
    })

    // The model should finish through the structured-output tool. If it replied in plain text
    // instead, use that text rather than returning no response at all.
    const structured = answer.structuredResponse ?? (()=>{
        const text = lastAiText(answer.messages.slice(inputMessages.length))
        if (text === undefined) return undefined
        console.warn("analytical agent finished without a structured response; falling back to its last message")
        return parseStructuredText(text)
    })()
    if (!structured) {
        throw new Error("The analytical agent finished without producing an answer")
    }

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

    // Extra telemetry for this question. Built after the run, so it can never change the answer.
    const dbtFileReads = toolCalls.some((el)=> el.name === "get_file_contents")
    const headCommit = dbtFileReads ? await resolveDbtHeadCommit(tools, toolCalls) : null
    const trace = buildAgentTrace({
        question : query,
        startedAtMs,
        durationMs : Date.now() - startedAtMs,
        structured,
        handler : traceHandler,
        newMessages : answer.messages.slice(inputMessages.length),
        headCommit,
        config : {
            model : String(LLM.model),
            systemPrompt,
            modelSettings : {
                temperature : LLM.temperature ?? null,
                useResponsesApi : true,
                supportsStrictToolCalling : false,
                recursionLimit : RECURSION_LIMIT,
            },
            allowedTables : Object.keys(AVAILABLE_TABLES),
        },
    })

     console.log({
        toolCalls : toolCalls.map((el)=>({
            name : el.name,
            args : el.args,
        })),
        response : structured,
        ...trace
    })

    return {
        toolCalls,
        queries,
        response : structured,
        ...trace,
    }

}

// The commit the default branch of the dbt repo points at, used to say which version of the
// docs the agent read. Best effort: null if the lookup fails or the tool isn't exposed.
async function resolveDbtHeadCommit(
    tools : Awaited<ReturnType<typeof client.listTools>>,
    toolCalls : { name : string, args : unknown }[],
) : Promise<DbtHeadCommit> {
    try {
        const listCommits = tools.find((tool)=> tool.name === "list_commits")
        const read = toolCalls.find((call)=> call.name === "get_file_contents")
        const args = (read?.args ?? {}) as { owner? : string, repo? : string }
        if (!listCommits || !args.owner || !args.repo) return null

        const result = parseToolResult(await listCommits.invoke({ owner : args.owner, repo : args.repo, perPage : 1 }))
        const first = Array.isArray(result) ? result[0] : undefined
        const sha = (first as { sha? : unknown } | undefined)?.sha
        return typeof sha === "string" ? { sha, resolvedAt : new Date().toISOString() } : null
    } catch (err) {
        console.warn("could not resolve the dbt repo head commit", err instanceof Error ? err.message : err)
        return null
    }
}
