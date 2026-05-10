import { FormEvent, useState } from "react"
import { useSession } from "../auth/useSession"
import { runAgent } from "../api/agent"
import { fetchEquipmentPage } from "../api/equipment"
import { ApiError } from "../api/client"
import { Session } from "../api/auth"
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
    const resolved = lastBotResult?.resolved ?? {}
    const correlationId = lastBotResult?.correlationId

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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
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

            <aside className="lg:sticky lg:top-6 lg:self-start">
                <ResolvedPanel
                    session={session}
                    resolved={resolved}
                    correlationId={correlationId}
                />
            </aside>
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
            {result.kind === "success" && <SuccessContent wr={result.workRequest} />}

            {result.kind === "fail" && (
                <FailContent
                    reason={result.reason}
                    message={result.message}
                />
            )}

            {result.kind === "pick_org" && (
                <PickOrg
                    candidates={result.candidates}
                    topConfidence={result.topConfidence}
                    interactive={interactive}
                    onPick={onPick}
                />
            )}

            {result.kind === "pick_equipment" && (
                <PickEquipment
                    candidates={result.candidates}
                    nextCursor={result.nextCursor}
                    orgCode={result.resolved.organization?.code ?? ""}
                    interactive={interactive}
                    onPick={onPick}
                />
            )}

            {result.kind === "pick_problem_code" && (
                <PickProblemCode
                    candidates={result.candidates}
                    interactive={interactive}
                    onPick={onPick}
                />
            )}

            {result.kind === "pick_type" && (
                <PickType
                    candidates={result.candidates}
                    interactive={interactive}
                    onPick={onPick}
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

// ResolvedPanel - the agent's "working memory" rendered alongside the chat.
// Reads `resolved` from the latest bot turn (so it tracks the freshest state),
// pre-populates User from session (the user is logged-in before any agent run),
// and shows progressive fill-in for the other four fields.
//
// Why "Not yet" placeholders instead of hiding unresolved rows:
//   A fixed five-row layout that progressively fills in is a stronger demo
//   signal than rows that pop in. Users see the full shape of what the agent
//   needs to figure out, then watch the bullets resolve. Visual stability
//   beats clever animation.
//
// Why correlationId here AND in success/fail bubbles:
//   The bubble's cid is per-turn. The panel's cid is "the current run's" -
//   visible at all times so the user can quote it without scrolling back.
//   On terminal turns the same value appears in both places, briefly.
function ResolvedPanel({
    session,
    resolved,
    correlationId,
}: {
    session: Session
    resolved: AgentRunResolved
    correlationId?: string
}) {
    return (
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Run state
            </h2>
            <dl className="mt-4 space-y-3">
                <PanelRow
                    label="User"
                    resolved
                    primary={session.displayName}
                    secondary={session.email}
                />
                <PanelRow
                    label="Organization"
                    resolved={!!resolved.organization}
                    primary={resolved.organization?.code}
                    secondary={resolved.organization?.description}
                />
                <PanelRow
                    label="Equipment"
                    resolved={!!resolved.equipment}
                    primary={resolved.equipment?.equipmentCode}
                    secondary={resolved.equipment?.description}
                />
                <PanelRow
                    label="Problem code"
                    resolved={!!resolved.problemCode}
                    primary={resolved.problemCode?.code}
                    secondary={resolved.problemCode?.description}
                />
                <PanelRow
                    label="Type"
                    resolved={!!resolved.type}
                    primary={resolved.type?.code}
                    secondary={resolved.type?.description}
                />
            </dl>
            {correlationId && (
                <p className="mt-4 border-t border-slate-100 pt-3 font-mono text-xs text-slate-400 break-all">
                    cid {correlationId}
                </p>
            )}
        </aside>
    )
}

function PanelRow({
    label,
    resolved,
    primary,
    secondary,
}: {
    label: string
    resolved: boolean
    primary?: string
    secondary?: string
}) {
    return (
        <div>
            <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <span
                    aria-hidden
                    className={
                        resolved
                            ? "text-emerald-600"
                            : "text-slate-300"
                    }
                >
                    {resolved ? "✓" : "·"}
                </span>
                {label}
            </dt>
            <dd className="mt-0.5 ml-4">
                {resolved && primary ? (
                    <>
                        <p className="text-sm font-medium text-slate-900">
                            {primary}
                        </p>
                        {secondary && (
                            <p className="text-xs text-slate-500">{secondary}</p>
                        )}
                    </>
                ) : (
                    <p className="text-xs italic text-slate-400">Not yet</p>
                )}
            </dd>
        </div>
    )
}

// SuccessContent - the closing beat of a successful agent run. JOBNUM is the
// only piece of info that doesn't appear on the side panel (it's freshly
// assigned by EAM at create time), so the bubble focuses on it: big mono
// type, copy-to-clipboard, EAM's confirmation message. The other resolved
// fields (org, equipment, problem code, type) are visible in the side panel
// at the same time - duplicating them inside the bubble was redundant.
function SuccessContent({ wr }: { wr: WorkRequestResult }) {
    const [copied, setCopied] = useState(false)

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(wr.jobNumber)
            setCopied(true)
            // Revert the label after a short window. If the user clicks again
            // before this fires, the state is already true; the next timeout
            // just resets it again - benign.
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // Clipboard API can fail on insecure contexts (non-https / non-
            // localhost) or restricted browsers. Silent fallback: the user
            // can still select-and-copy the JOBNUM text manually.
        }
    }

    return (
        <div>
            <div className="flex items-center gap-3">
                <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
                >
                    ✓
                </span>
                <p className="text-base font-semibold text-slate-900">
                    Work request filed in EAM
                </p>
            </div>

            <div className="mt-4 rounded-lg border-2 border-emerald-300 bg-linear-to-br from-emerald-50 to-white p-5">
                <p className="text-xs uppercase tracking-wide text-emerald-700">
                    Job number
                </p>
                <div className="mt-2 flex items-center gap-3">
                    <p className="font-mono text-3xl font-bold text-emerald-900">
                        {wr.jobNumber}
                    </p>
                    <button
                        type="button"
                        onClick={() => void handleCopy()}
                        className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    >
                        {copied ? "Copied!" : "Copy"}
                    </button>
                </div>
                {wr.upstreamMessage && (
                    <p className="mt-3 text-xs text-emerald-700">
                        {wr.upstreamMessage}
                    </p>
                )}
            </div>

            <p className="mt-3 text-xs text-slate-500">
                Filed by{" "}
                <span className="font-mono text-slate-700">{wr.requestedBy}</span>{" "}
                at {formatCreatedAt(wr.createdAt)}
            </p>
        </div>
    )
}

