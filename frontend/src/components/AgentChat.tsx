import { FormEvent, useState } from "react"
import { useSession } from "../auth/useSession"
import { runAgent } from "../api/agent"
import { ApiError } from "../api/client"
import {
    AgentRunInput,
    AgentRunResolved,
    AgentRunResult,
    EquipmentOption,
    OrganizationOption,
    ProblemCodeOption,
    WorkRequestResult,
    WorkRequestTypeOption,
} from "../types/canonical"

// Match the backend's description cap (POST /agent/run validates this too).
const MAX_DESCRIPTION_LEN = 200

// One turn = one chat bubble. Append-only across the run.
type Turn =
    | { speaker: "user"; text: string }
    | { speaker: "bot"; result: AgentRunResult }

// Which canonical input field a HIL pick fills in.
type PickField = "organizationCode" | "equipmentCode" | "problemCode" | "typeCode"

// Find the most recent bot turn's result so the input area knows what to render.
// Manual reverse loop instead of `findLast` (ES2023) to stay within the project's
// ES2020 lib target.
function findLastBotResult(transcript: Turn[]): AgentRunResult | null {
    for (let i = transcript.length - 1; i >= 0; i--) {
        const t = transcript[i]
        if (t.speaker === "bot") return t.result
    }
    return null
}

// Build the next AgentRunInput on a HIL pick. Carries every previously resolved
// code forward and overrides exactly one field with the user's pick. The
// orchestrator's "stages process in order" invariant means we only ever fill
// one missing field per round-trip.
function buildReentryInput(
    email: string,
    description: string,
    previous: AgentRunResult,
    pickedField: PickField,
    pickedCode: string,
): AgentRunInput {
    const r = previous.resolved
    return {
        email,
        description,
        organizationCode: r.organization?.code,
        equipmentCode: r.equipment?.equipmentCode,
        problemCode: r.problemCode?.code,
        typeCode: r.type?.code,
        [pickedField]: pickedCode,
    }
}

export function AgentChat() {
    const { session } = useSession()
    // The user already proved their identity at login - email lives on the
    // session, not as a form field. Asking again here would be friction
    // without value. The agent endpoint's `email` field is sourced from
    // session.email at every call.
    const [description, setDescription] = useState("")
    const [transcript, setTranscript] = useState<Turn[]>([])
    const [pending, setPending] = useState(false)
    const [apiError, setApiError] = useState<ApiError | null>(null)

    if (!session) return null

    const lastBotResult = findLastBotResult(transcript)
    const isTerminal =
        lastBotResult?.kind === "success" || lastBotResult?.kind === "fail"
    const showInitialForm = transcript.length === 0

    async function handleStart(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!session) return
        setPending(true)
        setApiError(null)
        // The user-turn shows what they typed; identity is already implied by
        // the chat being authenticated. No need to echo their email.
        setTranscript((prev) => [...prev, { speaker: "user", text: description }])
        try {
            const result = await runAgent(
                { email: session.email, description },
                session.sessionId,
            )
            setTranscript((prev) => [...prev, { speaker: "bot", result }])
        } catch (err) {
            setApiError(toApiError(err))
        } finally {
            setPending(false)
        }
    }

    async function handlePick(
        field: PickField,
        code: string,
        label: string,
    ): Promise<void> {
        if (!session || !lastBotResult || pending) return
        setPending(true)
        setApiError(null)
        setTranscript((prev) => [
            ...prev,
            { speaker: "user", text: `Selected: ${label}` },
        ])
        try {
            const input = buildReentryInput(
                session.email,
                description,
                lastBotResult,
                field,
                code,
            )
            const result = await runAgent(input, session.sessionId)
            setTranscript((prev) => [...prev, { speaker: "bot", result }])
        } catch (err) {
            setApiError(toApiError(err))
        } finally {
            setPending(false)
        }
    }

    function handleReset() {
        setDescription("")
        setTranscript([])
        setApiError(null)
    }

    return (
        <div className="flex flex-col gap-4">
            <BotGreeting displayName={session.displayName} />

            {transcript.map((turn, i) =>
                turn.speaker === "user" ? (
                    <UserBubble key={i} text={turn.text} />
                ) : (
                    <BotBubble
                        key={i}
                        result={turn.result}
                        isLatest={i === transcript.length - 1}
                        disabled={pending}
                        onPick={handlePick}
                    />
                ),
            )}

            {pending && <PendingBubble />}

            {apiError && <ApiErrorBubble error={apiError} />}

            {showInitialForm && (
                <InitialForm
                    description={description}
                    setDescription={setDescription}
                    onSubmit={handleStart}
                    pending={pending}
                />
            )}

            {isTerminal && (
                <ResetBar
                    isSuccess={lastBotResult?.kind === "success"}
                    onReset={handleReset}
                />
            )}
        </div>
    )
}

// ----- Subcomponents (kept in-file for Mini 7.2; 7.3+ may extract picks) -----

