import { Router, Request, Response } from "express"
import { runAgent } from "../services/agentOrchestrator"
import { AgentRunInput } from "../types/canonical"
import {
    IntegrationError,
    integrationErrorHttpStatus
} from "../errors/integrationError"

const router = Router()

// Same description-length cap as POST /smoke/work-request. Both fields are
// the same field semantically - the agent's `description` becomes the WR
// `description` after resolution. Capping consistently means a string that
// passes the agent input check will pass the WR check too.
const MAX_DESCRIPTION_LEN = 200

// POST /integrations/agent/run
//
// Single endpoint, idempotent input. The frontend calls it with email +
// description on the first invocation; if a HIL pick variant comes back,
// it re-calls with the user's chosen value filled in. The orchestrator
// skips stages whose inputs are already resolved.
//
// Why hand-rolled validation (no zod yet):
//   Same justification as POST /smoke/work-request - the input is small,
//   the rules are direct, and abstracting them would just hide what's
//   actually being checked. We'll factor when there are 3+ write routes
//   with overlapping shapes.
router.post("/run", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>

    const email = typeof body.email === "string" ? body.email.trim() : ""
    const description = typeof body.description === "string" ? body.description.trim() : ""

    // Optional pre-resolved fields. We coerce empty strings to undefined so
    // downstream stages can use a simple `if (input.organizationCode)` skip
    // check rather than `if (input.organizationCode && input.organizationCode.length > 0)`.
    const optionalString = (v: unknown): string | undefined => {
        if (typeof v !== "string") return undefined
        const trimmed = v.trim()
        return trimmed.length > 0 ? trimmed : undefined
    }

    const missing: string[] = []
    if (!email) missing.push("email")
    if (!description) missing.push("description")
    if (missing.length > 0) {
        return res.status(400).send({
            code: "VALIDATION_ERROR",
            message: `Missing required field(s): ${missing.join(", ")}`,
            missing,
        })
    }

    if (description.length > MAX_DESCRIPTION_LEN) {
        return res.status(400).send({
            code: "VALIDATION_ERROR",
            message: `description exceeds ${MAX_DESCRIPTION_LEN} chars (got ${description.length})`,
        })
    }

    const input: AgentRunInput = {
        email,
        description,
        organizationCode: optionalString(body.organizationCode),
        equipmentCode: optionalString(body.equipmentCode),
        problemCode: optionalString(body.problemCode),
        typeCode: optionalString(body.typeCode),
    }

    // stages_preresolved: 0..4 count of pre-resolved code fields. Demo-friendly
    // signal in logs to distinguish a fresh run (0) from a HIL re-entry (1+).
    const stagesPreresolved =
        (input.organizationCode ? 1 : 0) +
        (input.equipmentCode ? 1 : 0) +
        (input.problemCode ? 1 : 0) +
        (input.typeCode ? 1 : 0)

    // Entry log. cid is undefined here - runAgent generates it inside. The exit
    // log uses result.correlationId so route + orchestrator share one cid; we
    // accept a momentary asymmetry where the entry line has no cid (the cost of
    // not threading a cid generator through the orchestrator).
    const startedAt = Date.now()
    console.log(
        `[agent.route] entry email=${input.email} stages_preresolved=${stagesPreresolved} desc_len=${input.description.length}`
    )

    try {
        const result = await runAgent(input)
        console.log(
            `[agent.route] exit cid=${result.correlationId} outcome=${result.kind} duration_ms=${Date.now() - startedAt}`
        )
        return res.send(result)
    } catch (err) {
        const duration = Date.now() - startedAt
        if (err instanceof IntegrationError) {
            console.log(
                `[agent.route] exit error=integration code=${err.code} duration_ms=${duration}`
            )
            return res.status(integrationErrorHttpStatus(err)).send(err.toJSON())
        }
        console.log(`[agent.route] exit error=internal duration_ms=${duration}`)
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error during agent run",
        })
    }
})

export default router
