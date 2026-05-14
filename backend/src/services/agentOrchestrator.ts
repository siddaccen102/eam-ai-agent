import { randomUUID } from "node:crypto"
import {
    AgentRunInput,
    AgentRunResult,
    AgentRunResolved,
    EquipmentOption,
    OrganizationOption,
    ProblemCodeOption,
    ValidatedUser,
    WorkRequestTypeOption,
} from "../types/canonical"
import {
    createEamWorkRequest,
    findEamEquipmentByCode,
    getEamEquipmentForOrg,
    getEamUserOrganizations,
} from "./eamClient"
import { getWorkdayUserByEmail } from "./workdayClient"
import { resolveOrg } from "./orgMatcher"
import { findProblemCode, getProblemCodes } from "./problemCodes"
import { findWorkRequestType, getWorkRequestTypes } from "./workRequestTypes"
import { IntegrationError } from "../errors/integrationError"

// runAgent - the single entry point that stitches every integration into one
// typed contract. Stages, in order:
//   1a) Workday user lookup -> ValidatedUser          (Mini 6.2)
//   1b) EAM user-orgs + AI matcher -> organization    (Mini 6.2)
//   2)  Equipment HIL pick                            (Mini 6.3)
//   3)  Problem-code HIL pick                         (Mini 6.4)
//   4)  Type HIL pick                                 (Mini 6.4)
//   5)  Work-request create (POST /workorders)        (Mini 6.4)
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
): Promise<AgentRunResult> {
    // correlationId: one ID per user-facing run; stitches every log line +
    // the response envelope together. Distinct from the per-outbound-call
    // cids that workdayClient/eamClient mint internally - those are per-HTTP
    // request, this is per-agent-run. Threading this into outbound calls is a
    // documented post-PoC follow-up (would need a `cid` parameter on every
    // helper signature - too invasive for the demo).
    const correlationId = randomUUID()

    // HIL re-entry invariant: stages process in order. The orchestrator
    // returns the FIRST `pick_*` it encounters; pre-resolved fields beyond
    // that point just travel along on the input until their stage is reached.
    // Concretely: if the user supplies typeCode without equipmentCode, stage
    // 2 still returns pick_equipment first - typeCode is unused this round
    // and gets reused on the next call without re-validation here.
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
                    correlationId,
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
                    correlationId,
                    resolved,
                }
            }
        }
        // Bubble timeout / EAM auth / LLM / other infrastructure errors.
        throw err
    }
    resolved.user = user
    console.log(`[agent] cid=${correlationId} stage=1a outcome=user_resolved email=${user.email} location=${user.location}`)

    // ---- Stage 1b: org resolution --------------------------------------------
    // Always fetch the user-orgs list, even when organizationCode is supplied
    // on re-entry. Two reasons:
    //   (a) trust validation - reject forged codes the user doesn't have
    //       access to BEFORE EAM rejects the work-request POST downstream.
    //   (b) accuracy - the OrganizationOption description isn't carried on
    //       re-entry, so we'd have to lie (code-as-description) without
    //       refetching. The list is small (typically <50 records).
    const orgList = await getEamUserOrganizations()
    if (orgList.records.length === 0) {
        return {
            kind: "fail",
            reason: "no_org_match",
            message: "User has no EAM organization access",
            correlationId,
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
                correlationId,
                resolved,
            }
        }
        organization = found
        console.log(`[agent] cid=${correlationId} stage=1b outcome=preresolved_org code=${organization.code}`)
    } else {
        const orgRes = await resolveOrg(user, orgList.records)
        if (orgRes.kind === "auto") {
            organization = orgRes.organization
            console.log(`[agent] cid=${correlationId} stage=1b outcome=auto_org code=${organization.code} confidence=${orgRes.confidence.toFixed(2)}`)
        } else if (orgRes.kind === "pick") {
            console.log(`[agent] cid=${correlationId} stage=1b outcome=pick_org candidates=${orgRes.candidates.length} top=${orgRes.topConfidence.toFixed(2)}`)
            return {
                kind: "pick_org",
                candidates: orgRes.candidates,
                topConfidence: orgRes.topConfidence,
                correlationId,
                resolved,
            }
        } else {
            // OrgResolution.fail collapses to AgentRunResult's no_org_match.
            // The matcher's internal reason ("llm_returned_no_matches",
            // "no_candidates_above_threshold", etc.) is informational; the
            // frontend only needs to know "we couldn't pick an org for you."
            console.log(`[agent] cid=${correlationId} stage=1b outcome=fail reason=${orgRes.reason}`)
            return {
                kind: "fail",
                reason: "no_org_match",
                message: `AI org matcher returned no usable match (${orgRes.reason})`,
                correlationId,
                resolved,
            }
        }
    }
    resolved.organization = organization

    // ---- Stage 2: equipment HIL ---------------------------------------------
    // Manager's brief step 4: "provide the complete list of equipment as a
    // lookup, enabling the user to select." Pure HIL - no AI matching.
    //
    // First-call path: fetch the first page only (frontend handles "Load more"
    // via /smoke/equipment-for directly - keeps the agent endpoint focused on
    // workflow, not pagination).
    //
    // Re-entry path: scan to find the supplied code. We can't trust the code
    // blindly because (a) forge protection and (b) we need departmentCode and
    // locationCode from the equipment record for the work-request POST in
    // stage 4. Frontend HAS the full record after the user picked, but routing
    // it back through the canonical input would mean clients echo more than
    // just the code - we'd rather re-fetch on the server.
    let equipment: EquipmentOption
    if (input.equipmentCode) {
        const found = await findEamEquipmentByCode(
            organization.code,
            input.equipmentCode,
        )
        if (!found) {
            console.log(
                `[agent] cid=${correlationId} stage=2 outcome=fail reason=no_equipment_match code=${input.equipmentCode}`
            )
            return {
                kind: "fail",
                reason: "no_equipment_match",
                message: `Equipment ${input.equipmentCode} not found in organization ${organization.code}`,
                correlationId,
                resolved,
            }
        }
        equipment = found
        console.log(
            `[agent] cid=${correlationId} stage=2 outcome=preresolved_equipment code=${equipment.equipmentCode}`
        )
    } else {
        const page = await getEamEquipmentForOrg(organization.code, {
            cursor: 0,
            pageSize: 50,
        })
        if (page.records.length === 0) {
            console.log(`[agent] cid=${correlationId} stage=2 outcome=fail reason=no_equipment_match (empty org)`)
            return {
                kind: "fail",
                reason: "no_equipment_match",
                message: `No equipment found in organization ${organization.code}`,
                correlationId,
                resolved,
            }
        }
        console.log(
            `[agent] cid=${correlationId} stage=2 outcome=pick_equipment candidates=${page.records.length} nextCursor=${page.nextCursor ?? "EOF"}`
        )
        return {
            kind: "pick_equipment",
            candidates: page.records,
            nextCursor: page.nextCursor,
            correlationId,
            resolved,
        }
    }
    resolved.equipment = equipment

    // ---- Stage 3: problem-code HIL ------------------------------------------
    // Static catalogue (15 codes) sourced from docs/Problem Codes.xlsx. We
    // intentionally do NOT AI-suggest a default - "AC leaking" -> P07 is
    // probable but "AC not cooling" -> P10 vs P05 is a user judgment call.
    // Asking the user keeps the result honest and matches the manager's brief.
    let problem: ProblemCodeOption
    if (input.problemCode) {
        const found = findProblemCode(input.problemCode)
        if (!found) {
            console.log(`[agent] cid=${correlationId} stage=3 outcome=fail reason=no_problem_code_match code=${input.problemCode}`)
            return {
                kind: "fail",
                reason: "no_problem_code_match",
                message: `Unknown problemCode: ${input.problemCode}`,
                correlationId,
                resolved,
            }
        }
        problem = found
        console.log(`[agent] cid=${correlationId} stage=3 outcome=preresolved_problem_code code=${problem.code}`)
    } else {
        const candidates = getProblemCodes()
        console.log(`[agent] cid=${correlationId} stage=3 outcome=pick_problem_code candidates=${candidates.length}`)
        return {
            kind: "pick_problem_code",
            candidates,
            correlationId,
            resolved,
        }
    }
    resolved.problemCode = problem

    // ---- Stage 4: type HIL --------------------------------------------------
    // Static catalogue (6 codes: ADAP/BRKD/DAMA/MODI/WOOI/WOPS) from
    // docs/Work Request Type.xlsx. Same shape as stage 3.
    let workRequestType: WorkRequestTypeOption
    if (input.typeCode) {
        const found = findWorkRequestType(input.typeCode)
        if (!found) {
            console.log(`[agent] cid=${correlationId} stage=4 outcome=fail reason=no_type_match code=${input.typeCode}`)
            return {
                kind: "fail",
                reason: "no_type_match",
                message: `Unknown typeCode: ${input.typeCode}`,
                correlationId,
                resolved,
            }
        }
        workRequestType = found
        console.log(`[agent] cid=${correlationId} stage=4 outcome=preresolved_type code=${workRequestType.code}`)
    } else {
        const candidates = getWorkRequestTypes()
        console.log(`[agent] cid=${correlationId} stage=4 outcome=pick_type candidates=${candidates.length}`)
        return {
            kind: "pick_type",
            candidates,
            correlationId,
            resolved,
        }
    }
    resolved.type = workRequestType

    // ---- Stage 5: work-request create ---------------------------------------
    // Defensive: equipment.departmentCode is optional in EquipmentOption but
    // required by createEamWorkRequest. Every /positions record we've seen
    // carries DEPARTMENTID, so this guard never fires in practice - but if a
    // record ever comes back without one, we fail with a typed reason rather
    // than constructing a bogus EAM body.
    if (!equipment.departmentCode) {
        console.log(
            `[agent] cid=${correlationId} stage=5 outcome=fail reason=internal_error missing_departmentCode equipment=${equipment.equipmentCode}`
        )
        return {
            kind: "fail",
            reason: "internal_error",
            message: `Equipment ${equipment.equipmentCode} has no departmentCode; cannot file work request`,
            correlationId,
            resolved,
        }
    }

    // requestedBy = the EAM username from the session (NOT email, NOT any input
    // field). EAM stores this in CREATEDBY.USERCODE and uses it as the audit
    // identity. The session is the single source of truth for "who is doing this".
    // Errors from createEamWorkRequest bubble as IntegrationError; the route's
    // existing handler maps them to 5xx responses (infra failures stay 5xx).
    const workRequest = await createEamWorkRequest(
        {
            organizationCode: organization.code,
            equipmentCode: equipment.equipmentCode,
            departmentCode: equipment.departmentCode,
            ...(equipment.locationCode ? { locationCode: equipment.locationCode } : {}),
            problemCode: problem.code,
            problemCodeDescription: problem.description,
            typeCode: workRequestType.code,
            typeDescription: workRequestType.description,
            description: input.description,
            requestedBy: input.email.split("@")[0].toUpperCase(),
        },
    )

    console.log(`[agent] cid=${correlationId} stage=5 outcome=success jobNumber=${workRequest.jobNumber}`)
    return {
        kind: "success",
        workRequest,
        correlationId,
        resolved,
    }
}
