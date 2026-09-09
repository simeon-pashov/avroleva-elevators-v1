# Avroleva Elevators — Architecture

Date: 2026-09-07. Companion to `MVP-PLAN.md`. Domain facts come from `../Elevator Business Due Diligence/` (01 = law, 03 = operations, 04 = product benchmark); when this file and a report disagree on a legal fact, the report wins.

Design goal in one line: **the first customer will teach us how they really work, so every piece that encodes an assumption about "how they work" must be replaceable without touching the rest.**

---

## 1. Architecture style: modular monolith

**Decision: one deployable (one Docker image, one Postgres), strict module boundaries enforced by tooling, in-process domain events persisted to a transactional outbox.** Microservices are rejected: one developer, one VPS, one tenant at launch — network boundaries buy nothing and add the failure modes (partial deploys, distributed transactions between "visit" and "job") a one-person team cannot afford. A plain monolith without enforced boundaries is also rejected: it is where "change one thing, break three" comes from, and it is what Claude Code drifts toward unless a lint rule stops it.

### 1.1 Layers and modules

```
L0 platform   config · db (Prisma) · event-bus + outbox · jobs (pg-boss) · ports/adapters ·
              i18n · pdf · storage · audit · clock
L1 tenancy    firms, users, roles, sessions, device enrollment, feature flags, tenant settings
L2 registry   customers (ползватели), contacts, buildings, elevators, contracts, reference data
   documents  attachments (photos/files), generated documents, dossier (досие), retention
L3 maintenance  30-day cycle engine, checklist templates, jobs, technician-pair assignment
   visits       the visit record (посещение) = the evidence
   callbacks    авария flow, response-time timer, close-out, chargeable
   defects      17-item catalogue (чл. 10), free-text defects, stop-lift, notice to the building, follow-up reminder
   calendar     inspections (технически прегледи), deadlines (срокове), alarm-device tests, hydraulic protocols
   billing      EUR invoices with ДДС, payments, arrears, external invoicing push
   pricing      plans, subscription state, usage snapshots
L4 notifications  templates, rules, channel adapters, delivery log (consumes events)
   reporting      dashboard, monthly building PDF, CSV/XLSX exports (read-only)
   facades        http/sync (offline API), http/public (QR page + fault report), http/admin
```

**Dependency rules** (enforced by `dependency-cruiser` + a table-ownership script in CI, see §8):

1. A module imports from **lower layers only**, and only through `modules/<name>/index.ts` (its public interface). Never from another module's `repo/`, `domain/` internals or Prisma models.
2. Same-layer modules never import each other. L3 modules that need each other's *facts* consume **events** (async) or call the other's public interface through a **port defined by the caller** (sync, same transaction) — e.g. `visits` needs `defects.recordDefect`; it declares `interface DefectRecorder` and `main.ts` wires the real implementation. Rewriting `defects` cannot break `visits` as long as the port holds.
3. Each table has exactly one owning module (map in `apps/api/src/platform/db/ownership.ts`); only the owner may read/write it. Exemptions: `reporting` may SELECT any table; `audit`/`domain_event` are written via platform helpers.
4. Foreign keys are allowed only to **identity tables** (`tenant`, `user`, `building`, `elevator`, `attachment`). Between L3 modules, references are `(sourceType, sourceId)` pairs — no FK — so a module's schema can be migrated or replaced without cascading DDL.
5. Primary writes go through direct interface calls in one transaction; **side effects go through events**. A command must never depend on a subscriber having run.

**Replacing a module** = keep its `index.ts` contract (commands, queries, events in `packages/contracts/events`), migrate only the tables it owns, re-run its integration tests plus the contract tests other modules hold against its port. Example: `callbacks` is rewritten to be driven by the GSM alarm-device telephony log — its code and tables change; `notifications`, `reporting`, `visits` do not, because they only know `CallbackOpened/Dispatched/Closed` events and elevator ids.

### 1.2 Module contract table