function BotGreeting({ displayName }: { displayName: string }) {
    return (
        <BotShell>
            <p className="text-sm text-slate-700">
                Hi <strong className="text-slate-900">{displayName}</strong>. Tell me
                what's wrong and I'll file a work request in EAM for you.
            </p>
        </BotShell>
    )
}

function UserBubble({ text }: { text: string }) {
    return (
        <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-3 text-sm text-white whitespace-pre-wrap">
                {text}
            </div>
        </div>
    )
}

function BotShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm">
                🤖
            </div>
            <div className="flex-1 rounded-2xl rounded-tl-sm border border-slate-200 bg-white p-4 shadow-sm">
                {children}
            </div>
        </div>
    )
}

function PendingBubble() {
    return (
        <BotShell>
            <p className="text-sm text-slate-500 italic">Thinking…</p>
        </BotShell>
    )
}

function ApiErrorBubble({ error }: { error: ApiError }) {
    return (
        <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm">
                ⚠️
            </div>
            <div
                role="alert"
                className="flex-1 rounded-2xl rounded-tl-sm border border-red-200 bg-red-50 p-4"
            >
                <p className="text-sm font-semibold text-red-900">
                    Service error ({error.status} {error.code})
                </p>
                <p className="mt-1 text-sm text-red-700">{error.message}</p>
            </div>
        </div>
    )
}

function BotBubble(props: {
    result: AgentRunResult
    isLatest: boolean
    disabled: boolean
    onPick: (field: PickField, code: string, label: string) => Promise<void>
}) {
    const { result, isLatest, disabled, onPick } = props
    // Picks only react in the latest bot turn AND only when nothing else is pending.
    // Older turns render the same candidate list but as inert text.
    const interactive = isLatest && !disabled

    return (
        <BotShell>
            <ResolvedSummary resolved={result.resolved} kind={result.kind} />

            {result.kind === "success" && <SuccessContent wr={result.workRequest} />}

            {result.kind === "fail" && (
                <FailContent
                    reason={result.reason}
                    message={result.message}
                />
            )}

            {result.kind === "pick_org" && (
                <PickList
                    prompt="Pick the EAM organization for this work request:"
                    items={result.candidates.map((c) => ({
                        code: c.code,
                        primary: c.code,
                        secondary: c.description,
                        label: `${c.code} — ${c.description}`,
                    }))}
                    interactive={interactive}
                    onClick={(code, label) =>
                        void onPick("organizationCode", code, label)
                    }
                />
            )}

            {result.kind === "pick_equipment" && (
                <PickList
                    prompt="Pick the equipment:"
                    items={result.candidates.map((c) => ({
                        code: c.equipmentCode,
                        primary: c.equipmentCode,
                        secondary: c.description,
                        label: `${c.equipmentCode} — ${c.description}`,
                    }))}
                    interactive={interactive}
                    onClick={(code, label) =>
                        void onPick("equipmentCode", code, label)
                    }
                    footerNote={
                        result.nextCursor !== null
                            ? `Showing the first page. (More pages handled in Mini 7.4.)`
                            : undefined
                    }
                />
            )}

            {result.kind === "pick_problem_code" && (
                <PickList
                    prompt="What's the problem?"
                    items={result.candidates.map((c) => ({
                        code: c.code,
                        primary: c.code,
                        secondary: c.description,
                        label: `${c.code} — ${c.description}`,
                    }))}
                    interactive={interactive}
                    onClick={(code, label) =>
                        void onPick("problemCode", code, label)
                    }
                />
            )}

            {result.kind === "pick_type" && (
                <PickList
                    prompt="Work request type:"
                    items={result.candidates.map((c) => ({
                        code: c.code,
                        primary: c.code,
                        secondary: c.description,
                        label: `${c.code} — ${c.description}`,
                    }))}
                    interactive={interactive}
                    onClick={(code, label) =>
                        void onPick("typeCode", code, label)
                    }
                />
            )}

            {(result.kind === "success" || result.kind === "fail") && (
                <p className="mt-3 text-xs font-mono text-slate-400 break-all">
                    Reference: {result.correlationId}
                </p>
            )}
        </BotShell>
    )
}

function ResolvedSummary({
    resolved,
    kind,
}: {
    resolved: AgentRunResolved
    kind: AgentRunResult["kind"]
}) {
    // Don't show the summary on success - the success content already echoes
    // the work request (and adding the summary above would duplicate). On
    // every other variant, surface what's been resolved so the user sees
    // continuity: "Yes, the agent remembered who I am and which org."
    if (kind === "success") return null
    const items: { label: string; value: string }[] = []
    if (resolved.user) {
        items.push({
            label: "User",
            value: `${resolved.user.displayName} (${resolved.user.location})`,
        })
    }
    if (resolved.organization) {
        items.push({
            label: "Org",
            value: `${resolved.organization.code} — ${resolved.organization.description}`,
        })
    }
    if (resolved.equipment) {
        items.push({
            label: "Equipment",
            value: `${resolved.equipment.equipmentCode} — ${resolved.equipment.description}`,
        })
    }
    if (resolved.problemCode) {
        items.push({
            label: "Problem",
            value: `${resolved.problemCode.code} — ${resolved.problemCode.description}`,
        })
    }
    if (resolved.type) {
        items.push({
            label: "Type",
            value: `${resolved.type.code} — ${resolved.type.description}`,
        })
    }
    if (items.length === 0) return null
    return (
        <ul className="mb-3 space-y-1 text-xs text-slate-600">
            {items.map((item) => (
                <li key={item.label}>
                    <span className="text-emerald-600">✓</span>{" "}
                    <span className="font-medium text-slate-700">{item.label}:</span>{" "}
                    {item.value}
                </li>
            ))}
        </ul>
    )
}

