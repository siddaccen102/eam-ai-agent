import { randomUUID } from "node:crypto"
import { ValidatedUser } from "../types/canonical"
import { IntegrationError } from "../errors/integrationError"

// Mock canonical user records keyed by lowercased email.
// Add yourself if you want to "log in" as you during testing.
//
// Real Workday returns sub-resource URLs from /people and richer fields
// from /workers/{id} or its sub-resources. We collapse that multi-call
// dance into one canonical record per user here so the app can keep
// building. When OAuth credentials arrive, getWorkdayUserByEmail's live
// branch will do the real multi-call and return this same shape.
const MOCK_USERS: Record<string, ValidatedUser> = {
    "leticia.sales@vopak.com": {
        userId: "wd-001",
        email: "leticia.sales@vopak.com",
        displayName: "Leticia Pinho Sales",
        location: "Aratu Terminal",
        company: "Vopak Brasil SA",
        isActive: true,
    },
    "andre.silva@vopak.com": {
        userId: "wd-002",
        email: "andre.silva@vopak.com",
        displayName: "Andre da Silva Ojevan",
        location: "Aratu Terminal",
        company: "Vopak Brasil SA",
        isActive: true,
    },
    "test.pengerang@vopak.com": {
        userId: "wd-003",
        email: "test.pengerang@vopak.com",
        displayName: "Test User Pengerang",
        location: "Pengerang Terminals Two",
        company: "Vopak Singapore",
        isActive: true,
    },
    "inactive.user@vopak.com": {
        userId: "wd-004",
        email: "inactive.user@vopak.com",
        displayName: "Inactive Test User",
        location: "Aratu Terminal",
        company: "Vopak Brasil SA",
        isActive: false,
    },
}

export async function mockGetWorkdayUserByEmail(email: string): Promise<ValidatedUser> {
    const key = email.toLowerCase().trim()
    const user = MOCK_USERS[key]
    if (!user) {
        throw new IntegrationError({
            code: "RESOURCE_NOT_FOUND",
            message: `No Workday user matched email ${email}`,
            correlationId: randomUUID(),
            details: { provider: "workday", status: 404 },
        })
    }
    return user
}
