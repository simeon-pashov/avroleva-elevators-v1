import type { EmailAttachment } from '../../../platform/ports/notifications.js'

/**
 * Port to the notifications module (same layer, L4 - so no direct import, ARCHITECTURE section
 * 1.1 rule 2). app.ts wires the real implementation; tests may wire a recorder.
 */
export interface ReportNotifier {
  sendEmail(
    tenantId: string,
    input: {
      key: string
      to: string
      data: Record<string, unknown>
      relatedType?: string | null
      relatedId?: string | null
      attachments?: EmailAttachment[]
      html?: string
    },
  ): Promise<{ id: string }>
  notifyUsers(
    tenantId: string,
    input: {
      key: string
      userIds?: string[]
      roles?: ReadonlyArray<'owner' | 'office' | 'technician'>
      data: Record<string, unknown>
      relatedType?: string | null
      relatedId?: string | null
      link?: string | null
      channel?: 'in_app' | 'email'
    },
  ): Promise<Array<{ id: string }>>
}

let notifier: ReportNotifier | null = null

export function useReportNotifier(impl: ReportNotifier): void {
  notifier = impl
}

export function reportNotifier(): ReportNotifier {
  if (!notifier) throw new Error('reporting: notifier port not wired (app.ts)')
  return notifier
}
