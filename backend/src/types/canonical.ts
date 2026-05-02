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
    label: string
    equipmentClass?: string
    locationCode?: string
    isActive: boolean
}

export type OrganizationOption = {
    code: string,               // EAM ORGANIZATIONCODE, e.g., "VTAT"
    description: string         // EAM DESCRIPTION, e.g., "Vopak Brasil S.A. - Terminal Aratu"
}

// More canonical DTOs land here as we map them in later mini-quests:
//   ValidatedUser           ✅ done
//   OrganizationContext     ✅ done (EAM organization, name -> code resolution)
//   ProblemCodeOption       (EAM problem code)
//   WorkRequestResult       (EAM work order create response)
