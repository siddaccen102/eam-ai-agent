# API Contract Discovery Pack

## Goal

Create an implementation-ready contract for Workday and HxGN EAM integrations so backend services and routes can be built against stable request/response boundaries.

## Why Contract-First

Define integration boundaries before coding adapters and route handlers.

This reduces rework, prevents API assumption bugs, and allows frontend/backend alignment on stable internal DTOs early in development.

## Scope (Locked Minimum Endpoint Set)

This document locks the minimum external endpoint set required for the next backend implementation phase:

- Workday user validation
- EAM terminal to organization mapping
- EAM equipment list
- EAM problem code list
- EAM work request creation

## Integration Workflow Contracts

### 1) User Validation (Workday)

Step name: Validate user identity and eligibility by email.

External API endpoint:

- Method: GET
- URL pattern: {WORKDAY_BASE_URL}/people
- Query: primaryWorkEmail={email}

Auth requirement:

- Bearer token or ISU token via WORKDAY_API_TOKEN
- Header: Authorization: Bearer <token>

Minimum request fields:

- primaryWorkEmail (string, required)

Minimum response fields needed by app:

- personId (string)
- workerId (string, if available)
- displayName (string)
- email (string)
- active (boolean)
- terminalCode (string, if present in worker profile/custom field)

Failure cases:

- 401: Invalid/expired Workday token
- 403: Caller not authorized for people resource
- 404: No worker matched for email
- 5xx: Workday service error
- Timeout: Upstream latency/network timeout

### 2) Terminal to Organization Mapping (EAM)

Step name: Resolve organization context from terminal code.

External API endpoint:

- Method: GET
- URL pattern: {EAM_BASE_URL}/terminal-organizations
- Query: terminalCode={terminalCode}

Auth requirement:

- EAM API token via EAM_API_TOKEN
- Header: Authorization: Bearer <token>

Minimum request fields:

- terminalCode (string, required)

Minimum response fields needed by app:

- organizationCode (string)
- organizationName (string)
- siteCode (string)

Failure cases:

- 401: Invalid/expired EAM token
- 403: Caller not authorized for terminal mapping resource
- 404: Terminal not mapped to organization
- 5xx: EAM service error
- Timeout: Upstream latency/network timeout

### 3) Equipment List (EAM)

Step name: Fetch selectable equipment for resolved organization/site.

External API endpoint:

- Method: GET
- URL pattern: {EAM_BASE_URL}/equipment
- Query: organization={organizationCode}&site={siteCode}&status=ACTIVE

Auth requirement:

- EAM API token via EAM_API_TOKEN
- Header: Authorization: Bearer <token>

Minimum request fields:

- organization (string, required)
- site (string, required)

Minimum response fields needed by app:

- equipmentCode (string)
- equipmentDescription (string)
- equipmentClass (string, optional)
- locationCode (string, optional)

Failure cases:

- 401: Invalid/expired EAM token
- 403: Caller not authorized for equipment resource
- 404: No equipment found for organization/site
- 5xx: EAM service error
- Timeout: Upstream latency/network timeout

### 4) Problem Codes (EAM)

Step name: Fetch problem/failure codes for work request classification.

External API endpoint:

- Method: GET
- URL pattern: {EAM_BASE_URL}/problem-codes
- Query: organization={organizationCode}&entity=WORKREQUEST

Auth requirement:

- EAM API token via EAM_API_TOKEN
- Header: Authorization: Bearer <token>

Minimum request fields:

- organization (string, required)

Minimum response fields needed by app:

- problemCode (string)
- problemDescription (string)
- category (string, optional)

Failure cases:

- 401: Invalid/expired EAM token
- 403: Caller not authorized for problem code resource
- 404: No problem codes configured for organization
- 5xx: EAM service error
- Timeout: Upstream latency/network timeout

### 5) Create Work Request (EAM)

Step name: Create work request in EAM using validated and selected values.

External API endpoint:

- Method: POST
- URL pattern: {EAM_BASE_URL}/work-requests

Auth requirement:

- EAM API token via EAM_API_TOKEN
- Header: Authorization: Bearer <token>

Minimum request fields:

- organizationCode (string, required)
- siteCode (string, required)
- equipmentCode (string, required)
- problemCode (string, required)
- reportedBy (string, required; internal user id/email)
- description (string, required)
- priority (string, optional)

Minimum response fields needed by app:

- workRequestNumber (string)
- status (string)
- createdAt (ISO string)
- organizationCode (string)

Failure cases:

- 401: Invalid/expired EAM token
- 403: Caller not authorized to create work request
- 404: Referenced equipment/problem/organization not found
- 5xx: EAM service error
- Timeout: Upstream latency/network timeout

## Canonical DTOs (Internal, Vendor-Agnostic)

These are backend-exposed models and should remain stable even if vendor payloads change.

```ts
export type ValidatedUser = {
  userId: string;
  email: string;
  displayName: string;
  terminalCode?: string;
  isActive: boolean;
};

export type OrganizationContext = {
  terminalCode: string;
  organizationCode: string;
  organizationName: string;
  siteCode: string;
};

export type EquipmentOption = {
  equipmentCode: string;
  label: string;
  equipmentClass?: string;
  locationCode?: string;
};

export type ProblemCodeOption = {
  problemCode: string;
  label: string;
  category?: string;
};

export type WorkRequestResult = {
  workRequestNumber: string;
  status: string;
  createdAt: string;
  organizationCode: string;
};
```

## Error Contract (Standard for Integration Failures)

All backend integration errors should map to this shape:

```json
{
  "code": "UPSTREAM_AUTH_FAILED",
  "message": "Workday authentication failed",
  "correlationId": "1dd60b3c-9a40-4e33-a8e8-c26ef8fdf4e8",
  "details": {
    "provider": "workday",
    "status": 401
  }
}
```

Field definitions:

- code: Stable machine-readable error code
- message: Human-readable summary safe for API consumers
- correlationId: Request trace id for logs/troubleshooting
- details: Optional structured diagnostics

Recommended code set:

- UPSTREAM_AUTH_FAILED
- UPSTREAM_FORBIDDEN
- RESOURCE_NOT_FOUND
- UPSTREAM_TIMEOUT
- UPSTREAM_SERVICE_ERROR
- CONTRACT_MAPPING_ERROR

## Boundary Notes

- Backend adapters map vendor payloads to Canonical DTOs.
- Frontend never consumes raw Workday/EAM payloads.
- Route handlers should return Error Contract on adapter failures.

## Postman Validation Checklist

1. Confirm each documented endpoint has a corresponding Postman request saved.
2. For each request, verify at least one successful sample response and one failure scenario.
3. Ensure fields documented in Canonical DTOs are derivable from API responses.

## Implementation Notes for Next Phase

- Treat the endpoint set above as locked for v1 implementation.
- If tenant endpoint names differ, keep Canonical DTOs unchanged and update only adapter mapping.
