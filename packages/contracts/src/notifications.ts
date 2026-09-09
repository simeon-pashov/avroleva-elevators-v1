import { z } from 'zod'
import { uuid } from './common.js'

// ---- Notifications (L4): rules, templates, delivery log, in-app inbox ------------------------

export const NotificationChannel = z.enum(['email', 'sms', 'viber_link', 'in_app'])
export type NotificationChannel = z.infer<typeof NotificationChannel>

export const NotificationStatus = z.enum(['queued', 'sent', 'failed', 'skipped'])
export type NotificationStatus = z.infer<typeof NotificationStatus>

export const RecipientKind = z.enum(['building_contact', 'owner', 'office', 'assigned_technician'])
export type RecipientKind = z.infer<typeof RecipientKind>

/** Event types a rule may subscribe to (the notifications module consumes the event bus, A8). */
export const NotifiableEventType = z.enum([
  'VisitRecorded',
  'CallbackOpened',
  'CallbackClosed',
  'CallbackSlaAtRisk',
  'CallbackSlaBreached',
  'InvoiceIssued',
  'InvoiceOverdue',
  'InspectionDueSoon',
  'DefectFollowUpDue',
  'CheckOverdue',
  'StopLiftRequired',
  'DunningStageReached',
  'PaymentMatched',
  'CreditNoteIssued',
])
export type NotifiableEventType = z.infer<typeof NotifiableEventType>

/** Per-rule knobs; every key optional so the UI can send only what changed. */
export const notificationRuleConfig = z.object({
  /** For building_contact e-mail: when the contact has no e-mail, create a Viber link suggestion instead. */
  fallbackViberLink: z.boolean().optional(),
  /** InspectionDueSoon only: which alert steps (days before) fire this rule. */
  days: z.array(z.number().int().min(1).max(365)).max(8).optional(),
})
export type NotificationRuleConfig = z.infer<typeof notificationRuleConfig>

export interface NotificationRuleDto {
  id: string
  eventType: NotifiableEventType
  channel: NotificationChannel
  recipientKind: RecipientKind
  enabled: boolean
  config: NotificationRuleConfig
  updatedAt: string
}

export const updateRuleBody = z.object({
  enabled: z.boolean().optional(),
  config: notificationRuleConfig.optional(),
})
export type UpdateRuleBody = z.infer<typeof updateRuleBody>

/** PUT /notifications/rules/:eventType/:channel/:recipientKind - upserts a rule (idempotent). */
export const upsertRuleParams = z.object({
  eventType: NotifiableEventType,
  channel: NotificationChannel,
  recipientKind: RecipientKind,
})

export interface NotificationTemplateDto {
  id: string
  /** null = system template; a tenant row with the same key/channel/locale shadows it. */
  tenantId: string | null
  key: string
  channel: NotificationChannel
  locale: string
  subject: string | null
  body: string
  updatedAt: string
}

export const upsertTemplateBody = z.object({
  subject: z.string().trim().max(300).nullable().optional(),
  body: z.string().min(1).max(20_000),
})
export type UpsertTemplateBody = z.infer<typeof upsertTemplateBody>

export const previewTemplateBody = z.object({
  key: z.string().trim().min(1).max(80),
  channel: NotificationChannel,
  locale: z.string().trim().min(2).max(5).optional(),
  /** Unsaved draft to preview instead of the stored template. */
  subject: z.string().max(300).nullable().optional(),
  body: z.string().max(20_000).optional(),
})
export type PreviewTemplateBody = z.infer<typeof previewTemplateBody>

export interface RenderedNotificationDto {
  subject: string | null
  body: string
  /** The sample data the preview was rendered with. */
  sample: Record<string, unknown>
}

export const testSendBody = z.object({
  key: z.string().trim().min(1).max(80),
  channel: NotificationChannel,
  /** e-mail address or phone; ignored for in_app (goes to the current user). */
  to: z.string().trim().max(200).optional(),
})
export type TestSendBody = z.infer<typeof testSendBody>

export interface NotificationDto {
  id: string
  ruleId: string | null
  eventType: string | null
  channel: NotificationChannel
  to: string
  /** In-app rows are addressed to one user. */
  userId: string | null
  subject: string | null
  body: string
  status: NotificationStatus
  providerId: string | null
  error: string | null
  relatedType: string | null
  relatedId: string | null
  /** Office deep link ("/callbacks?id=…"), BASE_PATH-relative. */
  link: string | null
  /** viber_link rows: the deep links the office user taps (see ViberLinkDto). */
  viber: ViberLinkDto | null
  readAt: string | null
  createdAt: string
  sentAt: string | null
}

export interface ViberLinkDto {
  /** E.164-ish digits with "+" as stored on the contact. */
  number: string
  /** `viber://chat?number=%2B359...` - opens the 1:1 chat (no text prefill on all platforms). */
  chatUrl: string
  /** `viber://forward?text=...` - opens Viber with the text prefilled; the user picks the chat. */
  forwardUrl: string
  /** `https://viber.click/<digits>` - works from a desktop browser. */
  webUrl: string
  text: string
}

