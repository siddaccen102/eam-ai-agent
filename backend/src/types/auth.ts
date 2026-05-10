// Per-request auth context. Created by middleware from a session lookup
// (today, Option B: typed-credential entry) or from a validated SSO token
// (future, Option C: federated Okta -> EAM). Helpers downstream consume this
// without knowing or caring which path created it.
//
// Adding a field here (e.g., ssoToken, workdayUserId) doesn't break any
// existing helper that only reads eamAuth - that's the boundary discipline.
export type AuthContext = {
    sessionId: string
    eamAuth: { username: string; password: string }
    // Captured at login time from Workday. The agent flow uses `email` to
    // identify "who's filing" without re-prompting; UI surfaces displayName.
    // EAM username is derived from email's local part on login (uppercased)
    // so the session keeps it in canonical EAM form.
    email: string
    displayName: string
    expiresAt: number
}
