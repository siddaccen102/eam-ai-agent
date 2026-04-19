# Architecture & Module Responsibilities

## Frontend (`/frontend`)
- React + Vite + TypeScript + Tailwind CSS
- Responsible for: Input collection, state visualization, step progression UX
- **Authority boundary**: Does NOT fetch raw data or make business decisions
- **Consumes**: Backend orchestration endpoints only

## Backend (`/backend`)
- Node.js + Express + TypeScript
- **Single source of truth for**: All business logic, API orchestration, state management
- **Owns**: Workday validation, EAM lookups, work request creation, AI guidance
- **Provides**: REST endpoints that drive the complete workflow

## Communication
- Backend exposes REST APIs (documented in `/docs/api-contracts.md`)
- Frontend calls backend via typed Axios client
- No direct frontend-to-Workday/EAM calls

## Naming Conventions
- TypeScript files: `CamelCase.ts` (components), `camelCase.ts` (utilities/services)
- React components: `ComponentName.tsx`
- API routes: kebab-case in URL paths (`/validate-user`)
- Environment variables: `SCREAMING_SNAKE_CASE`