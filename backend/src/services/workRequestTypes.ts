import { WorkRequestTypeOption } from "../types/canonical"

// Work-request type catalogue - the CAPEX/OPEX category EAM stores on every
// work order. Mirrored from docs/Work Request Type.xlsx because, like problem
// codes, the values are tenant-fixed and not exposed via a REST lookup we
// can call on demand.
//
// Why both lookups (this and problemCodes) follow the same shape:
//   The work-request body needs CODE + DESCRIPTION for both fields (TYPE.TYPECODE
//   /TYPE.DESCRIPTION, PROBLEMCODEID.PROBLEMCODE/PROBLEMCODEID.DESCRIPTION). EAM
//   does not derive description from code on its side, so the client has to
//   supply both. A reverse-lookup-by-code (`findWorkRequestType`) is the
//   minimum API the route needs to enrich the canonical input before
//   building the EAM body.
//
// Why no separate "active vs inactive" flag:
//   The xlsx is a flat list. If Vopak deprecates a type later, we update the
//   xlsx + this file. Carrying an `isActive` field would be premature.
const WORK_REQUEST_TYPES: ReadonlyArray<WorkRequestTypeOption> = [
    { code: "ADAP", description: "Projects / Ad. Main. (CAPEX)" },
    { code: "BRKD", description: "Corrective Maintenance (OPEX)" },
    { code: "DAMA", description: "Damage (OPEX)" },
    { code: "MODI", description: "Modifications (OPEX)" },
    { code: "WOOI", description: "Work Out of Inspection (OPEX)" },
    { code: "WOPS", description: "Workorder for Operations (OPEX)" },
]

export function getWorkRequestTypes(): WorkRequestTypeOption[] {
    return WORK_REQUEST_TYPES.map((t) => ({ ...t }))
}

// Lookup-by-code; mirrors findProblemCode. Returns undefined when no match
// (route layer maps that to 400 VALIDATION_ERROR).
export function findWorkRequestType(code: string): WorkRequestTypeOption | undefined {
    return WORK_REQUEST_TYPES.find((t) => t.code === code)
}