function SuccessContent({ wr }: { wr: WorkRequestResult }) {
    return (
        <div>
            <p className="text-sm text-slate-700">Work request filed in EAM ✅</p>
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs uppercase tracking-wide text-emerald-700">
                    Job number
                </p>
                <p className="mt-1 font-mono text-2xl font-bold text-emerald-900">
                    {wr.jobNumber}
                </p>
                {wr.upstreamMessage && (
                    <p className="mt-2 text-xs text-emerald-700">
                        {wr.upstreamMessage}
                    </p>
                )}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                <dt className="font-medium text-slate-700">Org</dt>
                <dd>{wr.organizationCode}</dd>
                <dt className="font-medium text-slate-700">Equipment</dt>
                <dd className="font-mono">{wr.equipmentCode}</dd>
                <dt className="font-medium text-slate-700">Problem</dt>
                <dd>{wr.problemCode}</dd>
                <dt className="font-medium text-slate-700">Type</dt>
                <dd>{wr.typeCode}</dd>
                <dt className="font-medium text-slate-700">Status</dt>
                <dd>
                    {wr.status.code} ({wr.status.description})
                </dd>
                <dt className="font-medium text-slate-700">Filed by</dt>
                <dd className="font-mono">{wr.requestedBy}</dd>
            </dl>
        </div>
    )
}

function FailContent({
    reason,
    message,
}: {
    reason: string
    message?: string
}) {
    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
                Couldn't file the request
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-amber-700">
                {reason}
            </p>
            {message && <p className="mt-2 text-sm text-amber-800">{message}</p>}
        </div>
    )
}

type PickItem = {
    code: string
    primary: string         // e.g., "VTAT" or "AC.001.01.01"
    secondary: string       // e.g., "Vopak Brasil S.A. - Terminal Aratu"
    label: string           // human-readable used in the user-turn echo
}

function PickList({
    prompt,
    items,
    interactive,
    onClick,
    footerNote,
}: {
    prompt: string
    items: PickItem[]
    interactive: boolean
    onClick: (code: string, label: string) => void
    footerNote?: string
}) {
    return (
        <div>
            <p className="text-sm text-slate-700">{prompt}</p>
            <ul className="mt-3 space-y-1">
                {items.map((item) => (
                    <li key={item.code}>
                        <button
                            type="button"
                            onClick={() => onClick(item.code, item.label)}
                            disabled={!interactive}
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white"
                        >
                            <span className="font-mono font-medium text-slate-900">
                                {item.primary}
                            </span>
                            <span className="ml-2 text-slate-600">{item.secondary}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {footerNote && (
                <p className="mt-2 text-xs italic text-slate-500">{footerNote}</p>
            )}
        </div>
    )
}

function InitialForm({
    description,
    setDescription,
    onSubmit,
    pending,
}: {
    description: string
    setDescription: (v: string) => void
    onSubmit: (e: FormEvent<HTMLFormElement>) => void
    pending: boolean
}) {
    const canSubmit = !pending && description.length > 0
    return (
        <form
            onSubmit={onSubmit}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
            <label className="block">
                <span className="flex items-baseline justify-between">
                    <span className="text-sm font-medium text-slate-700">
                        What's wrong?
                    </span>
                    <span className="text-xs text-slate-400">
                        {description.length}/{MAX_DESCRIPTION_LEN}
                    </span>
                </span>
                <textarea
                    value={description}
                    onChange={(e) =>
                        setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LEN))
                    }
                    disabled={pending}
                    autoFocus
                    required
                    rows={3}
                    placeholder="Describe the issue (e.g. equipment leaking, motor not starting, valve stuck)"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:bg-slate-50 disabled:text-slate-500"
                />
            </label>
            <button
                type="submit"
                disabled={!canSubmit}
                className="mt-4 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {pending ? "Working…" : "Start"}
            </button>
        </form>
    )
}

function ResetBar({
    isSuccess,
    onReset,
}: {
    isSuccess: boolean
    onReset: () => void
}) {
    return (
        <div className="flex justify-center">
            <button
                type="button"
                onClick={onReset}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
            >
                {isSuccess ? "File another request" : "Start over"}
            </button>
        </div>
    )
}

function toApiError(err: unknown): ApiError {
    if (err instanceof ApiError) return err
    const message = err instanceof Error ? err.message : "Unexpected error"
    return new ApiError(0, "NETWORK_ERROR", message)
}
