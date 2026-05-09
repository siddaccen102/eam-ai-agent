import { ProblemCodeOption } from "../types/canonical"

// Problem codes - the "what's wrong" classification a user picks when filing a
// work request. In this EAM tenant the code list is a fixed enumeration that
// applies to any organization or equipment class; it's not derived from
// per-org data and EAM does not expose it via a class-scoped REST lookup.
// We mirror docs/Problem Codes.xlsx here so the lookup is deterministic,
// network-free, and ships with the bundle.
//
// Why a function and not a bare exported constant:
//   1) Defensive copy on every read means consumers can't mutate the
//      source-of-truth list (e.g., a route .sort()ing the array in place).
//   2) The signature `() => ProblemCodeOption[]` matches the future
//      EAM-backed shape we'd swap in if Hexagon adds a tenant-aware
//      problem-code endpoint - call sites stay untouched.
//
// Why no class/org filter parameter:
//   The xlsx is a single ungrouped list with no class column. Adding a
//   filter parameter now would be carrying weight for a feature that
//   doesn't exist in the source data. If EAM later returns class-scoped
//   codes, this is when we'd add `getProblemCodesForClass(classCode)`
//   alongside (or replacing) this function.
const PROBLEM_CODES: ReadonlyArray<ProblemCodeOption> = [
    { code: "P01", description: "Visual defect" },
    { code: "P02", description: "Deviant Noise" },
    { code: "P03", description: "Deviant vibrations" },
    { code: "P04", description: "Deviant pressure" },
    { code: "P05", description: "Deviant temperature" },
    { code: "P06", description: "Deviant flow" },
    { code: "P07", description: "Leakage/ Pollution" },
    { code: "P08", description: "Process/ Function not controllable" },
    { code: "P09", description: "Contamination / pass through valve" },
    { code: "P10", description: "Equipment not operable" },
    { code: "P11", description: "Incorrect reading/ measurement instrument" },
    { code: "P12", description: "Automation problem" },
    { code: "P13", description: "Unsafe situation" },
    { code: "P14", description: "Inspection finding" },
    { code: "P20", description: "Other/ None of the above list" },
]

export function getProblemCodes(): ProblemCodeOption[] {
    return PROBLEM_CODES.map((c) => ({ ...c }))
}