export const notificationListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  channel: NotificationChannel.optional(),
  status: NotificationStatus.optional(),
  relatedType: z.string().trim().max(40).optional(),
  relatedId: uuid.optional(),
})
export type NotificationListQuery = z.infer<typeof notificationListQuery>

export interface InboxDto {
  unread: number
  items: NotificationDto[]
}

/** POST /notifications/viber-link - builds the deep links for a contact + text (no row written). */
export const viberLinkBody = z.object({
  phone: z.string().trim().min(5).max(25),
  text: z.string().trim().min(1).max(2000),
})
export type ViberLinkBody = z.infer<typeof viberLinkBody>

/** Rule matrix the settings page renders: every (event, channel, recipient) that makes sense. */
export const RULE_MATRIX: ReadonlyArray<{
  eventType: NotifiableEventType
  channel: NotificationChannel
  recipientKind: RecipientKind
}> = [
  { eventType: 'VisitRecorded', channel: 'email', recipientKind: 'building_contact' },
  { eventType: 'VisitRecorded', channel: 'sms', recipientKind: 'building_contact' },
  { eventType: 'CallbackOpened', channel: 'in_app', recipientKind: 'owner' },
  { eventType: 'CallbackOpened', channel: 'in_app', recipientKind: 'office' },
  { eventType: 'CallbackOpened', channel: 'sms', recipientKind: 'assigned_technician' },
  { eventType: 'CallbackSlaAtRisk', channel: 'in_app', recipientKind: 'office' },
  { eventType: 'CallbackSlaBreached', channel: 'in_app', recipientKind: 'office' },
  { eventType: 'CallbackClosed', channel: 'email', recipientKind: 'building_contact' },
  { eventType: 'CallbackClosed', channel: 'sms', recipientKind: 'building_contact' },
  { eventType: 'InvoiceIssued', channel: 'email', recipientKind: 'building_contact' },
  { eventType: 'InvoiceIssued', channel: 'in_app', recipientKind: 'office' },
  { eventType: 'InvoiceOverdue', channel: 'email', recipientKind: 'building_contact' },
  { eventType: 'InvoiceOverdue', channel: 'in_app', recipientKind: 'office' },
  { eventType: 'InspectionDueSoon', channel: 'in_app', recipientKind: 'office' },
  { eventType: 'InspectionDueSoon', channel: 'email', recipientKind: 'building_contact' },
  { eventType: 'DefectFollowUpDue', channel: 'in_app', recipientKind: 'office' },
  { eventType: 'CheckOverdue', channel: 'in_app', recipientKind: 'office' },
  { eventType: 'StopLiftRequired', channel: 'in_app', recipientKind: 'office' },
  // Dunning (ADR 0001): the stage row decides channel + template; these rules only allow recipients.
  { eventType: 'DunningStageReached', channel: 'email', recipientKind: 'building_contact' },
  { eventType: 'DunningStageReached', channel: 'viber_link', recipientKind: 'building_contact' },
  { eventType: 'DunningStageReached', channel: 'in_app', recipientKind: 'office' },
  { eventType: 'PaymentMatched', channel: 'in_app', recipientKind: 'office' },
  { eventType: 'CreditNoteIssued', channel: 'email', recipientKind: 'building_contact' },
  { eventType: 'CreditNoteIssued', channel: 'in_app', recipientKind: 'office' },
]

/** Template key of an event (one key per event; channel + locale select the row). */
export const TEMPLATE_KEY_BY_EVENT: Record<NotifiableEventType, string> = {
  VisitRecorded: 'visit_recorded',
  CallbackOpened: 'callback_opened',
  CallbackClosed: 'callback_closed',
  CallbackSlaAtRisk: 'callback_sla_at_risk',
  CallbackSlaBreached: 'callback_sla_breached',
  InvoiceIssued: 'invoice_issued',
  InvoiceOverdue: 'invoice_overdue',
  InspectionDueSoon: 'inspection_due_soon',
  DefectFollowUpDue: 'defect_follow_up_due',
  CheckOverdue: 'check_overdue',
  StopLiftRequired: 'stop_lift_required',
  /** Default only: the DunningStageReached payload carries the stage's own templateKey. */
  DunningStageReached: 'dunning_reminder',
  PaymentMatched: 'payment_matched',
  CreditNoteIssued: 'credit_note_issued',
}

/** Templates that are not bound to an event (used by reporting / exports / tenancy / dunning stages). */
export const SYSTEM_TEMPLATE_KEYS = [
  'building_report',
  'export_ready',
  'tenant_deletion_scheduled',
  'tenant_deletion_cancelled',
  'test_message',
  'dunning_second',
  'dunning_final',
  'statement_sent',
  'quote_sent',
  'job_approval_reminder',
] as const
