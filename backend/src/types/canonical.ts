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
    isActive: boolean
}

export type OrganizationOption = {
    code: string,               // EAM ORGANIZATIONCODE, e.g., "VTAT"
    description: string         // EAM DESCRIPTION, e.g., "Vopak Brasil S.A. - Terminal Aratu"
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
//   ProblemCodeOption       (EAM problem code)
//   WorkRequestResult       (EAM work order create response)
