import { createHash } from "crypto"
import { BaseCallbackHandler } from "@langchain/core/callbacks/base"
import type { AIMessage, BaseMessage } from "langchain"

/**
 * Everything the new analytical agent did to answer one question, in a shape that can be
 * stored or diffed: ordered tool steps with timings, the SQL that ran and the rows it returned,
 * the dbt files that were read, the tables inspected, the run config and any errors.
 *
 * This is additive telemetry - nothing in it feeds back into the answer.
 */

// A tool result larger than this (serialized) is cut and flagged, with its original size kept.
const RESULT_CHAR_CAP = 20_000
// Rows kept per SQL query; `rowCount` still reports the real total.
const SQL_ROW_SAMPLE_CAP = 50

type ToolRun = {
    runId : string
    toolCallId? : string
    order : number
    toolName : string
    args : unknown
    startedAtMs : number
    endedAtMs? : number
    status : "success" | "error"
    content? : unknown
    error? : string
}

// MCP tools reply with text or content blocks; most carry JSON, so hand back parsed data when it is.
export function parseToolResult(content : unknown){
    const text = flattenText(content)
    if (text === undefined) return content
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

function flattenText(content : unknown) : string | undefined {
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        return content.map((block)=> (typeof block === "string" ? block : (block as { text? : string })?.text ?? "")).join("")
    }
    return undefined
}

function rawText(content : unknown) : string {
    if (content === undefined || content === null) return ""
    const text = flattenText(content)
    if (text !== undefined) return text
    try {
        return JSON.stringify(content) ?? ""
    } catch {
        return String(content)
    }
}

/** Collects one record per tool run, with wall-clock timing the agent result itself doesn't carry. */
export class AnalyticalAgentTraceHandler extends BaseCallbackHandler {
    name = "analytical-agent-trace"
    // Await handlers so start/end timestamps are taken when the tool really starts/ends.
    awaitHandlers = true

    readonly runs = new Map<string, ToolRun>()
    readonly llmErrors : { message : string, at : string }[] = []
    private order = 0

    handleToolStart(tool : { name? : string }, input : string, runId : string, _parentRunId? : string, _tags? : string[], _metadata? : Record<string, unknown>, runName? : string, toolCallId? : string){
        let args : unknown = input
        try {
            args = JSON.parse(input)
        } catch {
            // not JSON - keep the raw string
        }
        this.order += 1
        this.runs.set(runId, {
            runId,
            toolCallId,
            order : this.order,
            toolName : runName ?? tool?.name ?? "unknown",
            args,
            startedAtMs : Date.now(),
            status : "success",
        })
    }

    handleToolEnd(output : unknown, runId : string){
        const run = this.runs.get(runId)
        if (!run) return
        run.endedAtMs = Date.now()
        // The tool node hands back a ToolMessage ({ content, status }) or the bare content.
        const message = output as { content? : unknown, status? : string } | undefined
        const isMessage = !!message && typeof message === "object" && "content" in message
        run.content = isMessage ? message!.content : output
        if (isMessage && message!.status === "error") {
            run.status = "error"
            run.error = rawText(message!.content).slice(0, 2000)
        }
    }

    handleToolError(err : Error, runId : string){
        const run = this.runs.get(runId)
        if (!run) return
        run.endedAtMs = Date.now()
        run.status = "error"
        run.error = (err?.message ?? String(err)).slice(0, 2000)
    }

    handleLLMError(err : Error){
        this.llmErrors.push({ message : (err?.message ?? String(err)).slice(0, 2000), at : new Date().toISOString() })
    }

    ordered() : ToolRun[] {
        return [...this.runs.values()].sort((a, b)=> a.order - b.order)
    }
}

function capResult(parsed : unknown){
    const serialized = typeof parsed === "string" ? parsed : (JSON.stringify(parsed) ?? "")
    if (serialized.length <= RESULT_CHAR_CAP) {
        return { value : parsed, truncated : false, originalSize : serialized.length }
    }
    return { value : serialized.slice(0, RESULT_CHAR_CAP), truncated : true, originalSize : serialized.length }
}

