// Step 1 - Define which error code exist
export type IntegrationErrorCode = 
    | "UPSTREAM_AUTH_FAILED"    // 401 from upstream
    | "UPSTREAM_FORBIDDEN"      // 403
    | "RESOURCE_NOT_FOUND"      // 404
    | "UPSTREAM_TIMEOUT"        // network timeout
    | "UPSTREAM_SERVICE_ERROR"  // 5xx or unknown
    | "CONTRACT_MAPPING_ERROR"  // we got a response but it didn't match what we expected


// Step 2 - Define which provider exist
export type IntegrationProvider = "workday" | "eam"

// Step 3 - Define the "details" shape
export interface IntegrationErrorDetails {
    provider: IntegrationProvider       // required
    status?: number                     // optional - HTTP status if we got one
    upstreamMessage?: string            // optional - what the vendor said
    [key: string]: unknown              // allow extra fields later without editing this type
}

// Step 4 - Make the error class itself
export class IntegrationError extends Error {
    readonly code: IntegrationErrorCode
    readonly correlationId: string
    readonly details: IntegrationErrorDetails

    constructor(args: {
        code: IntegrationErrorCode
        message: string
        correlationId: string
        details: IntegrationErrorDetails
    }) {
        super(args.message)
        this.name = "IntegrationError"
        this.code = args.code
        this.correlationId = args.correlationId
        this.details = args.details
    }

    toJSON() {
        return {
            code: this.code,
            message: this.message,
            correlationId: this.correlationId,
            details: this.details
        }
    }
}

// Step 5: Helper: turn an HTTP status into a code
export function mapStatusToIntegrationCode(
    status: number | undefined
): IntegrationErrorCode {
    if (status === 401) return "UPSTREAM_AUTH_FAILED"
    if (status === 403) return "UPSTREAM_FORBIDDEN"
    if (status === 404) return "RESOURCE_NOT_FOUND"
    if (status !== undefined && status >= 500) return "UPSTREAM_SERVICE_ERROR"

    return "UPSTREAM_SERVICE_ERROR"     // fallback for anything weird
}

// Step 6: Helper: What HTTP status should WE send back?
export function integrationErrorHttpStatus(err: IntegrationError): number {
    if (err.code === "UPSTREAM_TIMEOUT") return 504         // Gateway timeout
    if (err.code === "RESOURCE_NOT_FOUND") return 404       // pass-through is fine here
    if (err.code === "CONTRACT_MAPPING_ERROR") return 500   // our bug, not upstream's

    return 502
}