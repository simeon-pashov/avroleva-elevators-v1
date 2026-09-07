import { newId } from '../ids.js'
import { logger } from '../logger.js'
import { prismaBase } from '../db/prisma.js'
import type { Tx } from '../db/prisma.js'

/**
 * Event bus (ARCHITECTURE A8). Step 1 ships the in-process implementation: the event row is
 * persisted to `domain_event` in the caller's transaction and handlers run in-process afterwards.
 * The interface is the one the transactional-outbox + pg-boss dispatcher will implement later,
 * so modules never change when it is swapped.
 */
export interface DomainEventInput {
  type: string
  aggregateType: string
  aggregateId: string
  payload: Record<string, unknown>
  version?: number
}

export interface EventContext {
  tenantId?: string | null
  requestId?: string
  userId?: string | null
}

export type EventHandler = (event: PublishedEvent) => Promise<void> | void

export interface PublishedEvent extends DomainEventInput {
  id: string
  tenantId: string | null
  occurredAt: Date
  correlationId: string | null
}

export interface EventBus {
  publish(ctx: EventContext, event: DomainEventInput, tx?: Tx): Promise<PublishedEvent>
  subscribe(type: string, handler: EventHandler): () => void
}

class InProcessEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>()

  async publish(ctx: EventContext, event: DomainEventInput, tx?: Tx): Promise<PublishedEvent> {
    const db: Tx = tx ?? (prismaBase as unknown as Tx)
    const row = await db.domainEvent.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId ?? null,
        type: event.type,
        version: event.version ?? 1,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload as object,
        correlationId:
          ctx.requestId && /^[0-9a-f-]{36}$/i.test(ctx.requestId) ? ctx.requestId : null,
      },
    })
    const published: PublishedEvent = {
      ...event,
      id: row.id,
      tenantId: row.tenantId,
      occurredAt: row.occurredAt,
      correlationId: row.correlationId,
    }
    // Dispatch after the caller's transaction has a chance to commit (next tick); failures are logged,
    // never propagated - a command must not depend on a subscriber (rule 5).
    setImmediate(() => void this.dispatch(published))
    return published
  }

  subscribe(type: string, handler: EventHandler): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler)
    return () => set!.delete(handler)
  }

  private async dispatch(event: PublishedEvent): Promise<void> {
    const set = this.handlers.get(event.type)
    if (!set) return
    for (const handler of set) {
      try {
        await handler(event)
      } catch (err) {
        logger.error({ err, eventId: event.id, type: event.type }, 'event handler failed')
      }
    }
  }
}

export const events: EventBus = new InProcessEventBus()
