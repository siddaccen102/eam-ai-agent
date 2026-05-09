import { useState, FormEvent } from "react"
import { useSession } from "../auth/useSession"
import { ApiError } from "../api/client"

export function LoginForm() {
    const { login } = useSession()
    const [eamUsername, setEamUsername] = useState("")
    const [eamPassword, setEamPassword] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setError(null)
        setSubmitting(true)
        try {
            await login(eamUsername, eamPassword)
            // No state cleanup needed - the SessionProvider unmounts this
            // form entirely once status flips to "authenticated".
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message)
            } else {
                setError("Unexpected error during login")
            }
            setSubmitting(false)
        }
    }

    return (
        <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
            <form
                onSubmit={handleSubmit}
                className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
            >
                <h1 className="text-2xl font-bold text-slate-900">EAM AI Agent</h1>
                <p className="mt-1 text-sm text-slate-600">
                    Log in with your EAM credentials.
                </p>

                <div className="mt-6 space-y-4">
                    <label className="block">
                        <span className="block text-sm font-medium text-slate-700">
                            EAM username
                        </span>
                        <input
                            type="text"
                            value={eamUsername}
                            onChange={(e) => setEamUsername(e.target.value)}
                            autoFocus
                            required
                            autoComplete="username"
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                    </label>
                    <label className="block">
                        <span className="block text-sm font-medium text-slate-700">
                            EAM password
                        </span>
                        <input
                            type="password"
                            value={eamPassword}
                            onChange={(e) => setEamPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                    </label>
                </div>

                {error && (
                    <div
                        role="alert"
                        className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                    >
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={submitting || !eamUsername || !eamPassword}
                    className="mt-6 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {submitting ? "Signing in..." : "Sign in"}
                </button>
            </form>
        </main>
    )
}
