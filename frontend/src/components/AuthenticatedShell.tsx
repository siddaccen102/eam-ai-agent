import { useSession } from "../auth/useSession"
import { AgentChat } from "./AgentChat"

// The shell that holds the agent flow once the user is authenticated. The
// header (chrome) is constant across all of Mini 7; the main area hosts the
// agent chat. Subsequent scrims (7.5 side panel, 7.7 polish) layer on top
// without changing this file.
export function AuthenticatedShell() {
    const { session, logout } = useSession()

    // useSession.status === "authenticated" implies session is not null, but
    // TypeScript doesn't know that. Guard explicitly so the rest of this
    // component can safely read session fields.
    if (!session) return null

    return (
        <div className="min-h-screen flex flex-col bg-slate-50">
            <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
                <h1 className="text-lg font-bold text-slate-900">EAM AI Agent</h1>
                <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-600">
                        Logged in as{" "}
                        <strong className="text-slate-900">{session.displayName}</strong>
                    </span>
                    <button
                        onClick={() => void logout()}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                        Logout
                    </button>
                </div>
            </header>

            <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">
                <AgentChat />
            </main>
        </div>
    )
}
