import { EquipmentOption, OrganizationOption } from "../types/canonical"

// Raw EAM asset shape. We only model the fields we use.
// EAM returns ~100 other fields per record - mostly null - which we deliberately ignore.
// Adding more fields later is non-breaking.
export type EamAssetRaw = {
    ASSETID: {
        EQUIPMENTCODE: string
        ORGANIZATIONID: {
            ORGANIZATIONCODE: string
            DESCRIPTION: string | null
        } | null
        DESCRIPTION: string | null
    }
    CLASSID: {
        CLASSCODE: string
        DESCRIPTION: string | null
    } | null
    DEPARTMENTID: {
        DEPARTMENTCODE: string
        DESCRIPTION: string | null
    } | null
    // EAM serializes booleans as the strings "true"/"false" (or null).
    INPRODUCTION: "true" | "false" | null
    OUTOFSERVICE: "true" | "false" | null
}

// EAM /organization wraps the actual code+description inside an ORGANIZATIONID
// object - same pattern as ASSETID.ORGANIZATIONID on asset records.
// We only model the fields we use; everything else (currency, locale, UDFs, ...)
// is intentionally ignored.
export type EamOrganizationRaw = {
    ORGANIZATIONID: {
        ORGANIZATIONCODE: string
        DESCRIPTION: string | null
    }
}

// toEquipmentOption - pure mapping from raw EAM asset to canonical DTO.
// No I/O, no side effects. Testable in isolation.
export function toEquipmentOption(asset: EamAssetRaw): EquipmentOption {
    return {
        equipmentCode: asset.ASSETID.EQUIPMENTCODE,
        label: asset.ASSETID.DESCRIPTION ?? asset.ASSETID.EQUIPMENTCODE,
        equipmentClass: asset.CLASSID?.CLASSCODE ?? undefined,
        locationCode: asset.DEPARTMENTID?.DEPARTMENTCODE ?? undefined,
        isActive: asset.INPRODUCTION === "true" && asset.OUTOFSERVICE === "false"
    }
}

// toOrganizationOption - pure mapping from raw EAM organization to canonical DTO.
// description falls back to code if upstream returns null - so the AI matcher
// never sees an empty string.
export function toOrganizationOption(raw: EamOrganizationRaw): OrganizationOption {
    const id = raw.ORGANIZATIONID
    return {
        code: id.ORGANIZATIONCODE,
        description: id.DESCRIPTION ?? id.ORGANIZATIONCODE,
    }
}
