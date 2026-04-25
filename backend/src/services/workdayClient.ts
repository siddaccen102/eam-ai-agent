// all imports will go here
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios"
import { randomUUID } from "node:crypto"
import { env } from "../config/env"
import {
    IntegrationError,
    IntegrationErrorDetails,
    mapStatusToIntegrationCode
} from "../errors/integrationError"

// all constants used
const WORKDAY_DEFAULT_TIMEOUT_MS = 10_000
const CORRELATION_HEADER = "x-correlation-id"
const PROVIDER = "workday" as const

// Helper A - to pull message out of whatever Workday returned
function extractUpstreamMessage(data: unknown): string | undefined {
    if (!data || typeof data !== "object") return undefined
    const record = data as Record<string, unknown>
    if (typeof record.message === "string") return record.message
    if (typeof record.error === "string") return record.error
    return undefined
}

// Helper B - to get/create the correlation ID
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
            message: "Workday request timed out.",
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
        message: status ? `Workday request failed with status ${status}` : `Workday request failed.`,
        correlationId,
        details
    })
}

// build and export the client
function buildClient(): AxiosInstance {
    const instance = axios.create({
        baseURL: env.WORKDAY_BASE_URL,
        timeout: WORKDAY_DEFAULT_TIMEOUT_MS,
        headers: {
            Authorization: `Bearer ${env.WORKDAY_API_TOKEN}`,
            Accept: "application/json"
        }
    })

    // request axios interceptor
    instance.interceptors.request.use((config) => {
        const existing = config.headers?.[CORRELATION_HEADER]
        if (!existing) {
            config.headers.set(CORRELATION_HEADER, randomUUID())
        }

        // logger for every upcoming request
        const cid = config.headers.get(CORRELATION_HEADER)
        console.log(`[${PROVIDER}] ${config.method?.toUpperCase()} ${config.url} cid=${cid}`)

        return config
    })

    // response axios interceptor
    instance.interceptors.response.use(
        (response) => response,
        (error: AxiosError) => Promise.reject(normalizeAxiosError(error))
    )

    return instance
}

export const workdayClient: AxiosInstance = buildClient()