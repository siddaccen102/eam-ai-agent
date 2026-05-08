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

// EAM /positions wraps the position id inside POSITIONID (parallel to ASSETID
// on /assets). The work-request lookup queries Position-type records; this is
// the right shape for that workflow.
export type EamPositionRaw = {
    POSITIONID: {
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
    INPRODUCTION: "true" | "false" | null
    OUTOFSERVICE: "true" | "false" | null
}

// toEquipmentOption - pure mapping from raw EAM asset to canonical DTO.
// No I/O, no side effects. Testable in isolation.
//
// isActive semantics: matches the EAM work-request equipment lookup's OOS
// filter. The OUTOFSERVICE JSON field surfaces obj_notused at the database
// level; the dataspy filter NVL(obj_notused, '-') <> '+' is what gates
// visible/usable equipment. INPRODUCTION is not part of the dataspy filter -
// only OUTOFSERVICE matters for "can this show up in the lookup".
export function toEquipmentOption(asset: EamAssetRaw): EquipmentOption {
    return {
        equipmentCode: asset.ASSETID.EQUIPMENTCODE,
        label: asset.ASSETID.DESCRIPTION ?? asset.ASSETID.EQUIPMENTCODE,
        equipmentClass: asset.CLASSID?.CLASSCODE ?? undefined,
        locationCode: asset.DEPARTMENTID?.DEPARTMENTCODE ?? undefined,
        isActive: asset.OUTOFSERVICE === "false"
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

// toPositionEquipmentOption - parallel to toEquipmentOption but for /positions
// records (POSITIONID wrapper instead of ASSETID). Same canonical EquipmentOption
// shape goes out, so the route layer doesn't care which raw type we mapped from.
export function toPositionEquipmentOption(pos: EamPositionRaw): EquipmentOption {
    return {
        equipmentCode: pos.POSITIONID.EQUIPMENTCODE,
        label: pos.POSITIONID.DESCRIPTION ?? pos.POSITIONID.EQUIPMENTCODE,
        equipmentClass: pos.CLASSID?.CLASSCODE ?? undefined,
        locationCode: pos.DEPARTMENTID?.DEPARTMENTCODE ?? undefined,
        isActive: pos.OUTOFSERVICE === "false",
    }
}
