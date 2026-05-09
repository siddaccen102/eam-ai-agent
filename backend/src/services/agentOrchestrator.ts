import { AgentRunInput, AgentRunResult } from "../types/canonical"
import { EamCallAuth } from "./eamClient"

// runAgent - the single entry point that stitches every integration into one
// typed contract. Stages 6.2-6.4 will fill this in:
//   1) Workday user lookup -> ValidatedUser (Mini 6.2)
//   2) EAM user-orgs + AI matcher -> auto-resolved org or pick_org HIL (6.2)
//   3) Equipment + problem code + type matching from free text (6.3)
//   4) Work-request creation (6.4)
//
// Each stage skips itself if its result is already supplied on the input
// (the re-entry pattern documented in canonical.ts). _input and _auth are
// underscored because Mini 6.1 ships only the contract; the body returns
// a typed `not_implemented` placeholder so the route compiles end-to-end
// and the frontend can integrate against the real shape today.
//
// Why a single function instead of a class:
//   - Stateless. No instance to construct, no per-call setup. Easier to test
//     and to call from a route handler with `await runAgent(...)`.
//   - The discriminated union return type already encodes the state machine;
//     a class would just wrap the same thing in `this.state`.
//
// Why _auth here instead of letting each stage fetch its own session:
//   - The orchestrator is the trust boundary. Routes hand it the session;
//     it's the orchestrator's job to thread that session through every EAM
//     call. Stages don't know about Express, requests, or middleware - they
//     just take args and return values.
export async function runAgent(
    _input: AgentRunInput,
    _auth: EamCallAuth,
): Promise<AgentRunResult> {
    return {
        kind: "fail",
        reason: "not_implemented",
        message: "Agent orchestrator stages 6.2-6.4 not implemented yet",
        resolved: {},
    }
}
