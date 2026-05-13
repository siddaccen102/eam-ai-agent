# EAM AI Agent — Project Context

*Self-contained briefing for engineers, reviewers, or AI assistants.*

---

## 1. What this project is

A proof-of-concept "Agentic AI bot" for Vopak (an oil/chemical tank-storage company). It lets a Vopak engineer file a **work request** in HxGN EAM (a maintenance / asset-management system) by typing a short description and answering a few clarifying picks. The bot orchestrates three systems in one workflow:

- **Workday** — validates the user's Vopak identity and returns their terminal location (mocked for the POC; live OAuth pending).
- **HxGN EAM** — lists equipment for the user's terminal, returns problem codes, and creates the actual work order (live REST against the dev tenant).
- **OpenAI (GPT-4o-mini)** — bridges Workday's free-text "location" field to EAM's organization codes via semantic matching (e.g., "Aratu Terminal" → `VTAT — Vopak Brasil S.A. - Terminal Aratu`).

---

## 2. The manager's original brief

The brief (from Nagalakshmi K) defined six steps the bot must follow:

1. Validate the user's Vopak email against Workday.
2. Retrieve the user's terminal details from Workday.
3. Search for the corresponding organization in EAM using the terminal value.
4. List equipment for that organization as a lookup; user selects one.
5. List problem codes; user selects one.
6. Log a work request in EAM with all the above.

Scope is limited to Breakdown / Corrective Maintenance work orders (type code `BRKD` in EAM).

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Backend runtime | Node.js, TypeScript 6, Express 5, `tsx --watch` for dev |
| Backend HTTP client | axios |
| Backend validation | Zod for env; hand-rolled validation on routes |
| LLM SDK | `openai` npm package + `zod-to-json-schema` for structured output |
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS v4 |
| Frontend HTTP | Native `fetch` (no axios on frontend) |
| Auth model | Per-user EAM credentials (no shared service account); session = bearer token; in-memory session store |
| Dev CORS | Vite proxy forwards `/auth`, `/integrations`, `/health` to backend |
| Persistence | None — in-memory session store with 30-min TTL; sessions wipe on backend restart |

---

## 4. Repository layout

```
eam-ai-agent/
├── backend/
│   ├── src/
│   │   ├── config/env.ts                  (Zod-validated env vars)
│   │   ├── errors/integrationError.ts     (normalized upstream-error type)
│   │   ├── types/
│   │   │   ├── canonical.ts               (vendor-agnostic DTOs — the contract layer)
│   │   │   └── auth.ts                    (AuthContext type)
│   │   ├── services/
│   │   │   ├── workdayClient.ts           (Workday adapter; mock + live branches)
│   │   │   ├── workdayMock.ts             (in-memory mock users keyed by email)
│   │   │   ├── eamClient.ts               (EAM adapter; per-user auth, mappers, pagination)
│   │   │   ├── eamMappers.ts              (raw EAM JSON → canonical DTOs)
│   │   │   ├── llmClient.ts               (OpenAI wrapper with structured output)
│   │   │   ├── orgMatcher.ts              (AI org-resolution: auto / pick / fail)
│   │   │   ├── problemCodes.ts            (static catalogue from docs/Problem Codes.xlsx)
│   │   │   ├── workRequestTypes.ts        (static catalogue from docs/Work Request Type.xlsx)
│   │   │   ├── sessionStore.ts            (in-memory bearer-token sessions)
│   │   │   └── agentOrchestrator.ts       (the agent's 5-stage state machine)
│   │   ├── middleware/requireAuth.ts      (Bearer token → req.auth)
│   │   ├── routes/
│   │   │   ├── auth.ts                    (/login, /logout, /me)
│   │   │   ├── workday.ts                 (smoke routes)
│   │   │   ├── eam.ts                     (smoke routes incl. /smoke/equipment-for paginated)
│   │   │   ├── llm.ts                     (smoke routes)
│   │   │   └── agent.ts                   (POST /run — the agent endpoint)
│   │   └── index.ts                       (Express app + router mounts)
│   └── .env.local                         (EAM_BASE_URL, OPENAI_API_KEY, etc.)
└── frontend/
    └── src/
        ├── main.tsx                       (React entry)
        ├── App.tsx                        (auth state machine)
        ├── types/canonical.ts             (synced-by-hand copy of backend canonical.ts)
        ├── api/
        │   ├── client.ts                  (fetch wrapper + ApiError + bearer injection)
        │   ├── auth.ts                    (login/logout/fetchMe)
        │   ├── agent.ts                   (POST /agent/run)
        │   └── equipment.ts               (paginated equipment fetch for "Load more")
        ├── auth/
        │   ├── SessionContext.tsx         (provider + localStorage round-trip)
        │   └── useSession.ts              (hook with login/logout actions)
        └── components/
            ├── LoginForm.tsx              (email + EAM password)
            ├── AuthenticatedShell.tsx     (header + 2-col layout)
            └── AgentChat.tsx              (the full chat + side panel; ~700 lines)
```

