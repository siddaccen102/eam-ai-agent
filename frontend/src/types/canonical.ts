// SYNCED FROM backend/src/types/canonical.ts
// Keep this file byte-for-byte identical to the backend version. When canonical.ts
// changes on the backend, copy the file over manually. Drift between the two will
// surface as TypeScript errors at the call sites - cheap to detect.
//
// Future automation options (post-PoC): npm workspaces, OpenAPI codegen, or a
// build-time copy script. For now, manual sync keeps the toolchain simple.

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

export type ProblemCodeOption = {
    code: string                // e.g., "P07"
    description: string         // e.g., "Leakage/ Pollution"
}

export type WorkRequestTypeOption = {
    code: string                // e.g., "BRKD"
    description: string         // e.g., "Corrective Maintenance (OPEX)"
}

export type WorkRequestInput = {
    organizationCode: string
    equipmentCode: string
    departmentCode: string
    locationCode?: string
    problemCode: string
    typeCode: string
    description: string
}

export type WorkRequestResult = {
    jobNumber: string
    organizationCode: string
    equipmentCode: string
    problemCode: string
    typeCode: string
    description: string
    status: { code: string; description: string }
    requestedBy: string
    createdAt: string
    upstreamMessage?: string
}

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

// ---- Agent orchestrator contracts -------------------------------------------

export type AgentRunInput = {
    email: string
    description: string
    organizationCode?: string
    equipmentCode?: string
    problemCode?: string
    typeCode?: string
}

export type AgentRunResolved = {
    user?: ValidatedUser
    organization?: OrganizationOption
    equipment?: EquipmentOption
    problemCode?: ProblemCodeOption
    type?: WorkRequestTypeOption
}

export type AgentRunResult =
    | {
          kind: "success"
          workRequest: WorkRequestResult
          correlationId: string
          resolved: AgentRunResolved
      }
    | {
          kind: "pick_org"
          candidates: OrganizationOption[]
          topConfidence: number
          correlationId: string
          resolved: AgentRunResolved
      }
    | {
          kind: "pick_equipment"
          candidates: EquipmentOption[]
          nextCursor: number | null
          correlationId: string
          resolved: AgentRunResolved
      }
    | {
          kind: "pick_problem_code"
          candidates: ProblemCodeOption[]
          correlationId: string
          resolved: AgentRunResolved
      }
    | {
          kind: "pick_type"
          candidates: WorkRequestTypeOption[]
          correlationId: string
          resolved: AgentRunResolved
      }
    | {
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
          correlationId: string
          resolved: AgentRunResolved
      }
