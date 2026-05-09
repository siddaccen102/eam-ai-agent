import { EquipmentOption, OrganizationOption, WorkRequestResult } from "../types/canonical"

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
    LOCATIONID: {
        LOCATIONCODE: string
        DESCRIPTION: string | null
    } | null
    // EAM serializes booleans as the strings "true"/"false" (or null).
    INPRODUCTION: "true" | "false" | null
    OUTOFSERVICE: "true" | "false" | null
}

// EAM /usersetup/{user}/organizations returns USERORGANIZATION records: the
// orgs the authenticated user has access to. ORGANIZATIONID is nested one
// level deeper than on /organization (under USERORGANIZATIONID), reflecting
// the user-org join semantics. We only model the fields we use.
export type EamUserOrganizationRaw = {
    USERORGANIZATIONID: {
        ORGANIZATIONID: {
            ORGANIZATIONCODE: string
            DESCRIPTION: string | null
        }
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
    LOCATIONID: {
        LOCATIONCODE: string
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
        description: asset.ASSETID.DESCRIPTION ?? asset.ASSETID.EQUIPMENTCODE,
        equipmentClass: asset.CLASSID?.CLASSCODE ?? undefined,
        departmentCode: asset.DEPARTMENTID?.DEPARTMENTCODE ?? undefined,
        locationCode: asset.LOCATIONID?.LOCATIONCODE ?? undefined,
        isActive: asset.OUTOFSERVICE === "false"
    }
}

// toUserOrganizationOption - pure mapping from a USERORGANIZATION record to the
// canonical OrganizationOption. Caller is responsible for filtering out the "*"
// wildcard org (it's the EAM "all-orgs" sentinel, not a real terminal).
// description falls back to code if upstream returns null - so the AI matcher
// never sees an empty string.
export function toUserOrganizationOption(raw: EamUserOrganizationRaw): OrganizationOption {
    const id = raw.USERORGANIZATIONID.ORGANIZATIONID
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
        description: pos.POSITIONID.DESCRIPTION ?? pos.POSITIONID.EQUIPMENTCODE,
        equipmentClass: pos.CLASSID?.CLASSCODE ?? undefined,
        departmentCode: pos.DEPARTMENTID?.DEPARTMENTCODE ?? undefined,
        locationCode: pos.LOCATIONID?.LOCATIONCODE ?? undefined,
        isActive: pos.OUTOFSERVICE === "false",
    }
}

// EAM POST /workorders request body shape, derived from the working sample
// payload. Notes:
//   - WORKORDERID.JOBNUM is a placeholder string; auto_generated:true tells
//     EAM to assign the real number and ignore what we sent.
//   - STATUS is currently always {"Q","Registered"} per tenant policy for
//     newly-filed work requests. Hardcoded constants live in the request
//     mapper so the canonical input shape stays free of vendor codes.
//   - Every nested ID block (DEPARTMENTID, EQUIPMENTID, LOCATIONID) re-asserts
//     ORGANIZATIONID. EAM uses that to disambiguate codes that may repeat
//     across orgs - we always echo the same org code on every nested ID.
//   - OBJTYPE:"P" pins the work request to a Position (not Asset/System).
//     Positions are the dataspy obrtype='P' layer that work requests target;
//     we hardcode it because the equipment helper already returns Positions.
//   - We deliberately omit the `recordid` field the read responses carry; EAM
//     ignores it on create and the sample showed `recordid:null` in the
//     response anyway.
export type EamWorkOrderRequestBody = {
    WORKORDERID: {
        JOBNUM: string
        ORGANIZATIONID: { ORGANIZATIONCODE: string; DESCRIPTION: null }
        DESCRIPTION: string
        auto_generated: true
    }
    STATUS: { STATUSCODE: "Q"; DESCRIPTION: "Registered" }
    EQUIPMENTID: {
        EQUIPMENTCODE: string
        ORGANIZATIONID: { ORGANIZATIONCODE: string; DESCRIPTION: null }
        DESCRIPTION: null
    }
    CREATEDBY: { USERCODE: string; DESCRIPTION: null }
    TYPE: { TYPECODE: string; DESCRIPTION: string }
    DEPARTMENTID: {
        DEPARTMENTCODE: string
        ORGANIZATIONID: { ORGANIZATIONCODE: string; DESCRIPTION: null }
        DESCRIPTION: null
    }
    PROBLEMCODEID: { PROBLEMCODE: string; DESCRIPTION: string }
    // LOCATIONID is optional: EAM Swagger confirms work-orders can be created
    // without a location block. The current /positions read path doesn't
    // return LOCATIONID anyway, so we don't have a value to send most of the
    // time. The block is included in the body only when the caller supplies
    // a non-empty locationCode.
    LOCATIONID?: {
        LOCATIONCODE: string
        ORGANIZATIONID: { ORGANIZATIONCODE: string; DESCRIPTION: null }
        DESCRIPTION: null
    }
    OBJTYPE: "P"
}

