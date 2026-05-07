import OpenAi from "openai"
import { zodResponseFormat } from "openai/helpers/zod"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { env } from "../config/env"
import { IntegrationError, IntegrationErrorDetails } from "../errors/integrationError"

const PROVIDER = "llm" as const
const LLM_DEFAULT_TIMEOUT_MS = 30_000       // LLM calls are slower than REST APIs

export type ChatRole = "system" | "user" | "assistant"

export interface ChatMessage {
    role: ChatRole
    content: string
}

export interface ChatCompleteOpts {
    /* Sampling temperature. 0 = deterministic, recommended for structured tasks. */
    temperature?: number
    // Model name override (default env.OPENAI_MODEL)
    model?: string
}

const openai = new OpenAi({
    apiKey: env.OPENAI_API_KEY,
    timeout: LLM_DEFAULT_TIMEOUT_MS
})

console.log(
    `[llm] adapter ready - provider=openai model=${env.OPENAI_MODEL} key=${env.OPENAI_API_KEY.slice(0, 5)}***`
)

function normalizeOpenAiError(err: unknown, correlationId: string): IntegrationError {
    const e = err as { status?: number; code?: string; message?: string }
    const status = e?.status

    if (e?.code === "ETIMEDOUT" || e?.code === "ECONNABORTED") {
        return new IntegrationError({
            code: "UPSTREAM_TIMEOUT",
            message: "LLM request timed out",
            correlationId,
            details: { provider: PROVIDER },
        })
    }

    const details: IntegrationErrorDetails = { provider: PROVIDER }
    if (status !== undefined) details.status = status
    if (e?.message) details.upstreamMessage = e.message

    if (status === 401) {
        return new IntegrationError({
            code: "UPSTREAM_AUTH_FAILED",
            message: "LLM authentication failed - check OPENAI_API_KEY",
            correlationId,
            details,
        })
    }

    return new IntegrationError({
        code: "UPSTREAM_SERVICE_ERROR",
        message: status
            ? `LLM request failed with status ${status}`
            : "LLM request failed",
        correlationId,
        details,
    })
}


export async function chatComplete(
    messages: ChatMessage[],
    opts?: ChatCompleteOpts
): Promise<string> {
    const correlationId = randomUUID()
    const model = opts?.model ?? env.OPENAI_MODEL
    const startedAt = Date.now()

    console.log(`[llm] chat model=${model} msgs=${messages.length} cid=${correlationId}`)

    try {
        // Cast: our ChatMessage union is provider-agnostic by design; OpenAI's
        // per-role discriminated union is stricter. Safe because our role values
        // are a subset of OpenAI's accepted roles.
        const completion = await openai.chat.completions.create({
            model,
            messages: messages as OpenAi.Chat.ChatCompletionMessageParam[],
            temperature: opts?.temperature ?? 0,
        })
        const ms = Date.now() - startedAt
        const content = completion.choices[0]?.message?.content ?? ""

        console.log(`[llm] chat ${completion.usage?.total_tokens ?? "?"}tok (${ms}ms) cid=${correlationId}`)

        if (!content) {
            throw new IntegrationError({
                code: "CONTRACT_MAPPING_ERROR",
                message: "LLM returned empty content",
                correlationId,
                details: { provider: PROVIDER },
            })
        }
        return content
    } catch (err) {
        if (err instanceof IntegrationError) throw err
        throw normalizeOpenAiError(err, correlationId)
    }
}

// chatCompleteJson - structured-output variant. The LLM is forced to return
// JSON matching the provided Zod schema. Validation happens at the SDK level;
// we re-throw as IntegrationError if the response is null (refusal / schema mismatch).
export async function chatCompleteJson<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    schemaName: string,
    opts?: ChatCompleteOpts
): Promise<T> {
    const correlationId = randomUUID()
    const model = opts?.model ?? env.OPENAI_MODEL
    const startedAt = Date.now()

    console.log(`[llm] chat-json schema=${schemaName} model=${model} cid=${correlationId}`)

    try {
        const completion = await openai.chat.completions.parse({
            model,
            messages: messages as OpenAi.Chat.ChatCompletionMessageParam[],
            temperature: opts?.temperature ?? 0,
            response_format: zodResponseFormat(schema, schemaName),
        })
        const ms = Date.now() - startedAt
        const parsed = completion.choices[0]?.message?.parsed

        console.log(`[llm] chat-json ${completion.usage?.total_tokens ?? "?"}tok (${ms}ms) cid=${correlationId}`)

        if (parsed == null) {
            throw new IntegrationError({
                code: "CONTRACT_MAPPING_ERROR",
                message: "LLM structured output returned null (refusal or schema mismatch)",
                correlationId,
                details: { provider: PROVIDER },
            })
        }
        return parsed as T
    } catch (err) {
        if (err instanceof IntegrationError) throw err
        throw normalizeOpenAiError(err, correlationId)
    }
}