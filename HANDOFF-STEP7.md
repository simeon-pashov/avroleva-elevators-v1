# Avroleva Elevators — Handoff after step 7 (billing that runs itself, payments, demo mode)

Date: 2026-09-09. Read `docs/adr/0001-billing-jobs-payments.md` first (the design this step implements), then `ARCHITECTURE.md` §1–§3, `HANDOFF-STEP5.md` (jobs, notifications) and this file. Product name: **Avroleva Elevators** (the elevator product of Avroleva); technical identifiers keep the short name.

Vocabulary rule kept: invoices, payments, reminders, statements, bank details — nothing regulator-facing.

## 1. What exists now

| Area | What |
| --- | --- |
| `modules/billing` (L3) | Owns `invoice`, `invoice_sequence`, `payment`, `credit_note`, `credit_note_sequence`, `invoice_adjustment`, `dunning_stage`, `late_fee_rule`, `bank_import`, `bank_import_row`, `payment_link`. `service.ts` = invoices, `recordPayment` (the one place a payment is written: partial and over-payment, remainder unallocated), credit notes, late-fee adjustments, bulk actions. `run.ts` = scheduled run. `dunning.ts` = stages/rules as data, `runDunning`, preview, `remindNow`, `GET /billing/config`. `reconciliation.ts` = bank CSV preview → match → commit. `statement.ts` = ledger per building + the public page's payment block. `links.ts` = payment links, demo settlement, webhook facade. `domain/` = pure math: `cycle` (monthly / quarterly / yearly, run day), `invoice` (multi-month periods), `dunning` (stage selection, late fee), `states` (state machine as data), `reference` (`AE-<EIK4>-<6 digits>`), `epc` (EPC069-12 payload + SVG), `bankCsv` (3 presets, auto-detect), `match` (reference → amount+name, claims within one statement), `statement` (fold), `documents` (invoice + statement HTML). |
| `platform/ports/PaymentProvider.ts` | `capabilities()`, `createPaymentLink()`, `handleWebhook()`. Adapters in `platform/adapters/payments/`: `none` (default), `demo` (hosted page `/pay/demo/:token`, demoMode tenants only), `iris` and `stripe` (wired stubs: config keys validated, `enabled:false`, TODO in the file). Tenant choice: `settings.billing.paymentProvider`. |
| `http/pay.ts` | `/pay/demo/:token` (GET form, POST records a payment `source=provider, provider=demo`; 404 unless the tenant has `demoMode`), `/webhooks/payments/:provider` (raw body; stubs answer 501). |
| `http/print.ts` | `/print/invoice/:id`, `/print/statement/:buildingId?from&to` (bank block, payer reference, EPC QR, copy buttons through `print.js`). |
| `http/public.ts` | The QR page shows the building's open balance with bank details + EPC QR when `settings.billing.showPaymentOnPublicPage` (default true) and the tenant has an IBAN. |
| `modules/notifications` | Events `DunningStageReached` (the stage row's `templateKey` and `channel` win over the rule matrix: building-contact rules fire only on the stage's channel; in-app stages reach the office only), `PaymentMatched`, `CreditNoteIssued`; templates `dunning_reminder`, `dunning_second`, `dunning_final`, `payment_matched`, `credit_note_issued`, `statement_sent` × email/sms/in_app × bg/en. Default rules: 24 (was 18). |
| `modules/reporting` | `POST /reports/statement/:buildingId/send` — the statement HTML as an attachment through `statement_sent`, logged as `report_run` kind `statement`, period `from..to`. |
| `modules/registry` | `contract.billing` JSONB `{cycle, anchorDay, exempt}` on `ContractDto` and the create/update bodies. |
| `modules/tenancy` | `settings.billing {runDay, runEnabled, dueDays, bank{beneficiary, iban (mod-97 checked), bic, bankName}, paymentProvider, bankCsvMapping, showPaymentOnPublicPage}`, feature `demoMode`, `adminSetFeature`. |
| `demo/` (composition-root level, like `jobs.ts`) | `generator.ts` (`generateDemoData(tenantId, {months, reset?})`: registry sample data when the tenant has no buildings, else only operational data; runs under `events.runQuiet()` and acknowledges the history), `registry.ts`, `visits.ts`, `incidents.ts`, `evidence.ts`, `billing.ts` (12 months replayed week by week: payments land on their day, dunning runs, one committed bank import, two credit notes, unallocated payments), `notifications.ts`, `reset.ts` (`resetDemoTenant`: `purgeOperationalData` + regenerate, demoMode tenants only). `SEED_DEMO` calls the same generator (`prisma/seed/demo.ts` is now tenant + users + settings only). |
| `platform` | `events.runQuiet()` (dispatch suppressed), `purgeOperationalData()` (keeps tenant, users, settings, registry), payment env keys in `config.ts`. |

## 2. Endpoints (all `/api/v1`, owner + office unless noted; technicians 403)

