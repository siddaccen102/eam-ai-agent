// Canonical DTOs - vendor-agnostic shapes the rest of the app depends on.
// Defined in docs/integration-contracts.md. Mappers translate vendor payloads into these.

export type EquipmentOption = {
    equipmentCode: string
    label: string
    equipmentClass?: string
    locationCode?: string
    isActive: boolean
}

// More canonical DTOs land here as we map them in later mini-quests:
//   ValidatedUser           (Workday person)
//   OrganizationContext     (EAM site/department)
//   ProblemCodeOption       (EAM problem code)
//   WorkRequestResult       (EAM work order create response)
