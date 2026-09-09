import { newId } from '../ids.js'
import { logger } from '../logger.js'
import { clock } from '../clock.js'
import { prismaBase } from '../db/prisma.js'
import type { Tx } from '../db/prisma.js'
import { bossRunning, enqueue } from '../jobs/boss.js'
import { defineJob } from '../jobs/registry.js'

/**
 * Event bus (ARCHITECTURE A8, D8). The event row is persisted to `domain_event` in the caller's
 * transaction (the outbox); delivery to each subscribed handler is one pg-boss job per
 * (eventId, handler) with retries, recorded in `event_delivery` so a redelivery never runs a
 * handler twice. With the queue disabled (tests, WORKER_ENABLED=false) the same delivery code
 * runs in-process on the next tick. `events.sweep()` (cron) re-enqueues events whose delivery
 * never happened (published while the worker was down).
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
  /** `name` identifies the handler in `event_delivery`; defaults to the function name. */
  subscribe(type: string, handler: EventHandler, name?: string): () => void
  /** True when an event of this type was already published for the aggregate (since `since`). */
  alreadyPublished(type: string, aggregateId: string, since?: Date): Promise<boolean>
  /** Last event of a type for an aggregate, or null. */
  latest(type: string, aggregateId: string): Promise<PublishedEvent | null>
  /** Re-enqueues deliveries missing for events of the last `hours` (outbox catch-up). */
  sweep(hours?: number): Promise<{ enqueued: number }>
  /**
   * Marks every event of a tenant as delivered to the given handlers without running them
   * (seeds write history, not news: nothing in it should reach an inbox). Returns rows written.
   */
  acknowledge(
    tenantId: string,
    handlers: ReadonlyArray<{ type: string; name: string }>,
  ): Promise<number>
  /**
   * Runs `fn` with dispatch suppressed: events are still written to `domain_event` (history,
   * dedupe) but no handler is enqueued. The demo-data generator uses it and then acknowledges
   * the tenant's events, so a year of generated history never reaches an inbox or an SMTP server.
   */
  runQuiet<T>(fn: () => Promise<T>): Promise<T>
}

export const MAX_DELIVERY_ATTEMPTS = 5
export const DISPATCH_JOB = 'events.dispatch'

interface Subscription {
  name: string
  handler: EventHandler
}

class OutboxEventBus implements EventBus {
  private handlers = new Map<string, Subscription[]>()
  private anon = 0
  private quiet = 0

