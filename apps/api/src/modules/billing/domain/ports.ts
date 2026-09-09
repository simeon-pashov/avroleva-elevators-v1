/**
 * Ports declared by billing (ARCHITECTURE section 1.1 rule 2). Sending the building's statement
 * link by e-mail or as a Viber deep link is a notifications (L4) concern that billing (L3) must
 * not import; `wiring.ts` plugs the real implementation in.
 */
export interface StatementLinkNotifier {
  /** E-mail through a template; returns the notification row id. */
  sendEmail(
    tenantId: string,
    input: {
      key: string
      to: string
      data: Record<string, unknown>
      relatedType: string
      relatedId: string
      locale?: string
    },
  ): Promise<{ id: string }>
  /** Viber deep link with the rendered text (the office user sends it by hand). */
  viberLink(
    tenantId: string,
    input: {
      key: string
      phone: string
      data: Record<string, unknown>
      relatedType: string
      relatedId: string
      locale?: string
    },
  ): Promise<{ id: string; url: string; text: string }>
}

let notifier: StatementLinkNotifier | null = null

export function useStatementLinkNotifier(n: StatementLinkNotifier): void {
  notifier = n
}

export function statementLinkNotifier(): StatementLinkNotifier {
  if (!notifier) throw new Error('billing.StatementLinkNotifier not wired (wiring.ts)')
  return notifier
}