| Method + path | What |
| --- | --- |
| `GET /billing/config` | states, transitions, effective dunning stages (+ `stagesCustomised`), late-fee rules, providers with `enabled`/`note`, `referenceSample` |
| `PUT /billing/dunning-stages` | replace the tenant's list (empty = back to the system default) |
| `PUT /billing/late-fee-rules/:key` | upsert a tenant rule (shadows the system row with the same key) |
| `GET /billing/dunning/preview` | what the next dunning run would do |
| `POST /billing/invoices/generate {period}` | manual "run now for month X" (cycle-aware) |
| `GET /billing/invoices` | + `q` (number / reference / address), `dunningStage`, statuses incl. `partially_paid` |
| `POST /billing/invoices/bulk {action: remind \| pay, ids}` | reminders now (event with `stageKey: manual`) / mark paid |
| `GET /billing/invoices/:id` | `InvoiceDetailDto`: payments, credit notes, adjustments, links, bank, EPC, provider state |
| `POST /billing/invoices/:id/pay` | partial / full / over-payment (`amountCents`, `reference`) |
| `POST /billing/invoices/:id/credit-notes`, `GET …/credit-notes` | numbered credit note (own gapless series) |
| `POST /billing/invoices/:id/payment-link` | hosted-page link through the tenant's provider |
| `GET /billing/bank-imports/presets`, `GET /billing/bank-imports`, `POST /billing/bank-imports/preview`, `GET /billing/bank-imports/:id`, `PUT /billing/bank-imports/:id/rows/:rowId`, `POST /billing/bank-imports/:id/commit` | the import flow; a later manual match on a committed import books the payment immediately |
| `GET /buildings/:id/statement?from&to` | ledger with running balance, open invoices, bank, EPC, `printUrl` |
| `POST /reports/statement/:id/send {from?, to?, email?}` | statement by e-mail |
| `POST /admin/tenants/:id/demo-data {reset?, months?}` (platform admin) | generate; `reset` needs `demoMode` (409 otherwise) |
| `POST /admin/tenants/:id/demo-mode {enabled}` (platform admin) | flip the feature |
| `/print/invoice/:id`, `/print/statement/:buildingId`, `/pay/demo/:token`, `/webhooks/payments/:provider` | outside `/api` |

## 3. Jobs (Europe/Sofia)

| Job | Cron | Idempotency |
| --- | --- | --- |
| `billing.run` | `0 6 * * *` — acts from `settings.billing.runDay` (clamped to the month), contracts with `anchorDay` wait for it | `generate` skips existing (contract, period start); a missed day catches up next tick |
| `billing.dunning` | `30 6 * * *` | invoice stores the stage position; the latest due stage wins after a gap; one late fee per (invoice, stage) |
| `tenancy.demoReset` | `0 4 * * *`, tenants with `demoMode` | purge operational data + regenerate; audit `tenant.demoReset` |

## 4. Settings and data

- `tenant.settings.billing.dueDays` wins; the old `invoiceDueDays` stays as the fallback (`effectiveBilling()`).
- System dunning stages (+3 e-mail reminder, +14 e-mail second reminder, +30 Viber-link final notice with the `late_fee` rule) and the disabled `late_fee` rule (flat 10 EUR, 30 days grace, cap 50 EUR) come from `packages/domain-data/billing/dunning.v1.json` via `ensureSystemBillingDefaults()` in every seed.
- Migration `20260909000000_billing_payments_demo` backfills `paymentReference` before adding its unique index.
- Bank CSV presets: `bg_semicolon_debit_credit`, `en_comma_signed`, `bg_tab_account_block`; the mapping used is saved on the tenant.

## 5. Tests

