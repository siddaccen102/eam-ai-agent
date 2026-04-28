// all imports will go here
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios"
import { env } from "../config/env"
import {
    IntegrationError,
    IntegrationErrorDetails,
    mapStatusToIntegrationCode
} from "../errors/integrationError"
import { randomUUID } from "node:crypto"

// all constants used
const EAM_DEFAULT_TIMEOUT_MS = 15_000
const CORRELATION_HEADER = "x-correlation-id"
const PROVIDER = "eam" as const

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
        message: status ? `EAM request failed with status ${status}` : `EAM request failed.`,
        correlationId,
        details
    })
}

// build and export the client
function buildClient(): AxiosInstance {
    const instance = axios.create({
        baseURL: env.EAM_BASE_URL,
        timeout: EAM_DEFAULT_TIMEOUT_MS,
        headers: {
            Authorization: `Bearer ${env.EAM_API_TOKEN}`,
            Accept: "application/json",
            "Content-Type": "application/json"
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

// getEam helper - GET wrapper that returns response.data so routes don't unwrap manually
export async function getEam<T = unknown>(
    path: string, 
    params?: Record<string, unknown>
): Promise<T> {
    const res = await eamClient.get<T>(path, { params })
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