// formatCreatedAt - friendly absolute timestamp from an ISO-8601 string.
// Locale-aware (toLocaleString respects the user's browser settings) and
// guards against malformed input by falling back to the raw string.
function formatCreatedAt(iso: string): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return iso
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
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

// PickList - the button-list primitive. Each pick variant component (PickOrg,
// PickEquipment, PickProblemCode, PickType) renders its own prompt/banner/
// search/empty-state above this and drops in the same clickable list.
// Keyboard nav: Tab moves between items; Enter triggers (default <button> behavior).
function PickList({
    items,
    interactive,
    onClick,
}: {
    items: PickItem[]
    interactive: boolean
    onClick: (code: string, label: string) => void
}) {
    return (
        <ul className="space-y-1">
            {items.map((item) => (
                <li key={item.code}>
                    <button
                        type="button"
                        onClick={() => onClick(item.code, item.label)}
                        disabled={!interactive}
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:border-slate-400 hover:bg-slate-100 focus:border-slate-500 focus:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/20 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-white"
                    >
                        <span className="font-mono font-medium text-slate-900">
                            {item.primary}
                        </span>
                        <span className="ml-2 text-slate-600">{item.secondary}</span>
                    </button>
                </li>
            ))}
        </ul>
    )
}

// PickOrg - candidate list + a confidence banner. The AI matcher's topConfidence
// is the only place "% confident" makes sense (problem codes / types / equipment
// are static catalogues, no scoring). Showing the percentage tells the user WHY
// they're being asked to pick: "the AI was unsure, please confirm."
function PickOrg({
    candidates,
    topConfidence,
    interactive,
    onPick,
}: {
    candidates: OrganizationOption[]
    topConfidence: number
    interactive: boolean
    onPick: (field: PickField, code: string, label: string) => Promise<void>
}) {
    const pct = Math.round(topConfidence * 100)
    return (
        <div>
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                AI matcher was {pct}% confident — please confirm the right organization.
            </div>
            <p className="text-sm text-slate-700">
                Pick the EAM organization for this work request:
            </p>
            <div className="mt-3">
                <PickList
                    items={candidates.map((c) => ({
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
            </div>
        </div>
    )
}

// PickEquipment - search filter + cursor pagination ("Load more"). The agent's
// first response carries 50 records + nextCursor; this component appends
// further pages locally as the user clicks "Load more". Search runs across
// every loaded record (page 1 + page 2 + ...), so the filter behavior is
// "search what's loaded, click to load more to search further."
//
// Why local state for paginated candidates + cursor:
//   Each equipment-pick bubble is independent. Component-local state means
//   each bubble has its own paginated history and gets garbage-collected on
//   logout/start-over. Lifting to AgentChat would couple bubbles.
//
// Why useSession() inside (not sessionId as a prop):
//   The pagination call needs auth; pulling it from session here keeps prop
//   noise down and matches React idiom. AgentChat already requires session
//   to mount this component, so it's always non-null in practice.
function PickEquipment({
    candidates: initialCandidates,
    nextCursor: initialNextCursor,
    orgCode,
    interactive,
    onPick,
}: {
    candidates: EquipmentOption[]
    nextCursor: number | null
    orgCode: string
    interactive: boolean
    onPick: (field: PickField, code: string, label: string) => Promise<void>
}) {
    const { session } = useSession()
    // useState(initial) captures the prop value once at mount. Re-renders of
    // the parent don't reset our extended state - exactly what we want.
    const [candidates, setCandidates] = useState<EquipmentOption[]>(initialCandidates)
    const [cursor, setCursor] = useState<number | null>(initialNextCursor)
    const [loadingMore, setLoadingMore] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [query, setQuery] = useState("")

    async function handleLoadMore() {
        if (!session || cursor === null || loadingMore) return
        setLoadingMore(true)
        setLoadError(null)
        try {
            const page = await fetchEquipmentPage(orgCode, cursor, session.sessionId)
            setCandidates((prev) => [...prev, ...page.records])
            setCursor(page.nextCursor)
        } catch (err) {
            const message =
                err instanceof ApiError ? err.message : "Network or unexpected error"
            setLoadError(message)
        } finally {
            setLoadingMore(false)
        }
    }

    const q = query.trim().toLowerCase()
    const filtered =
        q.length === 0
            ? candidates
            : candidates.filter(
                  (c) =>
                      c.equipmentCode.toLowerCase().includes(q) ||
                      c.description.toLowerCase().includes(q),
              )

    return (
        <div>
            <p className="text-sm text-slate-700">Pick the equipment:</p>
            <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={!interactive}
                placeholder="Filter by code or description"
                aria-label="Filter equipment"
                className="mt-3 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:bg-slate-50 disabled:text-slate-500"
            />
            <p className="mt-2 text-xs text-slate-500">
                Showing {filtered.length} of {candidates.length}
                {q.length > 0 ? ` matching "${query}"` : ""}
            </p>
            {filtered.length === 0 ? (
                <div className="mt-3 rounded-md border border-dashed border-slate-300 px-4 py-6 text-center">
                    <p className="text-sm text-slate-500">
                        No equipment matches "
                        <span className="font-mono">{query}</span>".
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                        Try a different code or keyword
                        {cursor !== null ? ", or click “Load more” below" : ""}.
                    </p>
                </div>
            ) : (
                <div className="mt-3">
                    <PickList
                        items={filtered.map((c) => ({
                            code: c.equipmentCode,
                            primary: c.equipmentCode,
                            secondary: c.description,
                            label: `${c.equipmentCode} — ${c.description}`,
                        }))}
                        interactive={interactive}
                        onClick={(code, label) =>
                            void onPick("equipmentCode", code, label)
                        }
                    />
                </div>
            )}
            {cursor !== null && (
                <button
                    type="button"
                    onClick={() => void handleLoadMore()}
                    disabled={!interactive || loadingMore}
                    className="mt-3 w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
                >
                    {loadingMore ? "Loading…" : "Load more"}
                </button>
            )}
            {loadError && (
                <p
                    role="alert"
                    className="mt-2 text-xs text-red-700"
                >
                    Couldn't load more: {loadError}
                </p>
            )}
        </div>
    )
}

// PickProblemCode - 15 fixed entries; no search needed. Just prompt + list.
function PickProblemCode({
    candidates,
    interactive,
    onPick,
}: {
    candidates: ProblemCodeOption[]
    interactive: boolean
    onPick: (field: PickField, code: string, label: string) => Promise<void>
}) {
    return (
        <div>
            <p className="text-sm text-slate-700">What's the problem?</p>
            <div className="mt-3">
                <PickList
                    items={candidates.map((c) => ({
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
            </div>
        </div>
    )
}

// PickType - 6 fixed entries; same shape as PickProblemCode.
function PickType({
    candidates,
    interactive,
    onPick,
}: {
    candidates: WorkRequestTypeOption[]
    interactive: boolean
    onPick: (field: PickField, code: string, label: string) => Promise<void>
}) {
    return (
        <div>
            <p className="text-sm text-slate-700">Work request type:</p>
            <div className="mt-3">
                <PickList
                    items={candidates.map((c) => ({
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
            </div>
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
