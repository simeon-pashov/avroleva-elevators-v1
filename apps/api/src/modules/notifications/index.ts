/**
 * notifications (L4) - templates as data (system rows + tenant overrides), per-tenant rules
 * (event -> channel -> recipient), channel adapters behind platform ports (e-mail, SMS, Viber
 * deep links, in-app inbox), the delivery log. Owns: notification_template, notification_rule,
 * notification. Consumes the event bus (registered in subscribers.ts, A8); `visits`, `callbacks`,
 * `billing`, `calendar` never import this module.
 * Public interface: handleEvent (subscriber), send / sendEmail / notifyUsers (reporting, exports,
 * tenancy events), deliver (job), ensureSystemTemplates + ensureDefaultRules (seeds), viberLink,
 * inbox / log / rules / templates queries; router.
 */
export { notificationsRouter } from './http/router.js'
export {
  handleEvent,
  send,
  sendEmail,
  notifyUsers,
  deliver,
  requeueStuck,
  ensureSystemTemplates,
  ensureDefaultRules,
  viberLink,
  inbox,
  log,
  listRules,
  upsertRule,
  listTemplates,
  preview,
  testSend,
  markSent,
  countForTenant,
  toNotificationDto,
  DELIVER_JOB,
} from './service.js'
export type { SendInput, SendEmailInput, NotifyUsersInput } from './service.js'
export { renderText, validateTemplate, textToHtml, channelFallbacks } from './domain/templates.js'
export { matchRules, defaultRules, sampleData, templateKeyFor } from './domain/rules.js'
export const moduleInfo = { name: 'notifications', layer: 4, status: 'active' } as const
