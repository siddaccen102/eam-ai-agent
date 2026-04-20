const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "not-set";

export default function App() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <section className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">EAM AI Agent Workflow</h1>
        <p className="mt-3 text-slate-600">
          Enterprise workflow automation for Workday and HxGN EAM orchestration.
        </p>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Step 1: Validate user email</h2>
          <p className="mt-2 text-sm text-slate-600">
            This is the starter shell for the guided workflow UI.
          </p>
        </div>

        <p className="mt-6 text-xs text-slate-500">
          Backend URL: {backendUrl}
        </p>
      </section>
    </main>
  );
}