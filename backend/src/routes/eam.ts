import { Router, Request, Response } from "express"
import { createEamWorkRequest, getEamCollection, getEamEquipmentForOrg, getEamUserOrganizations } from "../services/eamClient"
import { toEquipmentOption, EamAssetRaw, EamPositionRaw } from "../services/eamMappers"
import { findProblemCode, getProblemCodes } from "../services/problemCodes"
import { findWorkRequestType, getWorkRequestTypes } from "../services/workRequestTypes"
import {
    IntegrationError,
    integrationErrorHttpStatus
} from "../errors/integrationError"
import { requireAuth } from "../middleware/requireAuth"

const router = Router()

// GET /smoke/assets[?<any-eam-supported-param>]
// Returns canonical EquipmentOption[] - vendor-free, frontend-ready.
// Protected: per-user EAM creds drive the call (no shared service account).
router.get("/smoke/assets", requireAuth, async (req: Request, res: Response) => {
    try {
        const collection = await getEamCollection<EamAssetRaw>(
            "/assets",
            req.auth!.eamAuth,
            req.query as Record<string, unknown>
        )
        const records = collection.records.map(toEquipmentOption)
        return res.send({
            status: "ok",
            provider: "eam",
            params: req.query,
            records,
            total: collection.total,
            cursor: collection.cursor,
            entityName: collection.entityName
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            return res.status(integrationErrorHttpStatus(err)).send(err.toJSON())
        }
        // fallback if nothing worked
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error during EAM assets smoke test"
        })
    }
})


// GET /smoke/organizations
// Returns the orgs the authenticated user has access to in EAM (not the
// global org catalog). The "*" wildcard is filtered out by the helper.
// Protected: per-user EAM creds drive the call (no shared service account).
router.get("/smoke/organizations", requireAuth, async (req: Request, res: Response) =>{
    try {
        const result = await getEamUserOrganizations(req.auth!.eamAuth)
        return res.send({
            status: "ok",
            provider: "eam",
            ...result
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            return res.status(integrationErrorHttpStatus(err)).send(err.toJSON())
        }
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error during EAM organization smoke test"
        })
    }
})

// GET /smoke/equipment-for?orgCode=VTAT[&cursor=N&pageSize=N&includeInactive=1]
// Equipment (Position-type) scoped to a specific EAM org code, paginated via
// EAM's cursorposition. Active-only by default; opt in to inactive equipment
// with includeInactive=1. Pass nextCursor from a prior response back as
// cursor=N to fetch the next page.
//
// Protected: the requireAuth middleware enforces a valid session and attaches
// req.auth. The helper uses req.auth.eamAuth so EAM scopes the response to
// the logged-in user's org access, not the env-default integration user.
router.get("/smoke/equipment-for", requireAuth, async (req: Request, res: Response) => {
    const orgCode = typeof req.query.orgCode === "string" ? req.query.orgCode : undefined
    if (!orgCode) {
        return res.status(400).send({
            code: "VALIDATION_ERROR",
            message: "orgCode query parameter is required",
        })
    }

    // Numeric query params arrive as strings; coerce defensively. Invalid /
    // negative values fall back to defaults rather than throwing - smoke route,
    // not a strict business endpoint.
    const cursorRaw = typeof req.query.cursor === "string" ? Number(req.query.cursor) : 0
    const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 0 ? cursorRaw : 0
    const pageSizeRaw = typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : 50
    const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : 50
    const includeInactive = req.query.includeInactive === "1"

    try {
        // requireAuth guarantees req.auth is set; the ! tells TS what
        // the middleware contract already promises at runtime.
        const result = await getEamEquipmentForOrg(orgCode, req.auth!.eamAuth, {
            cursor,
            pageSize,
            activeOnly: !includeInactive,
        })
        return res.send({
            status: "ok",
            provider: "eam",
            orgCode,
            cursor,
            pageSize,
            ...result,
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            return res.status(integrationErrorHttpStatus(err)).send(err.toJSON())
        }
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error during EAM equipment-for-org smoke test",
        })
    }
})