  async runQuiet<T>(fn: () => Promise<T>): Promise<T> {
    this.quiet++
    try {
      return await fn()
    } finally {
      this.quiet--
    }
  }

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
    // Dispatch after the caller's transaction has a chance to commit (next tick). With pg-boss the
    // job may still run before the commit lands: the dispatcher then finds no row and retries.
    if (this.quiet === 0) setImmediate(() => void this.dispatch(published))
    return published
  }

  subscribe(type: string, handler: EventHandler, name?: string): () => void {
    const list = this.handlers.get(type) ?? []
    const sub: Subscription = {
      name: name ?? (handler.name || `handler${++this.anon}`),
      handler,
    }
    if (list.some((s) => s.name === sub.name))
      throw new Error(`handler ${sub.name} already subscribed to ${type}`)
    list.push(sub)
    this.handlers.set(type, list)
    return () => {
      const i = list.indexOf(sub)
      if (i >= 0) list.splice(i, 1)
    }
  }

  handlerNames(type: string): string[] {
    return (this.handlers.get(type) ?? []).map((s) => s.name)
  }

  async alreadyPublished(type: string, aggregateId: string, since?: Date): Promise<boolean> {
    const row = await prismaBase.domainEvent.findFirst({
      where: { type, aggregateId, ...(since ? { occurredAt: { gte: since } } : {}) },
      select: { id: true },
    })
    return row !== null
  }

  async latest(type: string, aggregateId: string): Promise<PublishedEvent | null> {
    const row = await prismaBase.domainEvent.findFirst({
      where: { type, aggregateId },
      orderBy: { occurredAt: 'desc' },
    })
    return row ? rowToEvent(row) : null
  }

  private async dispatch(event: PublishedEvent): Promise<void> {
    for (const name of this.handlerNames(event.type)) {
      try {
        if (bossRunning()) {
          await enqueue(DISPATCH_JOB, { eventId: event.id, type: event.type, handler: name })
        } else {
          await this.deliver(event.id, name, event)
        }
      } catch (err) {
        logger.error({ err, eventId: event.id, handler: name }, 'event dispatch failed')
      }
    }
  }

  /**
   * Runs one handler for one event exactly once: the `event_delivery` row is the lock. Throws on
   * handler failure (when pg-boss runs it) so the job is retried; attempts and the last error are
   * recorded either way.
   */
  async deliver(eventId: string, handlerName: string, known?: PublishedEvent): Promise<void> {
    const existing = await prismaBase.eventDelivery.findUnique({
      where: { eventId_handler: { eventId, handler: handlerName } },
    })
    if (existing?.status === 'done') return
    const event = known ?? (await this.load(eventId))
    if (!event) throw new Error(`event ${eventId} not found (not committed yet?)`)
    const sub = (this.handlers.get(event.type) ?? []).find((s) => s.name === handlerName)
    if (!sub) {
      logger.warn({ eventId, handler: handlerName, type: event.type }, 'no such handler; skipping')
      return
    }
    const attempts = (existing?.attempts ?? 0) + 1
    await prismaBase.eventDelivery.upsert({
      where: { eventId_handler: { eventId, handler: handlerName } },
      create: { eventId, handler: handlerName, status: 'pending', attempts: 1 },
      update: { attempts },
    })
    try {
      await sub.handler(event)
      await prismaBase.eventDelivery.update({
        where: { eventId_handler: { eventId, handler: handlerName } },
        data: { status: 'done', processedAt: clock.now(), lastError: null },
      })
    } catch (err) {
      await prismaBase.eventDelivery.update({
        where: { eventId_handler: { eventId, handler: handlerName } },
        data: {
          status: attempts >= MAX_DELIVERY_ATTEMPTS ? 'failed' : 'pending',
          lastError: String((err as Error)?.message ?? err).slice(0, 2000),
        },
      })
      logger.error({ err, eventId, handler: handlerName, attempts }, 'event handler failed')
      if (bossRunning()) throw err
    }
  }

  async load(eventId: string): Promise<PublishedEvent | null> {
    const row = await prismaBase.domainEvent.findUnique({ where: { id: eventId } })
    return row ? rowToEvent(row) : null
  }

  async sweep(hours = 24): Promise<{ enqueued: number }> {
    const since = new Date(clock.now().getTime() - hours * 3600_000)
    const types = [...this.handlers.keys()]
    if (types.length === 0) return { enqueued: 0 }
    const rows = await prismaBase.domainEvent.findMany({
      where: { occurredAt: { gte: since }, type: { in: types } },
      select: { id: true, type: true },
    })
    if (rows.length === 0) return { enqueued: 0 }
    const deliveries = await prismaBase.eventDelivery.findMany({
      where: { eventId: { in: rows.map((r) => r.id) } },
      select: { eventId: true, handler: true },
    })
    const seen = new Set(deliveries.map((d) => `${d.eventId}|${d.handler}`))
    let enqueued = 0
    for (const r of rows) {
      for (const name of this.handlerNames(r.type)) {
        if (seen.has(`${r.id}|${name}`)) continue
        await enqueue(DISPATCH_JOB, { eventId: r.id, type: r.type, handler: name })
        enqueued++
      }
    }
    return { enqueued }
  }

  async acknowledge(
    tenantId: string,
    handlers: ReadonlyArray<{ type: string; name: string }>,
  ): Promise<number> {
    const byType = new Map<string, string[]>()
    for (const h of handlers) byType.set(h.type, [...(byType.get(h.type) ?? []), h.name])
    if (byType.size === 0) return 0
    const rows = await prismaBase.domainEvent.findMany({
      where: { tenantId, type: { in: [...byType.keys()] } },
      select: { id: true, type: true },
    })
    const data = rows.flatMap((r) =>
      (byType.get(r.type) ?? []).map((handler) => ({
        eventId: r.id,
        handler,
        status: 'done' as const,
        attempts: 0,
        processedAt: clock.now(),
        lastError: 'acknowledged without delivery (seed)',
      })),
    )
    if (data.length === 0) return 0
    const res = await prismaBase.eventDelivery.createMany({ data, skipDuplicates: true })
    return res.count
  }
}

function rowToEvent(row: {
  id: string
  tenantId: string | null
  type: string
  version: number
  aggregateType: string
  aggregateId: string
  payload: unknown
  occurredAt: Date
  correlationId: string | null
}): PublishedEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    version: row.version,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    occurredAt: row.occurredAt,
    correlationId: row.correlationId,
  }
}

const bus = new OutboxEventBus()
export const events: EventBus = bus

/** Exposed for the dispatcher job and tests. */
export const eventDelivery = {
  deliver: (eventId: string, handler: string) => bus.deliver(eventId, handler),
  handlerNames: (type: string) => bus.handlerNames(type),
}

defineJob<{ eventId: string; type: string; handler: string }>({
  name: DISPATCH_JOB,
  description: 'Delivers one domain event to one subscriber (idempotent per event + handler).',
  retryLimit: MAX_DELIVERY_ATTEMPTS,
  retryDelaySeconds: 5,
  expireInSeconds: 120,
  handler: async (data) => {
    await bus.deliver(data.eventId, data.handler)
    return { eventId: data.eventId, handler: data.handler }
  },
})
