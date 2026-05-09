// Tiny fetch wrapper. Three concerns:
//   1) JSON serialisation in / out
//   2) Bearer-token injection from the caller's session
//   3) Error normalisation (HTTP non-2xx -> typed ApiError)
//
// All requests use relative paths like "/auth/login" or "/integrations/agent/run".
// In dev, Vite's proxy (see vite.config.ts) forwards these to the backend at
// localhost:5000. In production the frontend would be served same-origin behind
// a reverse proxy, so the same relative paths work without configuration.
//
// Why no axios on the frontend (matching backend):
//   - 0KB native fetch vs ~13KB axios bundle
//   - One less version-pinned dep to maintain
//   - The backend uses axios for its interceptor model; frontend doesn't need that

export class ApiError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string,
    ) {
        super(message)
        this.name = "ApiError"
    }
}

type ApiOptions = {
    method?: "GET" | "POST"
    body?: unknown
    sessionId?: string | null
}

export async function apiCall<T>(path: string, opts: ApiOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    }
    if (opts.sessionId) {
        headers.Authorization = `Bearer ${opts.sessionId}`
    }

    const res = await fetch(path, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })

    // Some responses (e.g., logout) may not return JSON. Attempt parse and
    // tolerate failure - we still want to bubble HTTP-level status.
    let data: unknown = null
    const text = await res.text()
    if (text.length > 0) {
        try {
            data = JSON.parse(text)
        } catch {
            // Non-JSON response body - treat as opaque
        }
    }

    if (!res.ok) {
        const obj = (data ?? {}) as { code?: unknown; message?: unknown }
        const code = typeof obj.code === "string" ? obj.code : "UNKNOWN_ERROR"
        const message = typeof obj.message === "string" ? obj.message : res.statusText
        throw new ApiError(res.status, code, message)
    }

    return data as T
}
