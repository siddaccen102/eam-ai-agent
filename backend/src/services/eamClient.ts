// all imports will go here
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios"
import { env } from "../config/env"
import {
    IntegrationError,
    IntegrationErrorDetails,
    mapStatusToIntegrationCode
} from "../errors/integrationError"
import { randomUUID } from "node:crypto"
import { EquipmentOption, OrganizationOption } from "../types/canonical"
import { EamOrganizationRaw, EamPositionRaw, toOrganizationOption, toPositionEquipmentOption } from "./eamMappers"

// all constants used
// Per-call timeout. EAM /positions typically responds in 1.8-3.5s but
// occasionally spikes to 15s+ under load. 30s gives enough headroom that
// transient slowness doesn't kill cursor-paginated loops; truly broken
// upstream still surfaces as UPSTREAM_TIMEOUT in a reasonable timeframe.
const EAM_DEFAULT_TIMEOUT_MS = 30_000
const CORRELATION_HEADER = "x-correlation-id"
const PROVIDER = "eam" as const

// Internal envelope shape - nothing outside this file should know it exists
type EamCollectionResponse<T> = {
    Result: {
        SessionID: string | null
        ResultData: {
            DATAENTITYNAME: string
            CURRENTCURSORPOSITION: number
            NEXTCURSORPOSITION: number
            RECORDS: number
            DATARECORD: T[]
        }
    }
}

// What the rest of the app consumes. Clean domain language.
export type EamCollection<T> = {
    records: T[]
    total: number
    cursor: {
        current: number
        next: number
    }
    entityName: string
}

// Helper A - to pull message out of whatever EAM returned
function extractUpstreamMessage(data: unknown): string | undefined {
    if (!data || typeof data !== "object") return undefined
    const record = data as Record<string, unknown>
    if (typeof record.message === "string") return record.message
    if (typeof record.error === "string") return record.error
    return undefined
}

// Helper B - to get/create the correlation ID on every request
function getCorrelationId(config: AxiosRequestConfig | undefined): string {
    const headerValue = config?.headers?.[CORRELATION_HEADER]
    if (typeof headerValue === "string" && headerValue.length > 0) return headerValue
    return randomUUID()
}

// The error normalizer - the bridge between the Axios error world and our world
function normalizeAxiosError(error: AxiosError): IntegrationError {
    const correlationId = getCorrelationId(error.config)

    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        return new IntegrationError({
            code: "UPSTREAM_TIMEOUT",
            message: "EAM request timed out",
            correlationId,
            details: { provider: PROVIDER }
        })
    }

    const status = error.response?.status
    const upstreamMessage = extractUpstreamMessage(error.response?.data)
    const details: IntegrationErrorDetails = { provider: PROVIDER }
    if (status !== undefined) details.status = status
    if (upstreamMessage) details.upstreamMessage = upstreamMessage

    return new IntegrationError({
        code: mapStatusToIntegrationCode(status),
        message: status ? `EAM request failed with status ${status}` : `EAM request failed`,
        correlationId,
        details
    })
}

// build and export the client
function buildClient(): AxiosInstance {
    const instance = axios.create({
        baseURL: env.EAM_BASE_URL,
        timeout: EAM_DEFAULT_TIMEOUT_MS,
        auth: {
            username: env.EAM_USERNAME,
            password: env.EAM_PASSWORD
        },
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            tenant: env.EAM_TENANT,
            role: env.EAM_ROLE,
            organization: env.EAM_ORGANIZATION
        }
    })

    // request axios interceptor
    instance.interceptors.request.use((config) => {
        const existing = config.headers?.[CORRELATION_HEADER]
        if (!existing) {
            config.headers.set(CORRELATION_HEADER, randomUUID())
        }

        // logger for every upcoming request
        const cid = config.headers.get(CORRELATION_HEADER);
        console.log(`[${PROVIDER}] ${config.method?.toUpperCase()} ${config.url} cid=${cid}`);

        (config as any).metadata = {
            startedAt: Date.now(),
        }

        return config
    })

    // response axios interceptor
    instance.interceptors.response.use(
        (response) => {
            const startedAt = (response.config as any).metadata?.startedAt as number | undefined
            if (startedAt) {
                const ms = Date.now() - startedAt
                const cid = response.config.headers.get(CORRELATION_HEADER)
                console.log(`[${PROVIDER}] ${response.config.method?.toUpperCase()} ${response.config.url} ${response.status} (${ms}ms) cid=${cid}`)
            }
            return response
        },
        (error: AxiosError) => Promise.reject(normalizeAxiosError(error))
    )

    return instance
}