---

## 5. Core architectural patterns

### 5.1 Canonical DTOs at the integration boundary

Every external system has a "raw" shape (whatever JSON the vendor returns) and a "canonical" shape (vendor-agnostic, what business logic uses). Mappers translate at the boundary. Examples in `types/canonical.ts`:

- `ValidatedUser` — `{ userId, email, displayName, location, company, isActive }`
- `OrganizationOption` — `{ code, description }`
- `EquipmentOption` — `{ equipmentCode, description, departmentCode?, locationCode?, isActive, ... }`
- `ProblemCodeOption`, `WorkRequestTypeOption` — `{ code, description }`
- `WorkRequestInput` / `WorkRequestResult` — canonical create input/output

Business logic never touches `ASSETID.EQUIPMENTCODE.ORGANIZATIONID.ORGANIZATIONCODE`; it touches `equipment.equipmentCode`. Replacing EAM is a mapper change, not a refactor.

### 5.2 Discriminated unions for typed state machines

The agent's return shape is a discriminated union on `kind`:

```typescript
type AgentRunResult =
  | { kind: "success"; workRequest: WorkRequestResult; correlationId; resolved }
  | { kind: "pick_org"; candidates: OrganizationOption[]; topConfidence; correlationId; resolved }
  | { kind: "pick_equipment"; candidates: EquipmentOption[]; nextCursor: number|null; correlationId; resolved }
  | { kind: "pick_problem_code"; candidates: ProblemCodeOption[]; correlationId; resolved }
  | { kind: "pick_type"; candidates: WorkRequestTypeOption[]; correlationId; resolved }
  | { kind: "fail"; reason: ...; message?; correlationId; resolved }
```

TypeScript narrows the type per branch; consumers `switch (result.kind)` exhaustively. Adding a new HIL state forces the compiler to flag every missing branch.

### 5.3 Stateless orchestrator with idempotent re-entry

`POST /integrations/agent/run` takes the same input shape on every call: `{ email, description, organizationCode?, equipmentCode?, problemCode?, typeCode? }`. The optional fields are filled in by the frontend after the user clicks a HIL (Human-In-the-Loop) pick. The orchestrator's invariant: **stages process in order; pre-resolved fields beyond the current stage just travel along until needed.**

No server-side run state, no run IDs, no TTL to manage. Trivially retryable, debuggable, replayable.

### 5.4 Adapter + Error normalization

Each external system has an axios-based adapter (`workdayClient`, `eamClient`, `llmClient`). Each adapter has:
- An axios instance with provider-specific defaults (base URL, headers, timeout)
- Request/response interceptors that mint a per-request correlation ID and log it
- An error normalizer that converts axios errors into typed `IntegrationError` with codes like `UPSTREAM_AUTH_FAILED`, `UPSTREAM_TIMEOUT`, `RESOURCE_NOT_FOUND`, `CONTRACT_MAPPING_ERROR`

### 5.5 End-to-end correlationId

Every agent run mints a `randomUUID()` at the top of `runAgent`. It's:
- Included in every `[agent] cid=X stage=N outcome=...` log line
- Surfaced in the response envelope of every `AgentRunResult` variant
- Displayed in the frontend's side panel (click to copy)
- Logged in the route's entry + exit lines

One `grep cid=X` gives the full server-side narrative for any user-facing call.

### 5.6 Domain failures vs infrastructure failures

