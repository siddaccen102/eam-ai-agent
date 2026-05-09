// Canonical DTOs - vendor-agnostic shapes the rest of the app depends on.
// Defined in docs/integration-contracts.md. Mappers translate vendor payloads into these.

export type ValidatedUser = {
    userId: string
    email: string
    displayName: string
    location: string         // Workday "Location" field, e.g., "Aratu Terminal"
    company: string          // Workday "Company" field, e.g., "Vopak Brasil SA"
    isActive: boolean
}

export type EquipmentOption = {
    equipmentCode: string
    description: string         // EAM equipment description (POSITIONID.DESCRIPTION / ASSETID.DESCRIPTION)
    equipmentClass?: string
    departmentCode?: string     // EAM DEPARTMENTID.DEPARTMENTCODE - the equipment's owning department
    locationCode?: string       // EAM LOCATIONID.LOCATIONCODE - physical site/area; needed for work-request body
    isActive: boolean
}

export type OrganizationOption = {
    code: string,               // EAM ORGANIZATIONCODE, e.g., "VTAT"
    description: string         // EAM DESCRIPTION, e.g., "Vopak Brasil S.A. - Terminal Aratu"
}

// What's-wrong classification on a work request. In this EAM tenant, problem
// codes are a fixed enumeration (not org- or class-scoped) sourced from
// docs/Problem Codes.xlsx. The DTO is the same shape we'll return if/when EAM
// exposes a problem-code REST endpoint, so swapping the data source later
// won't ripple to consumers.
export type ProblemCodeOption = {
    code: string                // e.g., "P07"
    description: string         // e.g., "Leakage/ Pollution"
}

// Work-request type classification (CAPEX/OPEX category). Same static-lookup
// pattern as ProblemCodeOption; sourced from docs/Work Request Type.xlsx.
// EAM needs both code and description in the work-order body, so the lookup
// has to be reversible (find-by-code) - the description alone won't do.
export type WorkRequestTypeOption = {
    code: string                // e.g., "BRKD"
    description: string         // e.g., "Corrective Maintenance (OPEX)"
}

// Canonical input for creating a work request. Frontend assembles this from
// the prior steps (org -> equipment -> problem code + type + description).
// We deliberately accept CODES, not descriptions: descriptions are UI labels
// looked up from the static lookups server-side. Sending codes keeps the
// wire format short, type-safe, and resilient to future label/translation
// changes.
//
// departmentCode and locationCode are taken from the equipment selection
// rather than re-derived: the frontend already has the EquipmentOption from
// /smoke/equipment-for, so passing them through avoids an extra EAM round-trip
// per submit. The route trusts these values - if they don't match the
// equipment, EAM will reject the create with a meaningful error.
export type WorkRequestInput = {
    organizationCode: string    // VTAT
    equipmentCode: string       // AC.001.01.01
    departmentCode: string      // MANUT-ARAT (from equipment.departmentCode)
    // locationCode is optional for the POC: EAM /positions doesn't currently
    // return LOCATIONID and Swagger confirms work-orders can be created
    // without it. When we wire a location source later, callers can start
    // sending it and the EAM body will include LOCATIONID automatically.
    locationCode?: string       // BLD.01.AR
    problemCode: string         // P01
    typeCode: string            // BRKD
    description: string         // free text, 1..200 chars
}

// What we return after a successful create. Echoes the relevant input fields
// for traceability + the EAM-assigned job number + a server-side timestamp
// (EAM doesn't echo a useful create timestamp). The status block is constant
// for now (every fresh request lands in "Q"/"Registered" per tenant policy)
// but we send it as a real field, not a comment, so downstream UI/logging
// doesn't have to know that constant lives elsewhere.
export type WorkRequestResult = {
    jobNumber: string                                 // e.g., "12101874"
    organizationCode: string
    equipmentCode: string
    problemCode: string
    typeCode: string
    description: string
    status: { code: string; description: string }    // currently always { "Q", "Registered" }
    requestedBy: string                               // session username
    createdAt: string                                 // ISO-8601 server clock
    upstreamMessage?: string                          // EAM's InfoAlert.Message for UX surfacing
}

// Result of the AI org-matcher. Discriminated union so consumers can branch
// on `kind` and the compiler narrows the type accordingly:
//   - "auto" : top match >= 0.9 confidence; no user input needed
//   - "pick" : 0.6 <= top < 0.9; surface candidates and let the user pick
//   - "fail" : nothing usable; show an explicit error
export type OrgResolution =
    | {
          kind: "auto"
          organization: OrganizationOption
          confidence: number
          reasoning?: string
      }
    | {
          kind: "pick"
          candidates: OrganizationOption[]
          topConfidence: number
          reason: "low_confidence"
      }
    | {
          kind: "fail"
          reason:
              | "no_candidates_available"
              | "llm_returned_no_matches"
              | "llm_returned_unknown_org_code"
              | "no_candidates_above_threshold"
          topConfidence?: number
      }

