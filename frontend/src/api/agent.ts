import { apiCall } from "./client"
import { AgentRunInput, AgentRunResult } from "../types/canonical"

// runAgent - POST /integrations/agent/run.
//
// Note: HIL responses (kind: "pick_*") and domain failures (kind: "fail") come
// back as 200 with a typed body - they are NOT errors at the HTTP layer. Only
// 5xx, 401, network failures throw ApiError. The component layer maps the
// AgentRunResult discriminated union into UI; it doesn't have to care about
// HTTP status codes for the typed branches.
export async function runAgent(
    input: AgentRunInput,
    sessionId: string,
): Promise<AgentRunResult> {
    return await apiCall<AgentRunResult>("/integrations/agent/run", {
        method: "POST",
        body: input,
        sessionId,
    })
}
