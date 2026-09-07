# Avroleva — Elevator Business Site Code

B2B SaaS for Bulgarian elevator-maintenance firms (асансьорни сервизи): a business-operations and customer-evidence layer on top of the paper logbook (дневник), shaped like the firm's working rhythm — 30-day functional checks, two technicians, the emergency response timer, the 17-item stop-defect catalogue, inspection dates, the long-term dossier. Regulator-facing outputs are deliberately out of the MVP (see `MVP-PLAN.md` backlog).

This folder holds the design documents **and the application code** (npm-workspaces monorepo: `apps/api`, `apps/office`, `packages/contracts`, `packages/i18n`). Step 1 (foundation: platform, tenancy, registry, office UI) is built — see [`HANDOFF-STEP1.md`](./HANDOFF-STEP1.md) for how to run it, what exists and what step 2 adds. The GitHub repo name is still to be confirmed with the founder (see `D:CodeGITHUB-GUIDE.md`).

| Document | What it is |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Modular monolith design: modules and boundaries, adjustability mechanisms, data model, offline-first technician PWA, API, cross-cutting concerns (PDF, jobs, storage, backups, GDPR, security, observability), deployment on the shared Hostinger VPS, testing strategy, decisions log. |
| [`MVP-PLAN.md`](./MVP-PLAN.md) | Build plan: phases 0–9 with scope, acceptance criteria and day estimates; the 2-week demo; the founding-customer data import plan; risks and their containment; definition of done for "first customer live". |
| [`../Elevator Business Due Diligence/`](../Elevator%20Business%20Due%20Diligence/) | The research this design rests on. Start with `00-SYNTHESIS.md`; `01-LAW-AND-REGULATION.md` §10 is the legal checklist, §3.12 the functional-check appendix; `03-…-OPERATES.md` has the data-model hints and ranked pain points; `04-…-BENCHMARK.md` the MVP scope and deferrals. |
| [`../Elevator Businesses Data/`](../Elevator%20Businesses%20Data/) | ДАМТН register of licensed firms (509 active certificates) — the lead list and the source of the regional-office seed. |

Conventions that apply to all code in this project: `D:\Code\VPS-GUIDE.md` (Docker, path-based nginx, port and backup conventions) and `D:\Code\GITHUB-GUIDE.md` (repo-local identity, deploy keys).