export const eamClient: AxiosInstance = buildClient()

console.log(
    `[eam] adapter ready — base=${env.EAM_BASE_URL}  tenant=${env.EAM_TENANT}  org=${env.EAM_ORGANIZATION}  user=${env.EAM_USERNAME.slice(0, 2)}${"*".repeat(Math.max(0, env.EAM_USERNAME.length - 2))}`
)


// getEam helper - GET wrapper that returns response.data so routes don't unwrap manually.
// Optional `headers` overrides instance-level defaults for this call only - useful when
// scoping a request to a specific EAM org/tenant without mutating shared client state.
export async function getEam<T = unknown>(
    path: string,
    params?: Record<string, unknown>,
    headers?: Record<string, string>,
): Promise<T> {
    const res = await eamClient.get<T>(path, { params, headers })
    return res.data
}

// postEam helper - POST wrapper with separate body (B) and response generics (T)
export async function postEam<T = unknown, B = unknown>(
    path: string,
    body: B
): Promise<T> {
    const res = await eamClient.post<T>(path, body)
    return res.data
}

// getEamCollection - GET wrapper that unwraps EAM's Result.ResultData envelope.
// Returns clean { records, total, cursor, entityName } regardless of upstream quirks.
// Optional `headers` is forwarded to getEam for per-call scope overrides.
export async function getEamCollection<T = unknown>(
    path: string,
    params?: Record<string, unknown>,
    headers?: Record<string, string>,
): Promise<EamCollection<T>> {
    const raw = await getEam<EamCollectionResponse<T>>(path, params, headers)

    // Defensive: throw a contract error if EAM returns a malformed envelope.
    if (!raw?.Result?.ResultData?.DATARECORD) {
        throw new IntegrationError({
            code: "CONTRACT_MAPPING_ERROR",
            message: "EAM response missing Result.ResultData.DATARECORD",
            correlationId: randomUUID(),
            details: { provider: PROVIDER }
        })
    }

    const rd = raw.Result.ResultData
    return {
        records: rd.DATARECORD,
        total: rd.RECORDS,
        cursor: {
            current: rd.CURRENTCURSORPOSITION,
            next: rd.NEXTCURSORPOSITION
        },
        entityName: rd.DATAENTITYNAME
    }
}

// getEamOrganizations - fetches the EAM organization list and returns canonical DTOs.
//
// LIMITATION: HxGN EAM REST GET /organization caps responses at 50 records per call
// and does NOT honor cursor / limit / pageSize / offset / start params via GET (verified
// against the dev tenant). EAM's pagination model for this endpoint likely requires a
// POST search envelope which we have not yet integrated.
//
// The response includes `total` so callers know whether records are truncated. If
// total > records.length, downstream consumers (e.g. the AI matcher) should treat the
// match space as "first 50 only" until a paged version of this helper lands.
export async function getEamOrganizations(): Promise<{
    records: OrganizationOption[]
    total: number
    truncated: boolean
}> {
    const page = await getEamCollection<EamOrganizationRaw>("/organization")
    const records = page.records.map(toOrganizationOption)
    const truncated = page.total > records.length

    if (truncated) {
        console.warn(
            `[eam] /organization returned ${records.length} of ${page.total} - tail (${page.total - records.length} records) not visible to consumers; pagination follow-up required`
        )
    }

    return {
        records,
        total: page.total,
        truncated,
    }
}

// Two-tier safety cap on EAM round-trips per backend page:
//   SOFT cap = stop here if we already have at least one match (snappy UX
//              when matches are common; predictable ~25-35s page latency).
//   HARD cap = absolute upper bound; stop here even if we have zero matches
//              (avoids unbounded loops in pathological data shapes).
//
// For sparse orgs like VTAT (~0.2% match density) the loop will routinely
// blow past the soft cap, scanning up to HARD cap * 50 records = 1500 records
// in ~75-100s before giving up. Better UX than returning empty pages and
// letting the frontend scroll-storm into them.
const EAM_EQUIPMENT_SOFT_CAP_CALLS = 10
const EAM_EQUIPMENT_HARD_CAP_CALLS = 30
const EAM_EQUIPMENT_DEFAULT_PAGE_SIZE = 50

