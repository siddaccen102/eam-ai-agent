import { z } from "zod"
import { chatCompleteJson } from "./llmClient"
import {
    ValidatedUser,
    OrganizationOption,
    OrgResolution,
} from "../types/canonical"

// Tunable thresholds. Conservative starting point; revisit after a few real demos
// once we have data on confidence-score distribution.
const HIGH_CONFIDENCE_THRESHOLD = 0.9
const LOW_CONFIDENCE_THRESHOLD = 0.6

// LLM output schema. Capped at 3 candidates so the HIL UI stays scannable
// (cognitive sweet spot for "pick one" interfaces).
//
// reasoning uses .nullable() rather than .optional() because OpenAI strict
// structured-output mode requires every property to be required at the schema
// level - "may be omitted entirely" isn't allowed. .nullable() lets the LLM
// return null when it has nothing useful to say while still satisfying strict.
// We then map null -> undefined when bridging into the canonical OrgResolution
// type (which uses TypeScript's optional convention).
const MatchSchema = z.object({
    matches: z
        .array(
            z.object({
                code: z.string(),
                confidence: z.number().min(0).max(1),
                reasoning: z.string().nullable(),
            })
        )
        .max(3),
})

export async function resolveOrg(
    user: ValidatedUser,
    orgs: OrganizationOption[]
): Promise<OrgResolution> {
    // Defense: empty input shouldn't even hit the LLM.
    if (orgs.length === 0) {
        return { kind: "fail", reason: "no_candidates_available" }
    }

    const orgListText = orgs.map((o) => `- ${o.code} | ${o.description}`).join("\n")

    const result = await chatCompleteJson(
        [
            {
                role: "system",
                content:
                    "You match a Workday user's company and location to an EAM organization. " +
                    "EAM organization descriptions may use different word order, language (English/Portuguese/etc.), " +
                    "or punctuation than the Workday inputs. Return up to 3 candidate matches scored 0..1 by likelihood. " +
                    "Higher confidence = more certain match. Reasoning is optional but helpful for low-confidence picks. " +
                    "If nothing matches well, return an empty matches array.",
            },
            {
                role: "user",
                content:
                    `Workday user:\n- company: ${user.company}\n- location: ${user.location}\n\n` +
                    `EAM organizations (code | description):\n${orgListText}\n\n` +
                    `Score the top candidates for this user's terminal/site.`,
            },
        ],
        MatchSchema,
        "OrgMatch"
    )

    if (result.matches.length === 0) {
        return { kind: "fail", reason: "llm_returned_no_matches" }
    }

    // Sort once - reused by both the auto and HIL branches below.
    const sorted = [...result.matches].sort((a, b) => b.confidence - a.confidence)

    // Bonus: log the full ranked candidates with reasoning so AI decisions are
    // observable in dev. When confidence is borderline, the reasoning tells you why.
    console.log(`[matcher] ${user.email} candidates:`)
    for (const m of sorted) {
        console.log(`  ${m.code.padEnd(8)} conf=${m.confidence.toFixed(2)}  ${m.reasoning ?? ""}`)
    }

    const top = sorted[0]

    // Defense: LLM might invent a code that doesn't exist in our actual org list.
    const topOrg = orgs.find((o) => o.code === top.code)
    if (!topOrg) {
        return { kind: "fail", reason: "llm_returned_unknown_org_code" }
    }

    // Auto-pick: high confidence, no UX friction needed.
    if (top.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
        return {
            kind: "auto",
            organization: topOrg,
            confidence: top.confidence,
            reasoning: top.reasoning ?? undefined,
        }
    }

    // HIL: middle confidence, surface candidates and let the user pick.
    if (top.confidence >= LOW_CONFIDENCE_THRESHOLD) {
        const candidates = sorted
            .map((m) => orgs.find((o) => o.code === m.code))
            .filter((o): o is OrganizationOption => Boolean(o))
        return {
            kind: "pick",
            candidates,
            topConfidence: top.confidence,
            reason: "low_confidence",
        }
    }

    // Tail: low confidence is no better than guessing - reject explicitly.
    return {
        kind: "fail",
        reason: "no_candidates_above_threshold",
        topConfidence: top.confidence,
    }
}
