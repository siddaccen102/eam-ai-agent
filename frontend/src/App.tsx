import { SessionProvider } from "./auth/SessionContext"
import { useSession } from "./auth/useSession"
import { LoginForm } from "./components/LoginForm"
import { AuthenticatedShell } from "./components/AuthenticatedShell"

// AppRoutes - the auth state machine. Three states:
//   - "checking"      : initial mount, /auth/me in flight (stored session?
//                       valid?). Render a tiny placeholder so we don't flash
//                       the login form for users who are already logged in.
//   - "anonymous"     : no stored session OR /auth/me rejected it. Show login.
//   - "authenticated" : valid session in context. Show the shell.
//
// We split AppRoutes from App so AppRoutes can call useSession (which requires
// being inside <SessionProvider>). App itself doesn't read the session - it
// just sets up the provider scope.
function AppRoutes() {
    const { status } = useSession()

    if (status === "checking") {
        return (
            <main className="min-h-screen flex items-center justify-center bg-slate-50">
                <p className="text-sm text-slate-500">Checking session...</p>
            </main>
        )
    }

    return status === "authenticated" ? <AuthenticatedShell /> : <LoginForm />
}

export default function App() {
    return (
        <SessionProvider>
            <AppRoutes />
        </SessionProvider>
    )
}