// Domain helper: paginated equipment list scoped to a specific EAM org code.
//
// Why /positions and not /assets:
//   The work-request equipment lookup queries Position-type records (obj_obrtype='P'
//   in the dataspy SQL). EAM REST exposes these via GET /positions; /assets
//   returns a different layer (Asset records, obrtype='A'). We previously hit
//   /assets and got the wrong population.
//
// Why server-side filter via cursor pagination loop:
//   /positions does NOT honor any filter parameter (header or query). It returns
//   global Positions across all orgs the integration user can access. To match
//   the manager's "scoped to org" spec, we filter client-side on
//   POSITIONID.ORGANIZATIONID.ORGANIZATIONCODE after each EAM page. We loop the
//   cursor (via the cursorposition HEADER, the only working pagination
//   mechanism we found) until we've accumulated `pageSize` matches OR hit the
//   safety cap. The frontend pages by passing back the cursor we stopped at.
//
// Why bounded loop (safety cap) vs unbounded "until 50 matches":
//   For sparse orgs, a true 50-match page would take 2-4 minutes. The cap
//   trades fewer-per-page for predictable ~30-50s latency. Frontend can
//   render "loaded N, scroll for more" honestly.
//
// Production note: when the EAM integration user is restricted to a single
// org's access, /positions returns only that org's records and this helper's
// client-side filter becomes redundant (always 1:1 matches). The loop and
// cap are still useful as a safety net.
export async function getEamEquipmentForOrg(
    orgCode: string,
    opts?: { cursor?: number; pageSize?: number; activeOnly?: boolean }
): Promise<{
    records: EquipmentOption[]
    nextCursor: number | null   // EAM cursor to resume from; null when EAM exhausted
    scanned: number              // EAM records walked through this call
    matched: number              // records returned (may be < pageSize if cap hit)
    hasMore: boolean             // more EAM records exist; frontend should fetch again
    exhausted: boolean           // EAM ran out of records globally
    activeOnly: boolean
}> {
    const cursor = opts?.cursor ?? 0
    const pageSize = opts?.pageSize ?? EAM_EQUIPMENT_DEFAULT_PAGE_SIZE
    const activeOnly = opts?.activeOnly ?? true

    const matches: EquipmentOption[] = []
    let currentCursor = cursor
    let calls = 0
    let scanned = 0
    let exhausted = false

    // Loop conditions:
    //   - haven't filled the page (always continue if room)
    //   - haven't hit the HARD cap (absolute upper bound)
    //   - if we've passed SOFT cap with at least one match, stop (snappy return)
    while (
        matches.length < pageSize &&
        calls < EAM_EQUIPMENT_HARD_CAP_CALLS &&
        !(calls >= EAM_EQUIPMENT_SOFT_CAP_CALLS && matches.length >= 1)
    ) {
        // cursorposition header is the documented HxGN EAM pagination mechanism
        // for this endpoint. cursor=0 on the first call returns records 1-50;
        // cursor=51 returns 51-100; etc. The response NEXTCURSORPOSITION tells
        // us where to resume.
        const headers: Record<string, string> = { organization: orgCode }
        if (currentCursor > 0) {
            headers.cursorposition = String(currentCursor)
        }

        const collection = await getEamCollection<EamPositionRaw>(
            "/positions",
            undefined,
            headers
        )
        calls++
        scanned += collection.records.length

        if (collection.records.length === 0) {
            exhausted = true
            break
        }

        const orgMatching = collection.records.filter(
            (r) => r.POSITIONID?.ORGANIZATIONID?.ORGANIZATIONCODE === orgCode
        )

        for (const raw of orgMatching) {
            const mapped = toPositionEquipmentOption(raw)
            if (activeOnly && !mapped.isActive) continue
            matches.push(mapped)
            if (matches.length >= pageSize) break
        }

        // Advance cursor for the next iteration. NEXTCURSORPOSITION not advancing
        // means EAM has nothing further to give.
        if (collection.cursor.next <= collection.cursor.current) {
            exhausted = true
            break
        }
        currentCursor = collection.cursor.next
    }

    const nextCursor = exhausted ? null : currentCursor
    const hasMore = !exhausted

    console.log(
        `[eam] equipment-for=${orgCode} cursor=${cursor}->${nextCursor ?? "EOF"} calls=${calls} scanned=${scanned} matched=${matches.length}`
    )

    return {
        records: matches,
        nextCursor,
        scanned,
        matched: matches.length,
        hasMore,
        exhausted,
        activeOnly,
    }
}