- **Domain failures** (user not found, no org match, AI confidence too low) → typed `{ kind: "fail", reason: "..." }` in the discriminated union. Frontend renders an amber bubble with the reason.
- **Infrastructure failures** (EAM timeout, network down, LLM API error) → throw `IntegrationError` → route catches → returns 5xx. Frontend renders a red `ApiErrorBubble`.

Different UX for "user typo" vs "service down."

---

## 6. The agent's 5 stages

Inside `services/agentOrchestrator.ts`, `runAgent(input, auth)` walks:

| Stage | What | Returns |
|---|---|---|
| 1a | Workday user lookup by email | `resolved.user` or `fail user_not_found` / `fail user_inactive` |
| 1b | EAM user-orgs fetch + AI matcher (skipped if `organizationCode` pre-supplied) | `resolved.organization` or `pick_org` HIL or `fail no_org_match` |
| 2 | EAM equipment list for the org (skipped if `equipmentCode` pre-supplied + scan-validated) | `resolved.equipment` or `pick_equipment` HIL or `fail no_equipment_match` |
| 3 | Problem-code lookup from static catalogue (15 codes) | `resolved.problemCode` or `pick_problem_code` HIL |
| 4 | Type lookup from static catalogue (6 codes: ADAP/BRKD/DAMA/MODI/WOOI/WOPS) | `resolved.type` or `pick_type` HIL |
| 5 | Create work request in EAM via POST /workorders | `success` with JOBNUM or bubbled infrastructure error |

Each stage's skip-when-resolved logic checks the input field; if present, it validates (or trusts, for the simple cases) and falls through. If absent, the stage returns a HIL response.

---

## 7. Authentication

- User logs in with **Vopak email + EAM password**.
- Backend's `/auth/login` does two-step validation:
  1. Workday lookup confirms the email exists and the user is active. Errors: `EMAIL_NOT_FOUND` (401), `USER_INACTIVE` (403).
  2. EAM username is derived as `email.split("@")[0].toUpperCase()` (e.g., `rashid.siddiqui@vopak.com` → `RASHID.SIDDIQUI`). EAM is hit with `GET /positions` using these credentials to confirm the password. Error: `EAM_AUTH_FAILED` (401).
- On success, session is minted with `{ sessionId, eamAuth: { username, password }, email, displayName, expiresAt }`. Frontend stores `sessionId` in localStorage.
- Every subsequent API call includes `Authorization: Bearer <sessionId>`. The `requireAuth` middleware attaches `req.auth` for downstream handlers.

---

## 8. EAM domain notes

- **EAM equipment hierarchy**: Position (P) / Asset (A) / System (S). Work requests target **Positions** (`obj_obrtype='P'`), so the agent uses `GET /positions` not `GET /assets`.
- **Pagination**: `/positions` doesn't accept query params for filtering; it uses a `cursorposition` HTTP header. The orchestrator's helper paginates internally with a HARD_CAP of 30 raw calls.
- **Case sensitivity**: EAM Basic auth is case-insensitive, but path parameters like `/usersetup/{username}/organizations` are case-sensitive. Usernames are normalized to uppercase at the auth route boundary.
- **OOS filter**: equipment with `OUTOFSERVICE === "true"` is filtered out by default. Matches the dataspy SQL filter `NVL(obj_notused, '-') <> '+'`.
- **`organization: *` header**: needed on `/usersetup/{user}/organizations` and `POST /workorders` because the env-default `VTAT` would scope the lookup itself. Body-level `WORKORDERID.ORGANIZATIONID` is what actually targets the org for create.
- **Static lookups for problem codes + types**: EAM doesn't expose these via REST in the Vopak dev tenant. Mirrored from xlsx files in `docs/`.
- **JOBNUM placeholder**: on create, the `WORKORDERID.JOBNUM` field is sent as `"0"` because `auto_generated: true` tells EAM to assign the real number. The placeholder value is ignored.

---

## 9. Frontend UX patterns

- **Chat-style interface** (not a step-by-step wizard) because the manager called it an "Agentic AI bot." Every HIL returns a bubble; user clicks; new bubble appears.
- **Side panel ("Run state")** sticky on the right. Shows User (pre-populated from session) + Organization + Equipment + Problem code + Type as a five-row layout. Resolved rows show `✓` with the value; unresolved show `·` with "Not yet". The `correlationId` lives in a click-to-copy footer.
- **Equipment search** filters across all loaded pages. Live filter, no debounce (50-item baseline is fast enough).
- **"Load more"** for equipment pagination calls `/integrations/eam/smoke/equipment-for?cursor=N` directly (not through the agent endpoint) so each cursor advance doesn't re-do Workday + AI matcher work.
- **Autoscroll** on every new turn + when `pending` flips true.
- **Copy-to-clipboard** on JOBNUM (success bubble) and `correlationId` (side panel). 2-second "Copied!" feedback.