| Module | Owned tables | Public commands / queries | Emits | Consumes |
|---|---|---|---|---|
| tenancy | tenant, user, session, device_enrollment_token, platform_admin | createTenant, createUser, login, enrollDevice, revokeSession, updateSettings, setFeature, deleteTenantData (owner-initiated, 30-day grace, audit entry) · me, users | TenantCreated, UserCreated, UserDeactivated, TenantDeletionScheduled | SubscriptionSuspended (→ read-only mode) |
| registry | customer, contact, building, elevator, contract, contract_elevator, import_batch, inspection_body* | upsert each, importCsv(preview/commit/rollback), geocode, startContract, terminateContract, setElevatorStatus · list/get, mapPins, publicCard | ElevatorRegistered/Updated/StatusChanged, ContractStarted/Terminated, ContactChanged | — |
| documents | attachment, document, document_template*, idempotency_key | uploadAttachment, createDocument, render(templateKey, data), signedUrl, dossier(elevatorId) | DocumentCreated | retention sweep (job) |
| maintenance | maintenance_job, checklist_template, route | generateJobs, assignJob, reschedule, closeJob · dueBoard, myJobs, template(version) | JobDue, JobOverdue, JobAssigned, JobCompleted | ElevatorRegistered/StatusChanged, ContractTerminated, VisitRecorded |
| visits | visit, visit_technician, visit_attachment | recordVisit (idempotent), amendVisit, attachPhoto, renderLogbookPage · history, detail | VisitRecorded, VisitAmended | — (calls DefectRecorder port) |
| callbacks | callback, callback_event | open (office/public/device), dispatch, onSite, released, restored, close, setChargeable · open list, SLA view | CallbackOpened/Dispatched/OnSite/Closed, CallbackSlaAtRisk/Breached (job) | — (calls DefectRecorder, VisitRecorder ports) |
| defects | defect, defect_catalog* | recordDefect, issueUserNotice, markUserRequested, resolve · open by elevator, follow-up list (open > N days without the building's go-ahead) | DefectRecorded, StopLiftRequired, DefectResolved | — |
| calendar | inspection, inspection_defect, calendar_item, alarm_device_test, hydraulic_protocol | recordInspection, requestInspection, logAlarmTest, logHydraulicProtocol, recompute · calendar, upcoming(n days) | InspectionDueSoon(90/60/30/7), InspectionOverdue, DefectFollowUpDue, InspectionRecorded | ContractStarted/Terminated, ElevatorRegistered, DefectRecorded/Resolved |
| billing | invoice, invoice_sequence, payment, credit_note, credit_note_sequence, invoice_adjustment, dunning_stage, late_fee_rule, bank_import, bank_import_row, payment_link | generate / runScheduled, recordPayment, issueCreditNote, runDunning, bank import (preview / match / commit), statement, payment links · config (states + stages as data), arrears — see `docs/adr/0001-billing-jobs-payments.md` | InvoiceIssued, InvoiceOverdue, DunningStageReached, PaymentRecorded, PaymentMatched, CreditNoteIssued | ContractStarted/Terminated |
| pricing | pricing_plan*, subscription, usage_snapshot | computeCharge(plan, usage), startTrial, activate, suspend, snapshot · state(tenant) | TrialEnding, SubscriptionSuspended | ElevatorRegistered/StatusChanged |
| notifications | notification, notification_template, notification_rule | send, preview, upsertTemplate/rule · log | NotificationSent/Failed | almost everything (rule table decides) |
| reporting | report_run, export_job | dashboard, monthlyBuildingReport, exportDataset, fullTenantExport | — | — |

`*` = system reference data (tenantId NULL rows) that a tenant may override with its own rows.

---

## 2. Adjustability mechanisms

Each mechanism is named with the change it protects against, using changes we consider likely after the first customer.

| # | Mechanism | Where | Protects against |
|---|---|---|---|
| A1 | **Ports & adapters** for every external thing: `SmsSender`, `EmailSender`, `ViberSender`, `InvoicingProvider`, `PdfRenderer`, `FileStorage`, `Geocoder`, `MapTiles`, `Clock`. One interface each in `platform/ports/`, adapters in `platform/adapters/<port>/<vendor>.ts`, chosen by env (`SMS_PROVIDER=console`, `twilio` or `smsapi`); every port has a `console`/`memory` adapter for tests and demos. | platform | "Viber is replaced by WhatsApp" → new `WhatsAppSender` adapter, rule table points at it; "inv.bg instead of our PDFs" → `InvoicingProvider=invbg`; "disk full" → `FileStorage=s3`. |
| A2 | **Checklists as versioned data.** `checklist_template {id, tenantId?, key, version, items JSONB}`; the visit stores `templateId + version + full snapshot of items and results`. Tenants clone the system template and edit it in the office UI; a new save = new version. | maintenance, visits | "The customer checks old lifts differently / the manufacturer's manual has its own list / hydraulics need extra items" — data change, and old visits keep their evidence intact. |
| A3 | **Per-elevator interval, per-tenant strategy.** The cycle is the firm's own schedule: `elevator.checkIntervalDays` (default `tenant.settings.checkIntervalDays = 30` — 30 days is the legal default for the functional check, the only place this document leans on it), `tenant.settings.cycleStrategy` = `rolling` or `calendarMonth`. Engine is a pure function `nextDue(lastDone, elevator, settings)`. | maintenance | "They check old lifts every 15 days" / "public-tender contracts demand 10 days" / "they think in calendar months, not 30 days". |
| A4 | **Pricing as data + strategy registry.** `pricing_plan.rules` JSONB, e.g. `{strategy:"perBlock", blockSize:100, pricePerBlock:4000, currency:"EUR", trialDays:90}`; `computeCharge(plan, usage)` dispatches on `strategy`; per-tenant plan override and `validFrom`. | pricing | "A firm wants per-elevator pricing" → add `perElevator` strategy (10 lines) or a custom plan row; "trial becomes 60 days" → data. |
| A5 | **Templates as data.** Notification texts (`notification_template`, Handlebars, BG/EN), document templates (`document_template` for дневник page, invoice, defect notice to the building, inspection request, monthly report — system rows + tenant override, versioned; generated documents record `templateKey@version`). | notifications, documents | "Inspectors want a different дневник layout" / "a professional manager wants the monthly report as a table with one row per elevator" → edit a template row, old documents unchanged. |
| A6 | **Reference data seeded, not coded.** `packages/domain-data/`: `checklists/functional-check.v1.json` (Приложение към чл. 9 ал. 1 т. 2), `defects/art10.v1.json` (17 items, all `stopLift:true`, legal refs), `inspection-bodies.json`, `calendar-rules.json` (alert offsets 90/60/30/7, inspection interval 24 then 12; the defect follow-up window is `tenant.settings.defectFollowUpDays`, default 30). Seeds are idempotent upserts keyed by `code`. | registry, defects, calendar | "the ordinance adds an 18th defect", "alerts wanted at 14 days". |
| A7 | **Feature flags per tenant.** `tenant.features` JSONB over a typed registry (`features.ts`): `publicQrPage`, `publicFaultReport`, `gpsCapture`, `customerSignature`, `viberBusiness`, `sms`, `invbgPush`, `calendarMonthCycle`, `officeVisitEntry`. Default off unless stated. | tenancy | Piloting one behaviour with one firm without a branch; "technicians read GPS as surveillance" → off by default, on only where the owner asks. |
| A8 | **Event bus with transactional outbox.** Commands insert into `domain_event` in the same transaction; a worker dispatches to subscribers with per-`(eventId, handler)` idempotency and retries. Subscribers are registered in `main.ts`, not inside the emitting module. | platform | New behaviour attaches by subscribing: "Viber the домоуправител when the visit is done" is a rule + subscriber; "sync to a property-manager platform" is a subscriber; `visits` is untouched. |
| A9 | **Versioned API and versioned offline payloads.** `/api/v1`, additive only; breaking → `/api/v2` alongside. Outbox payloads carry `schemaVersion`; the server keeps upcasters for N-1 (a phone pushes week-old payloads after a deploy). `X-Min-Client-Version` forces the PWA to update once its outbox is drained. | http, sync | Deploying while 10 phones are offline; a store build lagging behind the web. |
| A10 | **Migration discipline.** Expand → deploy → contract; never edit an applied migration; destructive DDL only two releases after the code stopped using the column; backfills as idempotent scripts; backup before every deploy (`scripts/deploy.sh`). | db | Being able to roll back to the previous image without a schema rollback. |
| A11 | **Configurable base path and origin.** `VITE_BASE` at build, `BASE_PATH` and `PUBLIC_BASE_URL` at runtime; every generated absolute link (QR, e-mail, Viber, PDF footer) goes through `urls.public(...)`. | platform | `/avroleva/` on the shared host today, `app.avroleva.bg` tomorrow (see §7 on why the domain should come *before* printed QR labels and technician installs). |
| A12 | **Evidence never blocks.** Validation rules that encode the firm's own working rules (`minTechnicians` per visit type, response time 60 min, 30-day interval — all tenant settings) produce **data-quality / operational flags**, not hard errors, on evidence capture. Hard validation only on master data. | visits, callbacks | "The functional check is done by one technician in practice" — the record is still captured, and the flag is the truthful evidence. |
| A13 | **Timestamp provenance.** Every evidence timestamp stores `at`, `source` (device, server or manual), `clientOffsetMs`, `receivedAt`. | visits, callbacks | Clock-skewed phones, retroactive entry, and any later dispute about "when" — the record says how it knows. |

---

## 3. Data model

Conventions: ids are **UUIDv7** (client-generatable offline, non-guessable, time-sortable; `uuid@11 v7()`); every tenant-owned table has `tenantId` (NOT NULL, first column of every index and every unique constraint); `createdAt/updatedAt` (timestamptz, UTC; display in Europe/Sofia); `createdBy/updatedBy`; money as **integer cents** (`Int`, EUR); JSONB for snapshots and settings; enums as Postgres enums. Cross-module references are `(sourceType, sourceId)` pairs. Prisma 6 schema in `apps/api/prisma/schema.prisma`.

**Tenant boundary.** Everything below is tenant-owned except reference tables (`inspection_body`, `defect_catalog`, system rows of `checklist_template`/`document_template`, `pricing_plan`, `platform_admin`), which have `tenantId NULL` and may be shadowed by tenant rows with the same `code`. A tenant never sees another tenant's record of the same physical lift: when a building changes firm, the new firm creates its own elevator record; the old firm keeps its evidence for 10 years. (Revisit: a "takeover handshake" keyed on registration number when two tenants hold the same lift.)

**Soft delete and immutability.** Master data (`customer, contact, building, elevator, contract, user, checklist_template, notification_template`) gets `deletedAt/deletedBy` — "archive with preview + confirm" in the UI, never a hard delete; unique constraints are partial `WHERE deletedAt IS NULL`. Evidence tables (`visit, callback, callback_event, defect, inspection, document, invoice (issued), payment, notification, audit_log, domain_event`) have **no delete and no in-place edit after submission**: corrections create a new version (`supersedesId`) or a status transition with reason (`void` + credit note for invoices). The only hard delete is tenant purge via `deleteTenantData` (owner-initiated or by platform admin at the tenant's request; export first, 30-day grace during which it can be cancelled, scripted, audit entry) — see "Data custody stance" in §6.

**Audit strategy.** (1) `audit_log` is INSERT-only at the database level (the app role has no UPDATE/DELETE on it) and hash-chained (`hash = sha256(prevHash || canonical(row))`), verifiable by `scripts/verify-audit-chain.ts` and included in exports — the "evidence" promise in a form a firm can hand to its own lawyer in a dispute with a building. (2) `domain_event` is the append-only business history. (3) Every mutation records actor (user/system/public), `requestId`, ip, a before/after diff for master data and a payload hash for evidence.

### 3.1 Entities (field lists; `?` = nullable)

**tenancy**
- `tenant`: id, name, legalForm, eik, vatNo?, vatRegistered bool, address, phone, emergencyPhone (the number on the cabin sign), email, locale='bg', timezone='Europe/Sofia', settings JSONB {checkIntervalDays:30, cycleStrategy, callbackSlaMinutes:60, defectFollowUpDays:30, retentionYears:null (null = keep), minTechnicians:{functional_check:2, technical_maintenance:2, repair:2, callback:1}, alarmTestIntervalMonths, invoiceSeries, invoiceDueDays, showBgnReference, logbookTemplate}, features JSONB, status (active|readOnly|closed), deletedAt?
- `user`: id, tenantId, role (owner|office|technician), name, email?, username, phone?, passwordHash (bcrypt 12), isActive, technician JSONB? {qualificationLevel 1|2|3, certificateNo, isSeniorTechnician (чл. 8)}, lastLoginAt, deletedAt?
- `session`: id, tenantId, userId, tokenHash (sha256), kind (browser|device), deviceName?, clientVersion?, createdAt, lastSeenAt, expiresAt, revokedAt?
- `device_enrollment_token`: id, tenantId, userId, codeHash, expiresAt (10 min), usedAt?
- `platform_admin`: id, email, passwordHash, totpSecret?

**registry**
- `inspection_body` (ref): id, code, name, kind (licensed|gd_idtn), eik?, contact JSONB
- `customer` (ползвател): id, tenantId, kind (condominium|professionalManager|company|publicInstitution), name, eik?, vatNo?, billingAddress, invoiceEmail?, notes, deletedAt?
- `contact`: id, tenantId, customerId?, buildingId?, name, role (домоуправител|касиер|manager|other), phone?, hasViber bool, email?, isPrimary, deletedAt?
- `building`: id, tenantId, customerId (current ползвател), address JSONB {city, postcode, oblast, district, street, number, block, entrance}, addressText (canonical single line for documents), lat?, lng?, geocode {status, confidence, provider}, accessNotes (encrypted), keysLocation (encrypted), notes, deletedAt?
- `elevator`: id, tenantId, buildingId, internalNo (e.g. "вх. Б, ляв"), regNo? (регистрационен номер at the supervision body), regNoNormalized?, inspectionBodyId?, serialNo?, manufacturer?, installer?, year?, driveType (electric|hydraulic|mrl), doorType (manual|semiAuto|auto), goodsOnly bool, stops, loadKg?, persons?, speedMs?, controllerBrand?, commissioningDate?, checkIntervalDays? (null → tenant default), alarmDevice JSONB {model, phone, operator, simOwner (user|firm), contractType (postpaid|prepaid), lastTestAt}, retrofit JSONB {loadControl, emergencyLight, shaftLight, roofPitStops, alarmDevice, underCabinShield: ok|missing|na}, status (inService|stoppedByFirm|stoppedByAuthority|outOfContract|scrapped), stopReason?, stoppedAt?, restartAuthority?, lastCheckAt (denormalised), nextCheckDue (denormalised), lastInspectionAt?, nextInspectionDue?, stickerYear?, publicCode (8-char, for QR), notes, deletedAt?. Warn (not block) on duplicate `(tenantId, regNoNormalized)`.
- `contract`: id, tenantId, customerId, buildingId, startDate, endDate?, terminationNoticeRule?, status (active|terminated|draft), priceBasis (perStop|flat|perElevator), includes JSONB, documentId? (signed contract), intakeProtocolDocumentId?, instructionSignedAt? (чл. 9 ал. 1 т. 1), terminatedReason?
- `contract_elevator`: contractId, elevatorId, monthlyPriceCents, fromDate, toDate?  (history = rows; a building that changes firm ends up with `contract.endDate` set and elevators `outOfContract`; a takeover starts a new contract with `intakeProtocolDocumentId`).
- `import_batch`: id, tenantId, filename, status (preview|committed|rolledBack), rowCount, errors JSONB, createdRows JSONB (ids per table, for rollback)

**documents**
- `attachment`: id (client-generated allowed), tenantId, storageKey, mime, sizeBytes, sha256, width?, height?, takenAt? (from EXIF, then stripped), thumbKey?, uploadedBy, uploadedFromDevice bool, clientId? (idempotency), createdAt
- `document`: id, tenantId, kind (logbookPage|invoice|defectNotice|inspectionRequest|monthlyReport|contract|intakeProtocol|drawing|declarationOfConformity|qualityDoc|inspectionAkt|hydraulicProtocol|paymentDoc|other), title, attachmentId, elevatorId?, buildingId?, sourceType?, sourceId?, issuedAt, generated bool, templateKey?, templateVersion?, renderHash?, retentionUntil? (null = keep; set from `tenant.settings.retentionYears` when the tenant configures a purge), deletedAt? (only for uploads before retention; never for generated evidence)
- `document_template` (ref, tenant-overridable): key, version, engine='handlebars', html, css, pageSize, active
- `idempotency_key`: tenantId, key, requestHash, responseStatus, responseBody, createdAt (TTL 7 days)

**maintenance**
- `checklist_template`: id, tenantId?, key, version, name, items JSONB [{code, group, textBg, method?, appliesTo {driveType[], doorType[], goodsOnly?}, resultType: okDefectNa}], active
- `maintenance_job`: id, tenantId, elevatorId, kind (functionalCheck|technicalMaintenance|hydraulicProtocol|preInspection), dueDate, windowStart, status (planned|assigned|done|missed|cancelled), assignedUserIds uuid[], routeId?, plannedDate?, completedVisitId?, completedAt?, generatedBy (cron|event|manual). Partial unique `(elevatorId, kind) WHERE status IN (planned, assigned)`.
- `route`: id, tenantId, name, technicianUserIds, buildingIds (ordered), active

**visits** (the evidence record)
- `visit`: id (client UUID), tenantId, elevatorId, jobId?, kind (functionalCheck|technicalMaintenance|repair|callbackVisit|hydraulicProtocol|preInspection|inspectionAttendance|other), startedAt, finishedAt, timestampSource, clientOffsetMs, receivedAt, checklistTemplateId?, checklistVersion?, checklist JSONB (snapshot: items with results ok|defect|na + notes), overallCondition (ok|defectsFound|stopped), remarks, partsUsed text?, gps JSONB? {lat,lng,accuracy}, logbookPageRef? (page/entry number in the paper дневник), logbookPhotoAttachmentId?, logbookPdfDocumentId?, customerSignatureAttachmentId?, enteredBy (technicianDevice|office), source (app|paper), status (submitted|amended|superseded), supersedesVisitId?, role (primary|supplement), qualityFlags text[] (e.g. `singleTechnician`, `late`, `clockAdjusted`), submittedBy
- `visit_technician`: visitId, userId, position (1|2|3), nameSnapshot (first + last name as written on the paper page)
- `visit_attachment`: visitId, attachmentId, purpose (photo|logbookPage|signature|other), caption?

**callbacks**
- `callback`: id (client UUID), tenantId, elevatorId, channel (cabinDevice|phone|viber|publicQr|email|other), callerName?, callerPhone?, classification (entrapment|breakdown|complaint|other), trappedCount?, injuries bool, receivedAt (+source/offset), dispatchedAt?, onSiteAt?, releasedAt?, restoredAt?, leftOutOfServiceAt?, closedAt?, assignedUserIds, cause?, action?, partsUsed?, chargeable bool, chargeReason? (misuse|vandalism|water|outOfHours|other), closeoutVisitId?, responseMinutes? (derived onSiteAt − receivedAt), slaMinutes (snapshot of tenant setting), slaBreached bool, status (open|dispatched|onSite|closed), notes
- `callback_event`: id, callbackId, type, at (+provenance), byUserId?, data JSONB — the timeline; the columns above are a projection of it.

**defects**
- `defect_catalog` (ref): code 1..17, textBg, stopLift true, legalRef ("чл. 10 ал. 1 т. N"), version
- `defect`: id, tenantId, elevatorId, catalogCode?, description, stopLift bool, foundAt, sourceType (visit|callback|inspection|office), sourceId, userNoticeDocumentId? + userNotifiedAt?, userRequestedRepairAt?, followUpDueAt (foundAt + `tenant.settings.defectFollowUpDays`, default 30 — an office to-do "open for N days without the building's go-ahead", nothing more), resolvedAt?, resolvedSourceType/Id?, status (open|noticeSent|awaitingUser|resolved|wontFix), severity?

**calendar**
- `inspection`: id, tenantId, elevatorId, kind (periodic|afterRepair|afterAlteration|afterStop6m|afterComponentReplacement|accident|unannounced|onRequest|initial), inspectionBodyId?, requestedAt?, requestDocumentId?, scheduledAt?, performedAt?, attendeeUserIds, result? (fit|fitWithConditions|unfit), aktNo?, aktDocumentId?, nextDueDate?, stickerYear?, feeCents?, feePaidBy? (user|firm), notes
- `inspection_defect`: inspectionId, defectId, deadline?, closedAt?  (defect rows live in `defects`)
- `calendar_item` (materialised, regenerated nightly): id, tenantId, kind (inspectionDue|checkOverdue|defectFollowUp|alarmTestDue|hydraulicProtocolDue|contractEnding|missingRegNo|missingAlarmDevice), refType, refId, dueAt, severity, status (upcoming|due|overdue|done|dismissed), lastAlertedStep?
- `alarm_device_test`: id, tenantId, elevatorId, testedAt, result (ok|failed), byUserId, notes  · `hydraulic_protocol`: id, tenantId, elevatorId, checkedAt, cleanlinessClass, documentId, userRequestedAt?

**billing**
- `invoice_sequence`: tenantId, series, nextNumber (row lock on issue; gapless 10-digit numbers per ЗДДС чл. 114)
- `invoice`: id, tenantId, series, number? (assigned at issue), status (draft|issued|paid|partiallyPaid|void), issueDate, taxEventDate, dueDate, customerId, buildingId?, contractId?, supplierSnapshot JSONB, recipientSnapshot JSONB {name, address, eik, vatNo}, period? (YYYY-MM), subtotalCents, vatRate (20|0), vatCents, totalCents, currency='EUR', bgnReferenceCents? (×1.95583, display only), vatRegime (standard|notRegisteredArt113), paymentMethod (bank|cash), paidCents, pdfDocumentId?, externalProvider?, externalId?, voidedAt?, voidReason?, creditNoteId?
- `invoice_line`: invoiceId, position, elevatorId?, description, qty, unitPriceCents, vatRate, lineTotalCents
- `payment`: id, tenantId, invoiceId, amountCents, method (cash|bank|card), receivedAt, fiscalReceiptNo?, reference?, recordedBy
- `credit_note`: id, tenantId, invoiceId, number, issueDate, amountCents, reason, pdfDocumentId

**pricing**
- `pricing_plan` (ref): code, name, rules JSONB, validFrom, active
- `subscription`: tenantId, planCode, status (trialing|active|pastDue|readOnly|cancelled), trialEndsAt, currentPeriodStart/End, elevatorCount (last snapshot), monthlyChargeCents, notes
- `usage_snapshot`: tenantId, month, activeElevators, technicians, officeUsers, chargeCents, planRulesSnapshot

**notifications**
- `notification_template` (ref, tenant-overridable): key, channel, version, lang, subject?, body (Handlebars), active
- `notification_rule`: id, tenantId, eventType, channel, recipient (buildingContact|customer|assignedTechnicians|owner|office|custom), templateKey, enabled, conditions JSONB?
- `notification`: id, tenantId, channel (email|sms|viberLink|viberBusiness), to, templateKey, templateVersion, payload JSONB, rendered, status (queued|sent|failed|delivered|opened), providerMessageId?, error?, attempts, sourceType?, sourceId?, sentAt?

**platform**
- `audit_log`: id (bigint), tenantId?, at, actorType (user|system|public|platformAdmin), actorId?, action, entityType, entityId, before JSONB?, after JSONB?, payloadHash?, requestId, ip?, userAgent?, prevHash, hash
- `domain_event`: id, tenantId, type, version, aggregateType, aggregateId, payload JSONB, occurredAt, causationId?, correlationId?  · `event_delivery`: eventId, handler, status, attempts, lastError, processedAt
- pg-boss tables in schema `pgboss`.

### 3.2 Prisma excerpt (conventions only)

```prisma
model Visit {
  id            String   @id @db.Uuid            // UUIDv7 generated on the phone
  tenantId      String   @db.Uuid
  elevatorId    String   @db.Uuid
  jobId         String?  @db.Uuid                 // no FK: maintenance owns jobs
  kind          VisitKind
  startedAt     DateTime @db.Timestamptz
  finishedAt    DateTime @db.Timestamptz
  timestampSource TimestampSource                 // device | server | manual
  clientOffsetMs Int      @default(0)
  receivedAt    DateTime @default(now()) @db.Timestamptz
  checklist     Json                               // snapshot: template items + results
  checklistTemplateId String? @db.Uuid
  checklistVersion    Int?
  status        VisitStatus @default(submitted)
  supersedesVisitId String? @db.Uuid
  qualityFlags  String[]
  tenant   Tenant   @relation(fields: [tenantId], references: [id])
  elevator Elevator @relation(fields: [elevatorId], references: [id])
  technicians VisitTechnician[]
  @@index([tenantId, elevatorId, startedAt(sort: Desc)])
  @@index([tenantId, receivedAt])
}
```

---

## 4. Offline-first technician PWA

**Stack:** React 19 + Vite 7 in `apps/tech`; `vite-plugin-pwa` (Workbox 7, `injectManifest` so we own the service worker); **Dexie 4** over IndexedDB; no state library beyond React context + Dexie live queries (`dexie-react-hooks`). Bundle target < 300 KB gzipped; no map tiles in the technician app (a "navigate" deep link to Google/Apple Maps is enough).

**Service worker:** precaches the app shell; API responses are *not* cached by the SW (Dexie is the cache); photo thumbnails `CacheFirst` (30 days, 200 entries); never caches 401/5xx. `registerType: 'prompt'` — "Нова версия" toast; forced reload only after the outbox is empty, or when the server answers `X-Min-Client-Version` above the running build.

**Local store (Dexie tables):** `buildings`, `elevators`, `jobs`, `checklistTemplates`, `defectCatalog`, `contacts` (phone numbers of the домоуправител only), `visits`, `callbacks`, `defects` (local copies), `blobs` (photos as Blob), `outbox`, `meta` (cursor, clockOffset, user, tenant settings). Scope: the whole tenant registry (500 elevators ≈ 1 MB) — simpler and more robust than per-route slicing; revisit above ~3,000 elevators.

**Pull:** `GET /api/v1/sync/pull?since=<watermark>` returns changed rows per collection (`updatedAt >= since − 2 s`, including soft-delete tombstones) plus `serverTime`. Upserts are idempotent, so overlap is harmless. Runs on app start, on `online`, on focus, and every 15 min while open.

**Push (outbox):** rows `{id: uuidv7, kind: visit.record | visit.amend | callback.open | callback.event | defect.record | attachment.upload, schemaVersion, payload, createdAt, attempts, lastError, status}`. Drained strictly FIFO, one request at a time, `Idempotency-Key: <outbox id>`; the server stores `(tenantId, key, requestHash) → response` for 7 days and replays it, so duplicates after a lost response are safe. Backoff 5 s → 5 min; Background Sync API where available (Android Chrome), otherwise the `online` event. **Parent before child:** a visit is pushed with `attachmentIds[]` before its photos exist on the server; the office sees "2 снимки чакат качване" until the `attachment.upload` items land. Photos are deleted from Dexie only after the server confirms the sha256.

**Photos:** captured through `platform/camera.ts` (web: `<input type="file" accept="image/*" capture="environment">`); downscaled in the browser to ≤ 1600 px, JPEG q0.8 (≈ 250–400 KB); sha256 computed client-side; uploaded as multipart with `clientId`, `takenAt`, `sha256`. Server re-encodes with `sharp`, strips EXIF (keeps `takenAt` in the row), writes a 320 px thumbnail, rejects mismatched hashes.

**Conflict rules:** visits and callback events are **append-only, client-identified** facts, so true conflicts do not exist — only duplicates and ordering. (1) `recordVisit` is idempotent on `visit.id`. (2) One job may receive several visits: the first accepted visit completes the job and is `role=primary`; a second submission for the same job within 12 h from another technician is stored as `role=supplement` — photos and names merge into the job's view, nothing is overwritten, the office sees both. This is exactly the "two technicians both submit" case; the recommended UX is that one phone records and picks the colleague's name from the list. (3) Amendments create a new visit with `supersedesVisitId`; the original stays. (4) Master data edits from the office always win on the phone (the phone never edits master data; it can only *propose* corrections, e.g. "wrong stop count", as a note).

**Clock skew:** each sync handshake measures `offset = serverTime − clientTime − rtt/2` and stores it in `meta`. Every event carries `at` (device clock), `clientOffsetMs` (last known offset), `timestampSource=device`, and gets `receivedAt` on the server. Display time = `at + offset` when |offset| > 2 min, and the visit gets the `clockAdjusted` flag; raw values are kept. An event with `at > receivedAt + 5 min` or an offset unknown for > 30 days is flagged `clockSuspect` for office review. Nothing is silently rewritten — the record shows how it knows what time it was (A13).

**Sessions offline:** device session 180 days sliding (`kind=device`); on 401 the app keeps all local data and the outbox and asks for re-enrollment (the owner shows a QR on the office screen, the phone scans it — no typing for a 55-year-old technician); the outbox resumes after login. `navigator.storage.persist()` is requested on first run; local visits older than 90 days are pruned after confirmed sync. iOS Safari may evict storage of a PWA not on the home screen after 7 days of non-use — home-screen installation is part of onboarding, and the sync watermark makes recovery a re-pull.

**Capacitor later (cheap by construction):** the same `apps/tech` build ships inside Capacitor 7 with `base: '/'` and an absolute `API_BASE_URL`; the API allows the `capacitor://localhost` / `http://localhost` origins with credentials and accepts the session token as `Authorization: Bearer` (§5) because WebView cookies are unreliable. All platform-specific code sits behind five small interfaces in `apps/tech/src/platform/`: `camera`, `geolocation`, `secureStorage`, `http`, `share` — web implementations from day one, native ones mapping 1:1 to `@capacitor/camera|geolocation|preferences|share`. Wrapper cost: 2–3 days plus store accounts. Rejected: React Native/Flutter (a second codebase); loading the remote URL inside the wrapper (no offline, store-rejection risk).

---

## 5. API design

**REST + JSON under `/api/v1`, contracts as zod 4 schemas in `packages/contracts`** (request/response/event schemas; TypeScript types inferred; both SPAs import them; OpenAPI generated from the same schemas with `zod-openapi`). tRPC is rejected despite its speed for one TypeScript developer: the API must serve a public QR page, a store build lagging behind the web and property-manager integrations — REST is curl-debuggable, versionable per resource and what Claude Code writes most reliably. GraphQL is pure overhead at this size.

**Server:** Express 5 (the developer's latest project, Goals D&C, uses it; async errors are native in v5) with `zod` validation middleware, `helmet`, `express-rate-limit`, `pino-http`, `multer`. Fastify was considered for plugin encapsulation and built-in validation; boundaries are enforced by tooling instead (§1), which keeps the HTTP framework a thin adapter (`modules/<m>/http/router.ts`) swappable module by module.

**Auth:** opaque random tokens (32 bytes; sha256 stored in `session`), delivered as an `httpOnly; Secure; SameSite=Lax; Path=/` cookie for browsers and as `Authorization: Bearer` for native/Capacitor; one code path resolves either. Browser sessions 30 days sliding, device sessions 180 days sliding, both revocable by the owner ("излез от този телефон"). JWT is rejected: no revocation, no benefit with one server. Passwords bcrypt cost 12; technicians are enrolled by a one-time QR code (10-minute `device_enrollment_token`) generated on the owner's screen. CSRF: cookie requests must carry `X-Requested-With: avroleva` (JSON API, no forms); bearer requests are exempt. 2FA (TOTP) for owners is a v1.1 item.

**Tenant scoping:** `tenantId` is taken from the session only, never from the URL or body. Middleware builds `ctx = {tenantId, userId, role, requestId, clientVersion}`; every repository function takes `ctx` and adds `tenantId` to every `where`; a Prisma client extension throws in dev/test when a query on a tenant-owned model lacks `tenantId`. Cross-tenant ids return **404, never 403** (no existence leak). Platform admins act on a tenant only through an explicit, audited "impersonate" session.

**Roles:** owner (everything incl. users, billing settings, exports, plan), office (all operational data, invoices, letters; no user management, no plan), technician (own jobs, record visits/callbacks/defects, read registry, phone numbers of contacts; no money, no exports), platformAdmin (tenants, plans, system page).

**Idempotency:** `Idempotency-Key` header honoured on every mutating endpoint (required on sync push, optional elsewhere); same key + same body hash → stored response replayed; same key + different body → 422.

**Pagination:** cursor-based (`?cursor=&limit=` ≤ 200) over `(createdAt, id)`; filters as query params; responses `{items, nextCursor}`; sorting fixed per endpoint (no index surprises).

**Files:** upload through the API (`POST /api/v1/attachments`, multipart, 20 MB max, `client_max_body_size 25M` in nginx) to the `FileStorage` port — local disk in the MVP. The client asks `POST /attachments/upload-target` first and receives `{mode:'api'}` today or `{mode:'presigned', url}` once storage moves to S3-compatible object storage, so the client never changes. Downloads only through **signed URLs** (`/api/v1/files/:id?exp&sig`, HMAC, 15 min, tenant-checked) for both adapters.

**Exports** ("your data leaves with you"): `GET /api/v1/exports/:dataset.csv` streams UTF-8 with BOM (Excel-safe) for every dataset (elevators, buildings, customers, contacts, contracts, visits incl. checklist results flattened, callbacks, defects, inspections, invoices, payments, notifications, audit); `POST /api/v1/exports/full` runs a job producing a zip (CSV per table + all documents/photos + audit chain + `README.txt`), delivered by signed link, expires in 24 h.

**Errors:** RFC 7807 shape `{type, title, status, code, detail, fields[]}`; messages are i18n keys resolved server-side in the tenant's locale.

**Versioning:** `/v1` additive-only; breaking → `/v2` router beside it; `X-Client-Version` on every request; `X-Min-Client-Version` response header; outbox `schemaVersion` upcasters (A9).

---

## 6. Cross-cutting

**PDF generation.** Server-side HTML → PDF with **puppeteer-core 24 + Debian `chromium`** in the image; templates are Handlebars 4 rows in `document_template` (defaults shipped in `packages/domain-data/templates/`), CSS `@page` A4/A5, **Noto Sans (Cyrillic) embedded via `@font-face` from `apps/api/assets/fonts`** so rendering never depends on system fonts. Documents: дневник page (header with address/entrance/registration number; rows Дата · Час · Вид работа · Констатации/дейности · Монтьор 1 · Монтьор 2 · Подпис · Подпис; a short record hash so paper page and office record can be matched; blank signature strip), invoice (ЗДДС чл. 114 fields; the `notRegisteredArt113` variant prints "чл. 113, ал. 9 ЗДДС"), defect notice to the building (the written notice that accompanies a stop-lift defect), inspection-request letter to the building, monthly building report, QR label sheets (A4, 24 per sheet). Rendering runs in the worker with concurrency 1; one browser instance is reused and closed after 60 s idle (≈ 150–250 MB while active — the biggest memory consumer on a 3.8 GB VPS shared with five apps, hence the `PdfRenderer` port with a Gotenberg-sidecar adapter as escape hatch). Rejected: pdfmake/@react-pdf (layouts a non-developer cannot edit), LibreOffice (size), wkhtmltopdf (unmaintained).

**Scheduled jobs.** **pg-boss 10** (Postgres-backed queue: persistent, retries with backoff, cron with `tz: 'Europe/Sofia'`, singleton keys; no Redis). The same image runs as `ROLE=api|worker|all`; MVP runs `all` in one container, splitting later is a compose change. Crons: `maintenance.generateJobs` 02:00 daily (+ on `ElevatorRegistered`), `calendar.recompute` 02:30 (includes the defect follow-up items), `alerts.dispatch` 07:00, `callbacks.slaWatch` every minute, `billing.draftPeriod` 1st 03:00, `pricing.snapshot` 1st 04:00, `retention.sweep` weekly, `backup.verify` weekly. All jobs are **catch-up idempotent** ("ensure every in-contract elevator has an open job"), so a reboot at 02:00 heals itself the next run. Event delivery: the outbox poller enqueues one pg-boss job per `(event, handler)` with 5 retries; failures land on the admin system page.

**Notification adapters.** `EmailSender` (nodemailer SMTP, any provider), `SmsSender` (Bulgarian aggregator or Twilio; `console` in dev), `ViberSender` with two adapters: `viberLink` (free: `viber://chat?number=` + copied text) and `viberBusiness` (aggregator API, ~€150/month fixed — feature-flagged, on at ~10 paying firms). Every send is a `notification` row first, then a job; delivery status returns by webhook where the provider supports it.

**File storage.** `FileStorage` port; `local` adapter writes `/data/uploads/<tenantId>/<yyyy>/<mm>/<id>.<ext>` on the named volume `avroleva_uploads`; `s3` adapter (AWS SDK v3; Hetzner Object Storage / Backblaze B2 / Cloudflare R2). Volume: 500 elevators × 12 visits × 3 photos × 300 KB ≈ **5.4 GB/year per firm** (+ ~20 % callbacks and documents ≈ 6.5 GB; thumbnails ≈ 15 KB). Move to object storage above ~20 GB or at the third paying firm — a config change plus a one-off copy script.

**Backups.** Nightly `pg_dump -Fc` + uploads to `/root/backups/avroleva/` (pattern of `backup-kontira.sh`), **plus an encrypted offsite copy with `restic` to Backblaze B2 or a Hetzner Storage Box** — mandatory here: long-term evidence retention is the product promise and no app on this VPS has an offsite copy yet. Retention 30 daily / 12 monthly; `scripts/restore-drill.sh` restores into a throwaway container and runs the audit-chain verifier, quarterly.

**GDPR basics.** The firm is controller, we are processor (DPA in the terms). Personal data: домоуправители/contacts (name, phone, Viber), technicians (name, phone, qualification), callers, owner accounts. Minimisation: GPS off by default (feature flag; technicians read it as surveillance) and captured only at submit; the public QR page shows no personal data. Field-level AES-GCM encryption for `building.accessNotes`/`keysLocation`. Retention: evidence is tenant-controlled (default keep; firms keep a 10-year dossier in practice, so the default is long), notification logs 2 years, sessions 180 days, idempotency keys 7 days. Erasure of a contact = pseudonymise the `contact` row; evidence keeps only the id. Full tenant export on demand; `deleteTenantData` purges after export with a 30-day grace.

**Data custody stance.** The company is a data processor for each tenant, nothing more. Tenant isolation is strict (§5 scoping, §8 tests): no cross-tenant reports, no aggregated views of who is on schedule and who is not, no "industry dashboard" — the product holds each firm's operational record for that firm alone. Every tenant can export all of its data at any time (`fullTenantExport`) and can delete it (`deleteTenantData`: owner-initiated, 30-day grace during which the request can be cancelled, then a scripted purge with an audit entry; the platform admin can run the same procedure at the tenant's written request). Retention is tenant-controlled: the default is to keep everything; a tenant may configure a purge of visits and photos older than N years (`tenant.settings.retentionYears`), applied by the weekly `retention.sweep`. What a firm shows to any authority is the firm's own decision and is done from its own export. Any lawful request for data addressed to the company would be scoped to the named tenant and handled with legal advice; a valid legal order can compel data and the product does not promise otherwise — this stance is about scope and positioning, not about evasion.

**Security.** Tenant isolation tests on every endpoint (§8); rate limits (login 20/15 min per IP, public fault report 5/h per elevator and 20/h per IP, API 600/min per session, exports 10/h); zod validation everywhere; upload sniffing with `file-type`, images re-encoded by `sharp`; signed URLs for every file; UUIDv7 ids; helmet with a real CSP (no inline handlers); secrets only in the VPS `.env`; `npm audit` and Dependabot in CI; audit log for every mutation and impersonation. Postgres row-level security is deliberately *not* in v1 (Prisma + `SET LOCAL` friction for one developer); it is the upgrade path when a second developer joins or a customer asks for a security audit.

**Observability at one-VPS budget.** `pino` JSON logs with `requestId/tenantId/userId` (no PII), Docker `json-file` rotation (20 MB × 5); Sentry free tier (`@sentry/node`, `beforeSend` scrubs phones/e-mails) or log alerts if the founder prefers no third party; `GET /api/v1/health` returns db, queue depth, last run of each cron, disk free, browser-pool state; UptimeRobot (free) every 5 min; `/admin/system` lists failed jobs, sync errors, SLA breaches, storage usage; weekly digest e-mail to the founder.

---

## 7. Deployment (per VPS-GUIDE.md and GITHUB-GUIDE.md)

- **Docker Compose, own Postgres** (the VPS convention: every app has its own `postgres:16-alpine` container and volumes). Services: `db` (volume `avroleva_db`), `app` (`ROLE=all`, `ports: ["127.0.0.1:3005:3005"]`, volume `avroleva_uploads` at `/data/uploads`). **Port 3005**, not 3004 — Goals D&C already uses 3004 locally and is queued for deploy; confirm with `ss -tlnp` first. Image: `node:22-bookworm-slim` + `chromium` + fonts, multi-stage (build SPAs and API, copy `dist/` + `node_modules` prod only), runs as user `node`, ~450 MB.
- **nginx path prefix:** `location /avroleva/ { proxy_pass http://127.0.0.1:3005/; ... client_max_body_size 25M; proxy_read_timeout 120s; }` inside the existing `listen 443 ssl` server block; `nginx -t && systemctl reload nginx`; verify the other five apps still return 200. The app serves `/` (office SPA), `/m/` (technician PWA, own `manifest.webmanifest` and SW scope), `/q/:code` (public page), `/api/v1/`. SPAs built with `VITE_BASE=/avroleva/` and `/avroleva/m/`; server links from `BASE_PATH=/avroleva` and `PUBLIC_BASE_URL=https://srv1662742.hstgr.cloud/avroleva`.
- **Custom domain — buy it before the first technician installs and before the first QR labels are printed.** A PWA's identity and its IndexedDB are bound to the origin; moving from `srv…/avroleva/m/` to `app.avroleva.bg` later means every phone reinstalls and re-syncs, and printed QR codes must be redirected forever. The path prefix is right for internal demos; the founding customer starts on the domain (new `server {}` block, certbot for the new hostname — allowed by the guide — `VITE_BASE=/`, same container).
- **Environment** (`.env` on the VPS only): `POSTGRES_*`, `SESSION_SECRET`, `FILE_SIGNING_SECRET`, `FIELD_ENCRYPTION_KEY`, `BASE_PATH`, `PUBLIC_BASE_URL`, `ROLE`, `SMS_PROVIDER` + keys, `SMTP_*`, `VIBER_*`, `STORAGE_DRIVER`, `S3_*`, `GEOCODER`, `MAP_TILES_URL`, `SENTRY_DSN`, `SEED_DEMO=false`; validated with zod at boot, missing secret = refuse to start.
- **CI (GitHub Actions):** `ci.yml` on push/PR — `npm ci`, typecheck, eslint, dependency-cruiser + ownership check, Vitest unit + integration against a `postgres:16` service, build both SPAs and the API, `docker build` (not pushed). `deploy.yml` is `workflow_dispatch` only: SSH (deploy key + host key in secrets) → `scripts/deploy.sh` → curl health of `/avroleva/api/v1/health` and of the other apps. Until the first customer, the guide's manual loop (`git pull && docker compose -f docker-compose.prod.yml up -d --build`) is fine.
- **Zero-downtime-enough:** `up -d --build` builds the new image while the old container serves; the swap costs 10–30 s. Technicians never notice (offline-first); the office SPA shows a "reconnecting" banner. Deploy window 06:00–07:00 Sofia. Rollback = previous tag + rebuild (schema backward compatible by rule A10).
- **Migration runbook:** `scripts/deploy.sh` = `pg_dump` → `git pull` → `docker compose build` → `up -d` (the container runs `prisma migrate deploy`, then starts) → health check shows `migrations: ok`. Destructive migrations carry a `-- DESTRUCTIVE` header and merge two releases after the code stopped reading the column; long backfills run as pg-boss jobs, not migrations.

Repository layout (`npm workspaces`):

```
avroleva/
  apps/api/        Express 5 + Prisma; src/{main.ts, worker.ts, http/, modules/<m>/{domain,repo,http,events,index.ts}, platform/}
  apps/office/     React 19 + Vite 7, desktop-first, Leaflet 1.9 map
  apps/tech/       React 19 + Vite 7 + vite-plugin-pwa + Dexie 4; src/platform/ (camera, geolocation, secureStorage, http, share)
  packages/contracts/   zod schemas: API v1, events, outbox payloads
  packages/domain-data/ checklists, defects, inspection-bodies, calendar-rules, templates, fonts
  packages/i18n/        bg.json (source), en.json; t() for server and clients
  docker/ Dockerfile, docker-compose.yml (dev: db + adminer), docker-compose.prod.yml, nginx.snippet.conf
  scripts/ deploy.sh, backup.sh, restore-drill.sh, verify-audit-chain.ts, check-boundaries.ts
  .github/workflows/ ci.yml, deploy.yml
  docs/ ARCHITECTURE.md, MVP-PLAN.md, adr/
```

---

## 8. Testing strategy (one developer)

- **Unit (Vitest 4, pure functions, no DB) — where the domain risk is:** cycle engine (`nextDue` rolling vs calendar month, per-elevator interval, catch-up after a missed run, contract end stops generation); pricing (`computeCharge` at 0/1/100/101/200 elevators, trial boundaries, plan override); follow-up and stop-lift derivation (catalogue vs free text, N-day follow-up clock from the tenant setting, resolution resets); response-time computation with skew and provenance; checklist snapshotting (a template edit never changes an old visit); invoice maths (cents, 20 %/0 %, rounding on the document total, gapless numbering, void → credit note); address normalisation and CSV validation; i18n key completeness (`bg.json` ⊆ `en.json`).
- **Integration per module (Vitest against a real Postgres from `docker compose up db`, one fresh tenant per test — the Goals D&C pattern):** each command → rows + outbox events; `recordVisit` idempotency and the supplement rule; sync pull/push round trip with a stale `schemaVersion`; attachment upload with hash mismatch; PDF render smoke (one page per template, text asserted with `pdf-parse`); job generation idempotent under a double run.
- **Tenant isolation (automated, in CI):** walks the Express route table; for every authenticated route with an `:id`, tenant A calls it with tenant B's ids → expects 404; every list and export for A contains zero B rows; B's public QR page never exposes A. Fails the build on any new unguarded route.
- **Boundaries:** `dependency-cruiser` rules (layers, `index.ts`-only imports) + `check-boundaries.ts` (Prisma model access outside the owning module).
- **One end-to-end smoke (Playwright):** seed demo tenant → office logs in → imports the CSV → due board shows jobs → technician PWA goes offline (`context.setOffline(true)`) → records a visit with a photo and two names → online → sync → office sees the visit → prints the дневник page. Runs nightly, not on every push.
- **Fixtures:** `apps/api/prisma/seed/demo.ts` — tenant "Демо Лифт ЕООД", 3 technicians, 1 office user, 12 buildings/25 elevators in Sofia + 1 in Plovdiv (second regional office), contracts, one open callback, two defects (one at day 28 of the 30-day follow-up window), one inspection due in 40 days, invoices in three states. Idempotent, gated by `SEED_DEMO=true`.

---

## 9. Decisions log

| # | Decision | Alternatives | Why | Revisit when |
|---|---|---|---|---|
| D1 | Modular monolith, boundaries enforced in CI | Microservices; plain monolith | One dev, one VPS; boundaries are what make modules replaceable | A second team or a module needs independent scaling (PDF rendering first) |
| D2 | Postgres 16, own container | Shared instance; SQLite | VPS convention; isolation; JSONB + row locks for invoice numbers | PG 17 at the first major upgrade |
| D3 | Express 5 + zod 4 | Fastify 5; Hono | Developer's current stack; Claude Code fluency; HTTP is a thin adapter anyway | Schema-driven OpenAPI becomes a product need (partner API) |
| D4 | REST `/v1` with shared zod contracts | tRPC; GraphQL | Public page, native lag, third parties, versioning | Never for the public surface; tRPC could serve internal office-only endpoints |
| D5 | Opaque DB sessions, cookie or bearer | JWT | Revocation, 180-day devices, Capacitor cookies | Stateless auth needed by an edge/CDN |
| D6 | UUIDv7 client-generated ids | bigint autoincrement | Offline creation, no enumeration, natural idempotency | — |
| D7 | Append-only evidence + amendments, hash-chained audit | Editable rows + audit diff | The product promise is evidence in disputes with buildings and for the firm's own management; disputes are about "when" | A court or a customer's lawyer asks for a specific signature scheme (then add e-signatures on top) |
| D8 | Transactional outbox + in-process handlers via pg-boss | Direct calls; Redis/BullMQ; Kafka | Reliability without new infrastructure; attach behaviour by subscribing | > 50 events/s (not this market) |
| D9 | pg-boss for cron and queues | node-cron in-process; system cron; BullMQ | Persistent, retries, singleton, no Redis, one process today, two tomorrow | — |
| D10 | Chromium HTML→PDF with embedded Noto fonts | pdfmake; @react-pdf; Gotenberg sidecar | Templates a non-developer can edit; exact print layouts | RAM pressure on the VPS → Gotenberg sidecar or external renderer |
| D11 | Dexie + custom outbox sync | Replicache/PowerSync/WatermelonDB; CouchDB/PouchDB | Boring, tiny, append-only domain makes conflicts trivial; no vendor lock | If the phone must edit master data offline with real conflicts |
| D12 | PWA first, Capacitor wrapper later, platform interfaces from day one | React Native; native | One codebase; wrapper cost 2–3 days | iOS storage eviction hurts real users → wrap earlier |
| D13 | Local disk storage behind a port, offsite restic backups | S3 from day one | Zero cost, one VPS; volume math allows it for ~2 years/firm | > 20 GB or third paying firm → S3-compatible |
| D14 | Checklists, defects, offices, templates, pricing as data | Code constants | Change without deploy; tenant overrides; versioned evidence | — |
| D15 | Feature flags per tenant in JSONB | LaunchDarkly-style service | Enough for < 100 tenants | Flags need scheduling or percentage rollout |
| D16 | Tenant scoping in code + isolation tests; no RLS in v1 | Postgres RLS | Prisma friction for one dev; tests give the same guarantee today | Second developer or a customer security audit |
| D17 | Invoices as immutable EUR documents with gapless per-tenant numbering; no ledger | Full accounting | The accountant already has Microinvest/Ajur; чл. 114 compliance is enough | SAF-T wave for micro firms (2030) or a customer without an accountant |
| D18 | Path prefix for demos, own domain before go-live | Path prefix forever | PWA origin identity; printed QR longevity | — |
| D19 | Nominatim geocoding + manual pin; OSM/MapTiler tiles by config | Google Maps | Free at import volumes; Bulgarian block addresses need manual fallback anyway | Google if geocode success < 70 % on real data |
| D20 | No subscription charging automation in the MVP; state machine + manual invoicing by the founder | Stripe from day one | 3 free months; single-digit tenants; bank transfer is how these firms pay | 10 paying tenants or card payments requested |
| D21 | Regulator-facing outputs excluded from MVP (no quarterly letter, no authority notifications, no escalation letters, no firm annual-check reminder; `calendar` module holds only inspection dates, deadlines and operational flags) | "Compliance suite as the wedge": quarterly letter and filings as the headline feature | Positioning toward grey-economy-adjacent buyers — "you use our app to track your business; what you show to ДАМТН is your job"; demo comfort (auto-generated regulator documents make owners uneasy on a first call); custody exposure (the product should hold no aggregated compliance view); the event model keeps the option open | A paying customer asks for the quarterly letter, or ДАМТН launches mandatory e-filing (see MVP-PLAN backlog) |
