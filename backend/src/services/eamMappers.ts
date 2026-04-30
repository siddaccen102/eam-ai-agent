import { EquipmentOption } from "../types/canonical"

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