---

## 10. API endpoints

| Method | Path | Auth | What |
|---|---|---|---|
| POST | `/auth/login` | none | `{ email, eamPassword }` → session |
| POST | `/auth/logout` | bearer | idempotent — clears session |
| GET | `/auth/me` | bearer | session details |
| POST | `/integrations/agent/run` | bearer | the orchestrator entry point — accepts `AgentRunInput`, returns `AgentRunResult` |
| GET | `/integrations/eam/smoke/equipment-for?orgCode=X&cursor=N` | bearer | paginated equipment fetch (Load more) |
| GET | `/integrations/eam/smoke/organizations` | bearer | user's authorized orgs |
| GET | `/integrations/eam/smoke/problem-codes` | bearer | the 15-row static catalogue |
| GET | `/integrations/eam/smoke/work-request-types` | bearer | the 6-row static catalogue |
| POST | `/integrations/eam/smoke/work-request` | bearer | direct work-request create (bypasses orchestrator) |
| GET | `/integrations/llm/smoke/match-org?email=...` | bearer | direct AI matcher invocation |
| GET | `/health` | none | liveness — always returns 200 |

---

## 11. What's done vs deferred

### Done end-to-end

- Email-based login with two-step Workday + EAM validation
- All five stages of the orchestrator
- All four HIL pick UIs in the frontend
- Equipment pagination, search filter, side panel, success view with JOBNUM copy
- correlationId end-to-end logging
- Per-user auth, no shared service account
- ~99% of "demo-ready" scope

### Deferred (post-PoC manager pitch)

- AI suggestions for equipment / problem code from free-text description (the bot picks a default; user confirms or overrides)
- Deep links into EAM UI from the success view (URL pattern unverified)
- Threading the agent's correlationId through outbound Workday + EAM HTTP calls (would touch ~6 helper signatures)

### Production gaps (intentional for POC)

- In-memory session store (would swap for Redis)
- No idempotency key on `POST /workorders` (double-click could create two records)
- No tests
- No deployment / Dockerfile
- Workday live mode not wired (awaiting OAuth credentials); uses `workdayMock.ts`
- Frontend canonical types are a manual copy of backend; no monorepo or codegen

---

## 12. Known quirks

- **`tsx --watch` on Windows** sometimes drops multi-file edits. Symptom: backend runs old code despite saved changes. Fix: kill the backend PID and `npm run dev` again. Two real bugs in this project were caused by this watcher missing edits.
- **axios v1 instance-level `auth` config** clobbers per-request `Authorization` headers during request prep. We avoid this by NOT setting `auth` on `axios.create()` and building the `Authorization: Basic <base64>` header explicitly in every helper.
- **EAM returns 200 with empty `DATARECORD`** for unknown usernames in `/usersetup/{user}/organizations` — surfaces as `CONTRACT_MAPPING_ERROR` in our envelope check. Caused by lowercase usernames hitting a case-sensitive path. Fixed by normalizing username to uppercase at the auth route entry.

---

## 13. How to run

```bash
# Terminal 1
cd backend && npm install && npm run dev
# → http://localhost:5000

# Terminal 2
cd frontend && npm install && npm run dev
# → http://localhost:5173

# Browse to http://localhost:5173, log in with a mock email
# (e.g., rashid.siddiqui@vopak.com) + real EAM dev tenant password
```

---

## 14. Heaviest source files (for code-level questions)

- `backend/src/services/agentOrchestrator.ts` (~340 lines — the agent state machine)
- `backend/src/services/eamClient.ts` (~470 lines — auth, mappers, pagination)
- `backend/src/types/canonical.ts` (~230 lines — all the DTOs)
- `frontend/src/components/AgentChat.tsx` (~700 lines — the entire chat UI)

---

*Document generated 2026-05-11 to support handoff and AI-assisted follow-up work.*
