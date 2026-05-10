import { apiCall } from "./client"
import { EquipmentOption } from "../types/canonical"

// Subset of the /smoke/equipment-for response envelope. The backend returns
// more fields (status, provider, orgCode, cursor, pageSize, scanned, matched,
// hasMore, exhausted, activeOnly) but the frontend only consumes records +
// nextCursor for pagination. Typing the smaller shape is fine - extra JSON
// fields at runtime don't break TypeScript.
type EquipmentPageEnvelope = {
    records: EquipmentOption[]
    nextCursor: number | null
}

// fetchEquipmentPage - "Load more" cursor advance for the equipment HIL.
//
// Why a separate endpoint instead of re-running /agent/run with a cursor:
//   The agent endpoint orchestrates a workflow. Pagination is a primitive.
//   Reusing /agent/run would re-do Workday lookup + AI matcher + first-page
//   fetch on every cursor advance, just to throw away the result. The smoke
//   endpoint hits EAM /positions once per advance.
//
// nextCursor === null in the response = EAM exhausted; the caller should
// hide the "Load more" button.
export async function fetchEquipmentPage(
    orgCode: string,
    cursor: number,
    sessionId: string,
): Promise<EquipmentPageEnvelope> {
    const params = new URLSearchParams({
        orgCode,
        cursor: String(cursor),
    })
    return await apiCall<EquipmentPageEnvelope>(
        `/integrations/eam/smoke/equipment-for?${params.toString()}`,
        { sessionId },
    )
}