// More canonical DTOs land here as we map them in later mini-quests:
//   ValidatedUser           ✅ done
//   OrganizationOption      ✅ done (EAM organization, name -> code resolution)
//   OrgResolution           ✅ done (AI matcher result, discriminated union)
//   ProblemCodeOption       ✅ done (static lookup; see services/problemCodes.ts)
//   WorkRequestTypeOption   ✅ done (static lookup; see services/workRequestTypes.ts)
//   WorkRequestInput        ✅ done (canonical create-work-request input)
//   WorkRequestResult       ✅ done (EAM work order create response, canonical)
//   AgentRunInput           ✅ done (input to the orchestrator)
//   AgentRunResult          ✅ done (discriminated union: success / pick_* / fail)

// ---- Agent orchestrator contracts (Mini 6.1) ---------------------------------
//
// The orchestrator stitches Workday user lookup, EAM org list, AI org matcher,
// equipment lookup, problem-code lookup, type lookup and work-request creation
// into ONE typed contract. Every call to POST /integrations/agent/run takes the
// same input shape and returns one of several discriminated results.
//
// Re-entry pattern: the input is idempotent. The first call has just email +
// description; if the orchestrator returns a HIL pick variant, the frontend
// re-calls with the user's chosen value filled in (e.g., organizationCode).
// The orchestrator skips stages whose inputs are already resolved. No server-
// side run state, no run IDs, no TTL to manage.

export type AgentRunInput = {
    // Required - the workflow needs both at minimum.
    email: string                    // Workday lookup key
    description: string              // user's free-text problem statement; AI matches against
                                     // equipment/problem codes/types AND becomes the WR description.
                                     // Capped at 200 chars to match the WR description limit -
                                     // truncation later would surprise the user.

    // Optional - filled by the frontend on re-entry after a HIL pick.
    organizationCode?: string
    equipmentCode?: string
    problemCode?: string
    typeCode?: string
}

// Partial-resolution echo. Every AgentRunResult variant carries this so the
// frontend can render "what we figured out so far" alongside the next prompt.
// Keeps the server as the source of truth for run state - the frontend never
// has to track what's been resolved across calls.
export type AgentRunResolved = {
    user?: ValidatedUser
    organization?: OrganizationOption
    equipment?: EquipmentOption
    problemCode?: ProblemCodeOption
    type?: WorkRequestTypeOption
}

// All possible outcomes of a single runAgent call. Discriminated union on `kind`
// so consumers can switch exhaustively and add a new HIL state in one place.
export type AgentRunResult =
    | {
          // Happy path: every stage resolved + work request created in EAM.
          kind: "success"
          workRequest: WorkRequestResult
          resolved: AgentRunResolved
      }
    | {
          // AI matcher returned mid-confidence on org. Frontend prompts user
          // to pick from the candidates and re-calls with organizationCode set.
          kind: "pick_org"
          candidates: OrganizationOption[]
          topConfidence: number
          resolved: AgentRunResolved
      }
    | {
          // Equipment HIL: surface the first page of the user's authorized
          // org's equipment list. Frontend handles "Load more" by hitting
          // /integrations/eam/smoke/equipment-for?orgCode=X&cursor=N directly
          // - the agent endpoint stays focused on workflow, not pagination.
          // nextCursor is null when EAM has no further records.
          kind: "pick_equipment"
          candidates: EquipmentOption[]
          nextCursor: number | null
          resolved: AgentRunResolved
      }
    | {
          // Problem code couldn't be resolved from the free text. Show the
          // (small, static) catalogue.
          kind: "pick_problem_code"
          candidates: ProblemCodeOption[]
          resolved: AgentRunResolved
      }
    | {
          // Type couldn't be resolved (no obvious CAPEX vs OPEX cue). Show
          // the static catalogue.
          kind: "pick_type"
          candidates: WorkRequestTypeOption[]
          resolved: AgentRunResolved
      }
    | {
          // Unrecoverable. The reason union grows as stages 6.2-6.4 add
          // failure modes; for the 6.1 skeleton only "not_implemented" is wired.
          kind: "fail"
          reason:
              | "not_implemented"
              | "user_not_found"
              | "user_inactive"
              | "no_org_match"
              | "no_equipment_match"
              | "no_problem_code_match"
              | "no_type_match"
              | "internal_error"
          message?: string
          resolved: AgentRunResolved
      }
