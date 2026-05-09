import { useSession } from "../auth/useSession"

// The shell that holds the agent flow once the user is authenticated.
// Mini 7.1 ships an empty main area; Mini 7.2 fills it with the chat-style
// agent flow. Everything outside the <main> below is "chrome" that stays
// constant across all subsequent scrims (header, logout, branding).
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
                        <strong className="text-slate-900">{session.eamUsername}</strong>
                    </span>
                    <button
                        onClick={() => void logout()}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                        Logout
                    </button>
                </div>
            </header>

            <main className="flex-1 mx-auto w-full max-w-3xl px-6 py-12">
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
                    <p className="text-sm text-slate-500">
                        Agent flow lands here in Mini 7.2.
                    </p>
                </div>
            </main>
        </div>
    )
}