`npm test`: i18n 12; API unit 114 (`step7.test.ts` 20: cycle math, multi-month invoices, run day, states, dunning schedule, late fee, IBAN/BIC, reference, EPC payload + QR decoded back with jsqr, CSV × 3 fixtures + auto-detect, matcher incl. partial and claims, statement fold); API integration 130 (`step7.test.ts` 21: settings validation, config, scheduled run idempotency and run day, quarterly/exempt, dunning through stages + e-mail/in-app rows + audit, tenant schedule with late fee never editing the invoice, credit notes + stop dunning, partial/over-payment, filters + bulk, import preview → manual match → commit → statement balance + PaymentMatched, later match books immediately, invoice print/EPC, public page block on/off, statement e-mail, demo provider refused without demoMode / demo page records once / 404 afterwards, webhooks 501/404, admin demo data for an empty tenant + no-op rerun + reset guard + nightly reset, generator on a tenant's own registry, isolation and roles for every new endpoint). Earlier suites adapted: over-payment is accepted (step 2), features carry `demoMode`, rule count = `RULE_MATRIX.length`, direct invoice inserts need a reference (step 6).

## 6. Office UI, browser verification and screenshots

| Where | What |
| --- | --- |
| Settings -> Фактуриране (`/settings/billing`) | run day / due days / auto-run, payment provider from `GET /billing/config` (disabled providers carry their note), public-page toggle, bank details (IBAN checked in the browser and on the server), payer-reference sample, dunning-stage editor (add / remove / restore default, "customised" badge), late-fee rule editor, dunning preview. Owner edits, office reads. |
| `/invoices` | status filter rendered from `config.states` (not a hard-coded enum), pending shortcut, month, building, search (number / reference / address), dunning stage >= N, checkboxes + bulk bar (remind, mark paid with a date, CSV of the selection), "generate for month", link to the bank import, cursor paging. |
| `/invoices/:id` | lines and totals (net, VAT, total, late fees, credited, paid, open), payments with source badge and a "demo" badge for provider payments, credit notes, late fees, payment links, pay form (partial / over-payment), credit-note form, "create payment link" when the provider is enabled, print, `PayBlock` (IBAN + copy, BIC, reference + copy, EPC QR). |
| `/billing/bank-import` | file (UTF-8 / Windows-1251) or pasted text, preset or auto-detect, optional column mapping, preview with parse errors and match badges, per-row invoice / building picker, skip / clear, two-step "Осчетоводи", past imports. |
| Building page + `/buildings/:id/statement` | statement card (window, show, print, send by e-mail) and the ledger page with running balance, open invoices and the `PayBlock`. |
| Contracts | billing override (cycle, anchor day, exempt) on the form and the detail page. |
| Shell / tech app / admin | nav "Фактури", "ДЕМО" banner in both apps when `features.demoMode`; admin tenant page: demo-mode toggle, "generate demo data", "reset and regenerate" (demoMode only). |

Browser verification (2026-09-09, dev server, demo tenant re-seeded through the generator: 144 invoices over 12 months, 129 payments, 26 dunned invoices, one committed bank import, 333 visits, 17 callbacks): settings saved (due days 14 -> 15 persisted on `GET /tenant`); "generate for month" issued October's 12 invoices with references `AE-0001-000145..156` and a second run reported 0 created / 12 skipped; the invoice page rendered the EPC QR and the IBAN block with copy buttons (`/print/invoice/:id` too); a pasted five-row bank statement previewed as 4 credits (debit row skipped) matched by reference, by amount + name and by reference for a partial payment, with one row unallocated; the two-step commit booked 3 payments — invoice 144 paid, 142 partially paid (33 of 66 EUR), 143 untouched — and the building's statement closed at 0 with the running balance visible on `/print/statement/:id`; the statement e-mail went to `info@oborishte.example` and appears in `/reports` as a `statement` run; the invoice page created a demo payment link, `/pay/demo/:token` showed the ДЕМО badge and the card form, submitting it recorded a `provider / demo` payment, marked the invoice paid and the link `paid`, and the office page shows the demo badge (the 404 without demoMode is covered by the integration test). The embedded pane cannot accept native `confirm()` dialogs; those flows were driven with a headless Playwright script against the same dev server. Screenshots: `docs/screenshots/billing-settings.png`, `invoice-qr.png`, `bank-import.png`, `statement.png`.

## 7. Known gaps

- IRIS and Stripe are stubs (wiring, config validation, webhook route, `enabled:false`). A real integration is one file each plus a webhook signature test.
- Bank import reads CSV only (no MT940 / camt.053); one mapping per tenant (the last used), presets are invented shapes — the first real bank export should become a fixture.
- Invoice `contractId` is still NOT NULL and `(tenantId, contractId, periodStart)` unique: step 8 needs `contractId` nullable (or a `sourceType/sourceId` unique) for job invoices.
- Late fee is an adjustment row (not a document); if an accountant wants a numbered "дебитно известие", it is a sibling of `credit_note`.
- Demo reset runs `purgeOperationalData` — the only hard delete besides the owner-requested purge; it is guarded by `demoMode` in both callers. Nightly regeneration of photos takes a few seconds per tenant.
- The public page shows arrears to anyone with the QR (setting `showPaymentOnPublicPage`, default true); a firm that dislikes that flips it off.
- `void` is in the state table but has no endpoint yet (a credit note is the correction path).

## 8. What step 8 (repair jobs / quotes) needs from billing

- `createInvoice({ sourceType: 'job', sourceId, buildingId, customerId, lines[], issuedAt?, dueAt? })` — `repo.createInvoice` already takes `sourceType/sourceId`; add a service entry point that takes numbering and the payer reference from `generate()`'s transaction block (extract `issueInvoice(tx, …)`), make `contractId` nullable, and emit `InvoiceIssued`.
- `issueCreditNote(ctx, invoiceId, body)` is the correction path (reason free text; the VAT split follows the invoice).
- A quote accepted by the building becomes a job; the job's "done" transition creates the invoice through the entry point above; payments, dunning, statements, EPC and links then work unchanged.
- ADR 0001 §2 state tables are the contract: do not compute a status anywhere but `statusAfterBalanceChange`; do not write a payment anywhere but `recordPayment`.