// EAM POST /workorders response envelope. We only model the fields we read.
// The interesting bit is Result.ResultData.JOBNUM (the assigned WO number)
// and Result.InfoAlert.Message (a user-friendly upstream message we can
// surface back through to the UI for confirmation).
export type EamWorkOrderCreateResponseRaw = {
    Result?: {
        SessionID?: string | null
        ResultData?: {
            JOBNUM?: string | null
            recordid?: number | null
        } | null
        InfoAlert?: { Message?: string | null; Name?: string | null } | null
        WarningAlert?: unknown
    } | null
    ConfirmationAlert?: unknown
    ErrorAlert?: unknown[]
}

// JOBNUM placeholder we send. Any string works because auto_generated:true
// tells EAM to ignore it and assign its own number; we use a constant rather
// than a random/timestamped value so request bodies are deterministic and
// easy to compare in logs/tests.
const JOBNUM_PLACEHOLDER = "0"

// toEamWorkOrderRequestBody - canonical input + enrichment -> EAM body.
// Pure function; doesn't fetch lookups itself. The route layer is responsible
// for resolving problem-code description and type description from the static
// lookups before calling, which keeps validation errors (unknown code) at the
// route boundary as 400s rather than getting wrapped in IntegrationError.
export function toEamWorkOrderRequestBody(args: {
    organizationCode: string
    equipmentCode: string
    departmentCode: string
    locationCode?: string
    problemCode: string
    problemCodeDescription: string
    typeCode: string
    typeDescription: string
    description: string
    requestedBy: string
}): EamWorkOrderRequestBody {
    const orgRef = { ORGANIZATIONCODE: args.organizationCode, DESCRIPTION: null as null }
    const body: EamWorkOrderRequestBody = {
        WORKORDERID: {
            JOBNUM: JOBNUM_PLACEHOLDER,
            ORGANIZATIONID: orgRef,
            DESCRIPTION: args.description,
            auto_generated: true,
        },
        STATUS: { STATUSCODE: "Q", DESCRIPTION: "Registered" },
        EQUIPMENTID: {
            EQUIPMENTCODE: args.equipmentCode,
            ORGANIZATIONID: orgRef,
            DESCRIPTION: null,
        },
        CREATEDBY: { USERCODE: args.requestedBy, DESCRIPTION: null },
        TYPE: { TYPECODE: args.typeCode, DESCRIPTION: args.typeDescription },
        DEPARTMENTID: {
            DEPARTMENTCODE: args.departmentCode,
            ORGANIZATIONID: orgRef,
            DESCRIPTION: null,
        },
        PROBLEMCODEID: {
            PROBLEMCODE: args.problemCode,
            DESCRIPTION: args.problemCodeDescription,
        },
        OBJTYPE: "P",
    }
    // Only attach LOCATIONID when the caller actually has a value. Sending an
    // empty/null block can confuse some EAM tenants ("invalid LOCATIONCODE")
    // - safer to omit the key entirely.
    if (args.locationCode && args.locationCode.length > 0) {
        body.LOCATIONID = {
            LOCATIONCODE: args.locationCode,
            ORGANIZATIONID: orgRef,
            DESCRIPTION: null,
        }
    }
    return body
}

// toWorkRequestResult - merges the EAM response (job number + info message)
// with the original input (to echo back), tagging it with a server-side
// timestamp. Throws if EAM didn't return a JOBNUM - which would mean the
// upstream call succeeded HTTP-wise but the envelope is malformed; we'd
// rather fail loudly than return a result without an identifier.
export function toWorkRequestResult(
    response: EamWorkOrderCreateResponseRaw,
    input: {
        organizationCode: string
        equipmentCode: string
        problemCode: string
        typeCode: string
        description: string
        requestedBy: string
    },
): WorkRequestResult {
    const jobNumber = response.Result?.ResultData?.JOBNUM
    if (!jobNumber) {
        // Surface as a contract error - the envelope shape changed under us.
        // Caller should treat this as upstream/integration failure.
        throw new Error(
            "EAM POST /workorders returned no JOBNUM in Result.ResultData; envelope contract may have changed"
        )
    }
    const upstreamMessage = response.Result?.InfoAlert?.Message ?? undefined
    return {
        jobNumber,
        organizationCode: input.organizationCode,
        equipmentCode: input.equipmentCode,
        problemCode: input.problemCode,
        typeCode: input.typeCode,
        description: input.description,
        status: { code: "Q", description: "Registered" },
        requestedBy: input.requestedBy,
        createdAt: new Date().toISOString(),
        upstreamMessage,
    }
}
