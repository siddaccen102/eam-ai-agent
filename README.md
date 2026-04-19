# EAM AI Agent 🤖

An **agentic AI-powered workflow automation system** designed to streamline the creation of work requests in HxGN EAM by orchestrating enterprise APIs like Workday and EAM.

---

## 🚀 Overview

This project is a **full-stack AI-assisted application** that automates the manual process of logging breakdown and corrective maintenance work requests.

It integrates:

- **Workday API** for user validation and employee data
- **HxGN EAM APIs** for organization, equipment, problem codes, and work request creation
- **AI Layer** to guide users through the workflow

---

## 🧠 Key Features

- Validate users via Workday (myPulse)
- Fetch terminal and map it to organization (EAM)
- Dynamic equipment selection
- Problem code lookup
- Create work requests via API
- AI-assisted step-by-step workflow (agentic behavior)

---

## 🏗️ Architecture

```text
Frontend (React)
   ↓
Backend (Node.js / Express)
   ↓
Workday API + HxGN EAM APIs
   ↓
AI Layer (OpenAI)
```

---

## ⚙️ Tech Stack

### Frontend

- React (Vite)
- TypeScript
- Tailwind CSS

### Backend

- Node.js
- Express (TypeScript)

### API Layer

- Axios

### Validation

- Zod

### AI Integration

- OpenAI API

### Tools

- Postman (API testing)

---

## 🔄 Workflow

1. User enters email
2. Validate via Workday API
3. Fetch terminal details
4. Map terminal to organization (EAM)
5. Fetch equipment list
6. Fetch problem codes
7. User selects equipment and issue
8. Create work request via EAM API
9. AI guides user through steps

---

## 📁 Project Structure

```text
eam-ai-agent/
├── backend/
│   ├── src/
│   │   ├── routes/              # API endpoints
│   │   ├── services/            # Business logic (Workday, EAM, AI)
│   │   ├── config/              # Environment & constants
│   │   ├── types/               # TypeScript interfaces
│   │   └── index.ts             # Express app bootstrap
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── README.md
├── frontend/
│   ├── src/
│   │   ├── components/          # React components
│   │   ├── pages/               # Page-level layouts
│   │   ├── services/            # API client (Axios wrapper)
│   │   ├── types/               # TypeScript interfaces
│   │   ├── App.tsx              # Main app component
│   │   └── main.tsx             # Vite entry
│   ├── public/                  # Static assets
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── .env.example
├── docs/
│   ├── ARCHITECTURE.md          # This file
│   ├── integration-contracts.md # API endpoint reference
│   └── test-playbook.md         # Postman testing guide
├── .gitignore
└── README.md
```

---

## 🔐 Environment Variables

Create a `.env` file in `backend`:

```env
PORT=5000
WORKDAY_BASE_URL=your_workday_url
WORKDAY_API_TOKEN=your_token

EAM_BASE_URL=your_eam_url
EAM_API_TOKEN=your_token

OPENAI_API_KEY=your_openai_key
```

---

## 🧪 Running Locally

### Backend

```bash
cd backend
npm install
npx ts-node-dev src/index.ts
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## 🧰 API Testing

Use Postman to test:

```http
GET /api/validate-user?email=test@example.com
```

---

## 📚 API Documentation References

### Workday API (Person v4)

- Doc URL: https://community.workday.com/sites/default/files/file-hosting/restapi/#person/v4/get-/people/-ID-
- Primary endpoint used for user validation context: `GET /people/{ID}`
- Path parameter options: `ID` (worker/person ID) or `me`
- Notes from documentation:
  - The endpoint retrieves person data for a specific user.
  - It can use IDs discovered from `GET /people` or `GET /workers`.
  - It is documented under Workday REST `person` API v4 and secured as a REST API resource.

### HxGN EAM APIs (Swagger)

- Doc URL: https://eu1.eam.hxgnsmartcloud.com/web/swagger/index.html#
- Swagger portal title: **HxGN EAM - Web Services**
- The API catalog is organized by business domains (for example: Work, Materials, Equipment), which aligns with this project's workflow needs.
- Relevant resource families for this project include work/order-related resources, equipment resources, and supporting master data resources.

### How This Project Uses These Docs

- Workday docs define the identity and person-data lookup behavior used in the user validation step.
- HxGN Swagger is the source of truth for discovering tenant-available endpoints used for:
  - organization mapping
  - equipment retrieval
  - problem/failure code retrieval
  - work request/work order creation

> Note: Exact authentication headers and available endpoints can vary by tenant configuration and permissions. Confirm final request shapes and auth setup against your own Workday and HxGN EAM environments.

---

## 🎯 Goals

- Build a real-world enterprise workflow automation system
- Demonstrate API orchestration across systems
- Integrate AI into business processes
- Showcase full-stack and AI engineering skills

---

## 🚧 Future Enhancements

- Chat-based AI interface
- Workflow memory and context
- Logging and monitoring
- Role-based access control
- Deployment (Vercel + Render)

---

## 👨‍💻 Author

Mohd Rashid

---

## ⭐ Notes

This project is part of an internal POC within Accenture, focused on building AI-powered enterprise automation solutions.
