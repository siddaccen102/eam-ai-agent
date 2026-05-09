import {
    AgentRunInput,
    AgentRunResult,
    AgentRunResolved,
    OrganizationOption,
    ValidatedUser,
} from "../types/canonical"
import { EamCallAuth, getEamUserOrganizations } from "./eamClient"
import { getWorkdayUserByEmail } from "./workdayClient"
import { resolveOrg } from "./orgMatcher"
import { IntegrationError } from "../errors/integrationError"

// runAgent - the single entry point that stitches every integration into one
// typed contract. Stages:
//   1) Workday user lookup -> ValidatedUser           (Mini 6.2 - this scrim)
//   2) EAM user-orgs + AI matcher -> organization     (Mini 6.2 - this scrim)
//   3) Equipment HIL pick                             (Mini 6.3)
//   4) Problem-code HIL pick + work-request create    (Mini 6.4)
//
// Each stage skips itself if its result is already supplied on the input
// (the re-entry pattern documented in canonical.ts).
//
// Why a single function instead of a class:
//   - Stateless. No instance to construct, easier to test, easier to call
//     from a route handler with `await runAgent(...)`.
//   - The discriminated union return type already encodes the state machine;
//     a class would just wrap the same thing in `this.state`.
//
// Why auth threads through here instead of letting each stage fetch its own:
//   - The orchestrator is the trust boundary. Routes hand it the session;
//     it's the orchestrator's job to thread that session through every EAM
//     call. Stages don't know about Express, requests, or middleware.
//
// Error mapping policy:
//   - DOMAIN failures (user not found, no org access, AI no-match) -> map
//     to typed `fail` reasons in AgentRunResult. Frontend renders a friendly
//     message. These are EXPECTED business outcomes.
//   - INFRASTRUCTURE failures (timeout, EAM auth invalid, LLM API down) ->
//     bubble as IntegrationError. The route's existing error mapper turns
//     them into 5xx responses. Frontend retries / shows "service degraded."
//   Mixing both into `fail` would force the frontend to handle "user typo"
//   in the same UI flow as "service degraded" - wrong granularity.
export async function runAgent(
    input: AgentRunInput,
    auth: EamCallAuth,
): Promise<AgentRunResult> {
    const resolved: AgentRunResolved = {}

    // ---- Stage 1a: Workday user lookup ---------------------------------------
    let user: ValidatedUser
    try {
        user = await getWorkdayUserByEmail(input.email)
    } catch (err) {
        if (err instanceof IntegrationError) {
            if (err.code === "RESOURCE_NOT_FOUND") {
                return {
                    kind: "fail",
                    reason: "user_not_found",
                    message: `No Workday user matched ${input.email}`,
                    resolved,
                }
            }
            if (err.code === "USER_INACTIVE") {
                // We don't echo `resolved.user` here even though Workday found
                // the record - it's flagged inactive and we don't want to lead
                // the frontend into using their identity downstream. The error's
                // detail already carries the userId for log correlation.
                return {
                    kind: "fail",
                    reason: "user_inactive",
                    message: `Workday user ${input.email} is inactive`,
                    resolved,
                }
            }
        }
        // Bubble timeout / EAM auth / LLM / other infrastructure errors.
        throw err
    }
    resolved.user = user
    console.log(`[agent] stage=1a outcome=user_resolved email=${user.email} location=${user.location}`)

    // ---- Stage 1b: org resolution --------------------------------------------
    // Always fetch the user-orgs list, even when organizationCode is supplied
    // on re-entry. Two reasons:
    //   (a) trust validation - reject forged codes the user doesn't have
    //       access to BEFORE EAM rejects the work-request POST downstream.
    //   (b) accuracy - the OrganizationOption description isn't carried on
    //       re-entry, so we'd have to lie (code-as-description) without
    //       refetching. The list is small (typically <50 records).
    const orgList = await getEamUserOrganizations(auth)
    if (orgList.records.length === 0) {
        return {
            kind: "fail",
            reason: "no_org_match",
            message: "User has no EAM organization access",
            resolved,
        }
    }

    let organization: OrganizationOption
    if (input.organizationCode) {
        const found = orgList.records.find((o) => o.code === input.organizationCode)
        if (!found) {
            return {
                kind: "fail",
                reason: "no_org_match",
                message: `User does not have access to organization ${input.organizationCode}`,
                resolved,
            }
        }
        organization = found
        console.log(`[agent] stage=1b outcome=preresolved_org code=${organization.code}`)
    } else {
        const orgRes = await resolveOrg(user, orgList.records)
        if (orgRes.kind === "auto") {
            organization = orgRes.organization
            console.log(`[agent] stage=1b outcome=auto_org code=${organization.code} confidence=${orgRes.confidence.toFixed(2)}`)
        } else if (orgRes.kind === "pick") {
            console.log(`[agent] stage=1b outcome=pick_org candidates=${orgRes.candidates.length} top=${orgRes.topConfidence.toFixed(2)}`)
            return {
                kind: "pick_org",
                candidates: orgRes.candidates,
                topConfidence: orgRes.topConfidence,
                resolved,
            }
        } else {
            // OrgResolution.fail collapses to AgentRunResult's no_org_match.
            // The matcher's internal reason ("llm_returned_no_matches",
            // "no_candidates_above_threshold", etc.) is informational; the
            // frontend only needs to know "we couldn't pick an org for you."
            console.log(`[agent] stage=1b outcome=fail reason=${orgRes.reason}`)
            return {
                kind: "fail",
                reason: "no_org_match",
                message: `AI org matcher returned no usable match (${orgRes.reason})`,
                resolved,
            }
        }
    }
    resolved.organization = organization

    // ---- Stages 6.3-6.4 not implemented yet ----------------------------------
    return {
        kind: "fail",
        reason: "not_implemented",
        message: "Stages 6.3-6.4 (equipment, problem code, work-request creation) not implemented yet",
        resolved,
    }
}