function extractRows(data : unknown) : unknown[] | null {
    if (Array.isArray(data)) return data
    if (data && typeof data === "object") {
        for (const key of ["rows", "result", "results", "data"]) {
            const value = (data as Record<string, unknown>)[key]
            if (Array.isArray(value)) return value
        }
    }
    return null
}

function extractRowCount(data : unknown, rows : unknown[] | null) : number | null {
    if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const key of ["totalRows", "total_rows", "rowCount", "row_count"]) {
            const n = Number((data as Record<string, unknown>)[key])
            if (Number.isFinite(n)) return n
        }
    }
    return rows ? rows.length : null
}

function tableNameFromArgs(args : unknown) : string {
    const a = (args ?? {}) as Record<string, unknown>
    const direct = a.table ?? a.tableName
    if (typeof direct === "string") return direct
    return [
        a.projectId ?? a.project_id,
        a.datasetId ?? a.dataset_id,
        a.tableId ?? a.table_id,
    ].filter(Boolean).join(".")
}

const SHA_40 = /^[0-9a-f]{40}$/i

export type DbtHeadCommit = {
    sha : string
    resolvedAt : string
} | null

export function buildAgentTrace(input : {
    question : string
    startedAtMs : number
    durationMs : number
    structured? : { response? : string, followUps? : string[] }
    handler : AnalyticalAgentTraceHandler
    newMessages : BaseMessage[]
    headCommit : DbtHeadCommit
    config : {
        model : string
        systemPrompt : string
        modelSettings : Record<string, unknown>
        allowedTables : string[]
    }
}){
    const runs = input.handler.ordered()
    const allowed = new Set(input.config.allowedTables)

    const steps = runs.map((run, i)=>({
        step : i + 1,
        toolName : run.toolName,
        toolCallId : run.toolCallId,
        args : run.args,
        status : run.status,
        startedAt : new Date(run.startedAtMs).toISOString(),
        durationMs : run.endedAtMs !== undefined ? run.endedAtMs - run.startedAtMs : null,
        result : run.status === "error"
            ? { value : run.error, truncated : false, originalSize : run.error?.length ?? 0 }
            : capResult(parseToolResult(run.content)),
        error : run.error,
    }))

    const sqlQueries = runs
        .map((run, i)=> ({ run, step : i + 1 }))
        .filter(({ run })=> run.toolName.includes("execute_sql"))
        .map(({ run, step })=>{
            const a = (run.args ?? {}) as Record<string, unknown>
            const data = run.status === "error" ? undefined : parseToolResult(run.content)
            const rows = extractRows(data)
            return {
                step,
                sql : String(a.query ?? a.sql ?? ""),
                status : run.status,
                durationMs : run.endedAtMs !== undefined ? run.endedAtMs - run.startedAtMs : null,
                rowCount : extractRowCount(data, rows),
                rows : rows ? rows.slice(0, SQL_ROW_SAMPLE_CAP) : null,
                rowsSampled : !!rows && rows.length > SQL_ROW_SAMPLE_CAP,
                error : run.error,
            }
        })

    const dbtFilesRead = runs
        .map((run, i)=> ({ run, step : i + 1 }))
        .filter(({ run })=> run.toolName === "get_file_contents" && run.status === "success")
        .map(({ run, step })=>{
            const a = (run.args ?? {}) as Record<string, unknown>
            const text = rawText(run.content)
            const parsed = parseToolResult(run.content)
            // The server reports the blob SHA in its message and may echo a resolved repo:// URI.
            const blobSha = text.match(/\(SHA:\s*([0-9a-f]{7,40})\)/i)?.[1] ?? null
            const resourceUri = text.match(/repo:\/\/[^"\s\\]+/)?.[0] ?? null
            const uriSha = resourceUri?.match(/\/sha\/([0-9a-f]{40})\//i)?.[1] ?? null
            const requestedRef = typeof a.ref === "string" ? a.ref : null
            const requestedSha = typeof a.sha === "string" ? a.sha : null

            let commitSha : string | null = null
            let commitShaSource : string | null = null
            if (uriSha) {
                commitSha = uriSha
                commitShaSource = "resource-uri"
            } else if (requestedSha && SHA_40.test(requestedSha)) {
                commitSha = requestedSha
                commitShaSource = "request-sha"
            } else if (requestedRef && SHA_40.test(requestedRef)) {
                commitSha = requestedRef
                commitShaSource = "request-ref"
            } else if (input.headCommit) {
                // No commit in the response: fall back to the default branch's head, looked up
                // right after the run. It can differ if the branch moved mid-run.
                commitSha = input.headCommit.sha
                commitShaSource = "default-branch-head-after-run"
            }

            return {
                step,
                path : String(a.path ?? ""),
                repo : [a.owner, a.repo].filter(Boolean).join("/"),
                ref : requestedRef ?? requestedSha ?? "default branch (none specified)",
                commitSha,
                commitShaSource,
                blobSha,
                resourceUri,
                isDirectory : Array.isArray(parsed),
            }
        })

    const tablesInspected = runs
        .map((run, i)=> ({ run, step : i + 1 }))
        .filter(({ run })=> run.toolName === "get_table_info")
        .map(({ run, step })=>{
            const table = tableNameFromArgs(run.args)
            return {
                step,
                table,
                inAllowedList : allowed.has(table),
                status : run.status,
                durationMs : run.endedAtMs !== undefined ? run.endedAtMs - run.startedAtMs : null,
                args : run.args,
                error : run.error,
            }
        })

    const errors = [
        ...runs
            .map((run, i)=> ({ run, step : i + 1 }))
            .filter(({ run })=> run.status === "error")
            .map(({ run, step })=>({ source : "tool" as const, step, toolName : run.toolName, message : run.error ?? "" })),
        ...input.handler.llmErrors.map((e)=>({ source : "llm" as const, step : null, toolName : null, message : e.message, at : e.at })),
    ]

    // Inferred: the agent calling the same tool again after it failed. The OpenAI client's own
    // transport-level retries happen below this layer and are not visible here.
    const retries = runs.flatMap((run, i)=>{
        if (run.status !== "error") return []
        const next = runs.slice(i + 1).find((later)=> later.toolName === run.toolName)
        if (!next) return []
        return [{
            toolName : run.toolName,
            failedStep : i + 1,
            retryStep : runs.indexOf(next) + 1,
            retryStatus : next.status,
        }]
    })

    // Tokens come from the model's own usage metadata on the AI messages produced this run.
    const aiMessages = input.newMessages.filter((m)=> m.type === "ai") as AIMessage[]
    const usage = aiMessages.map((m)=> m.usage_metadata).filter(Boolean)
    const tokens = usage.length === 0 ? null : {
        llmCalls : usage.length,
        inputTokens : usage.reduce((n, u)=> n + (u?.input_tokens ?? 0), 0),
        outputTokens : usage.reduce((n, u)=> n + (u?.output_tokens ?? 0), 0),
        totalTokens : usage.reduce((n, u)=> n + (u?.total_tokens ?? 0), 0),
        reasoningTokens : usage.reduce((n, u)=> n + (u?.output_token_details?.reasoning ?? 0), 0),
        cachedInputTokens : usage.reduce((n, u)=> n + (u?.input_token_details?.cache_read ?? 0), 0),
    }

    return {
        question : input.question,
        startedAt : new Date(input.startedAtMs).toISOString(),
        durationMs : input.durationMs,
        answer : input.structured?.response,
        followUps : input.structured?.followUps ?? [],
        steps,
        sqlQueries,
        dbtFilesRead,
        tablesInspected,
        config : {
            model : input.config.model,
            systemPromptHash : createHash("sha256").update(input.config.systemPrompt).digest("hex"),
            modelSettings : input.config.modelSettings,
            allowedTables : input.config.allowedTables,
            tokens,
        },
        errors,
        retries,
    }
}