// GET /smoke/positions-raw?cursor=N
// Pass-through to EAM /positions with NO org filter applied. Returns the same
// mixed-org global page Swagger shows, for sanity-checking that:
//   1) our backend can reach EAM,
//   2) EAM returns global Position records regardless of the organization
//      header (VTAT records are sparse in this stream),
//   3) the "empty records" responses from /smoke/equipment-for are a filter
//      effect, not a connectivity bug.
// Protected: per-user EAM creds drive the call (no shared service account).
router.get("/smoke/positions-raw", requireAuth, async (req: Request, res: Response) => {
    const cursorRaw = typeof req.query.cursor === "string" ? Number(req.query.cursor) : 0
    const cursor = Number.isFinite(cursorRaw) && cursorRaw >= 0 ? cursorRaw : 0

    try {
        const headers: Record<string, string> = {}
        if (cursor > 0) headers.cursorposition = String(cursor)

        const collection = await getEamCollection<EamPositionRaw>(
            "/positions",
            req.auth!.eamAuth,
            undefined,
            headers
        )

        // Map for readability + summarize org distribution so the user can see
        // exactly how thin VTAT (or whatever) is in this slice.
        const summary: Record<string, number> = {}
        for (const r of collection.records) {
            const org = r.POSITIONID?.ORGANIZATIONID?.ORGANIZATIONCODE ?? "(none)"
            summary[org] = (summary[org] ?? 0) + 1
        }

        const compactRecords = collection.records.map((r) => ({
            equipmentCode: r.POSITIONID?.EQUIPMENTCODE,
            description: r.POSITIONID?.DESCRIPTION,
            organizationCode: r.POSITIONID?.ORGANIZATIONID?.ORGANIZATIONCODE,
            outOfService: r.OUTOFSERVICE,
        }))

        return res.send({
            status: "ok",
            provider: "eam",
            cursor,
            cursorMeta: collection.cursor,
            total: collection.total,
            entityName: collection.entityName,
            recordsReturned: collection.records.length,
            orgDistribution: summary,
            records: compactRecords,
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            return res.status(integrationErrorHttpStatus(err)).send(err.toJSON())
        }
        return res.status(500).send({
            code: "INTERNAL_ERROR",
            message: "Unexpected error during EAM positions-raw smoke test",
        })
    }
})

// GET /smoke/problem-codes
// Returns the canonical ProblemCodeOption[] for the work-request "what's wrong"
// dropdown. Backed by a static lookup (services/problemCodes.ts) sourced from
// docs/Problem Codes.xlsx - in this EAM tenant the codes are a fixed
// enumeration, not a per-org/per-class lookup, so a static module is the
// honest shape. If EAM later exposes a tenant-scoped problem-code endpoint
// we swap the service implementation; the route stays unchanged.
//
// Gated with requireAuth for consistency with the rest of the API surface
// (the actual work-request flow requires login anyway). No EAM round-trip,
// so the response is instant and there's no upstream-error path to handle.
router.get("/smoke/problem-codes", requireAuth, async (_req: Request, res: Response) => {
    const records = getProblemCodes()
    return res.send({
        status: "ok",
        provider: "static",
        records,
        total: records.length,
    })
})

// GET /smoke/work-request-types
// Same static-lookup pattern as /smoke/problem-codes; backed by
// services/workRequestTypes.ts mirrored from docs/Work Request Type.xlsx.
// Frontend uses this to populate the "type" dropdown on the work-request form.
router.get("/smoke/work-request-types", requireAuth, async (_req: Request, res: Response) => {
    const records = getWorkRequestTypes()
    return res.send({
        status: "ok",
        provider: "static",
        records,
        total: records.length,
    })
})

// POST /smoke/work-request
// First write endpoint in the project. Validates the canonical input shape,
// resolves descriptions for problem code + type from the static lookups,
// injects requestedBy from the session (NEVER from the body), and forwards
// to EAM via createEamWorkRequest. EAM-assigned JOBNUM comes back in the
// canonical WorkRequestResult.
//
// Validation deliberately lives in this route (not in a shared validator
// module) - it's small enough that abstracting it would just hide what the
// rules actually are. If we add more write routes later we'll factor it.
const MAX_DESCRIPTION_LEN = 200

router.post("/smoke/work-request", requireAuth, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>

    // String-or-default-empty pattern (vs. type-narrowing helpers): keeps the
    // missing-field 400s simple to construct without a per-field utility.
    const organizationCode = typeof body.organizationCode === "string" ? body.organizationCode.trim() : ""
    const equipmentCode = typeof body.equipmentCode === "string" ? body.equipmentCode.trim() : ""
    const departmentCode = typeof body.departmentCode === "string" ? body.departmentCode.trim() : ""
    // locationCode is optional for the POC: EAM /positions doesn't return
    // LOCATIONID and Swagger confirms work-orders create without it. The
    // mapper omits the LOCATIONID block entirely when this is empty.
    const locationCode = typeof body.locationCode === "string" ? body.locationCode.trim() : ""
    const problemCode = typeof body.problemCode === "string" ? body.problemCode.trim() : ""
    const typeCode = typeof body.typeCode === "string" ? body.typeCode.trim() : ""
    const description = typeof body.description === "string" ? body.description.trim() : ""

    // Required-fields check. We list every missing field rather than
    // short-circuiting on the first - a frontend will get one round-trip's
    // worth of feedback instead of N round-trips for N missing fields.
    const missing: string[] = []
    if (!organizationCode) missing.push("organizationCode")
    if (!equipmentCode) missing.push("equipmentCode")
    if (!departmentCode) missing.push("departmentCode")
    if (!problemCode) missing.push("problemCode")
    if (!typeCode) missing.push("typeCode")
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

    // Lookup-by-code from the static catalogues. Unknown codes are 400, not
    // 502 - they're caller errors, not upstream failures.
    const problem = findProblemCode(problemCode)
    if (!problem) {
        return res.status(400).send({
            code: "VALIDATION_ERROR",
            message: `Unknown problemCode: ${problemCode}`,
        })
    }
    const wrType = findWorkRequestType(typeCode)
    if (!wrType) {
        return res.status(400).send({
            code: "VALIDATION_ERROR",
            message: `Unknown typeCode: ${typeCode}`,
        })
    }

    try {
        const result = await createEamWorkRequest(
            {
                organizationCode,
                equipmentCode,
                departmentCode,
                // Pass locationCode only when the caller provided one; the
                // mapper drops the LOCATIONID block from the body when empty.
                ...(locationCode ? { locationCode } : {}),
                problemCode,
                problemCodeDescription: problem.description,
                typeCode,
                typeDescription: wrType.description,
                description,
                // Source-of-truth for "who is creating this": session, not body.
                requestedBy: req.auth!.eamAuth.username,
            },
            req.auth!.eamAuth,
        )
        return res.send({
            status: "ok",
            provider: "eam",
            result,
        })
    } catch (err) {
        if (err instanceof IntegrationError) {
            return res.status(integrationErrorHttpStatus(err)).send(err.toJSON())
        }
        // toWorkRequestResult throws a plain Error if the envelope is malformed.
        // Treat that as 502 upstream-shape failure rather than 500 internal -
        // the bug is in EAM's response or our model of it, not in our request
        // handling.
        const message = err instanceof Error ? err.message : "unknown error"
        return res.status(502).send({
            code: "UPSTREAM_CONTRACT_ERROR",
            message,
        })
    }
})

export default router
