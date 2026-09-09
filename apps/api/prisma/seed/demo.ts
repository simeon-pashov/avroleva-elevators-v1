import { prismaBase as db } from '../../src/platform/db/prisma.js'
import { newId } from '../../src/platform/ids.js'
import { hashPassword } from '../../src/modules/tenancy/index.js'
import { generateDemoData } from '../../src/demo/generator.js'

/**
 * Demo tenant seed (SEED_DEMO=true): the firm, its three users and the demo-friendly settings
 * (bank details for the invoices / EPC QR, public QR page, alarm-test cadence, demoMode). The
 * registry and the year of operational data come from the one demo-data generator in
 * apps/api/src/demo (ADR 0001 section 6) - the same code the platform admin's button and the
 * nightly demo reset run. Idempotent: the generator skips a tenant that already has data.
 */
export const DEMO = {
  tenant: { name: 'Демо Лифт Сервиз', eik: '200000001' },
  users: [
    { username: 'demo', password: 'demo1234', name: 'Димитър Стоянов', role: 'owner' as const },
    { username: 'maria', password: 'demo1234', name: 'Мария Георгиева', role: 'office' as const },
    { username: 'ivan', password: 'demo1234', name: 'Иван Петров', role: 'technician' as const },
    { username: 'petar', password: 'demo1234', name: 'Петър Илиев', role: 'technician' as const },
  ],
}

const DEMO_SETTINGS = {
  checkIntervalDays: 30,
  cycleStrategy: 'rolling',
  callbackSlaMinutes: 60,
  defectFollowUpDays: 30,
  showBgnReference: true,
  currencyDisplay: 'EUR_BGN',
  alarmTestIntervalMonths: 6,
  billing: {
    runDay: 1,
    runEnabled: true,
    dueDays: 14,
    bank: {
      beneficiary: 'Демо Лифт Сервиз ЕООД',
      iban: 'BG80BNBG96611020345678',
      bic: 'BNBGBGSD',
      bankName: 'Българска народна банка (демо)',
    },
    paymentProvider: 'demo',
    showPaymentOnPublicPage: true,
  },
  // Step 9: where the day plan starts from and the simple ETA model.
  planning: {
    baseAddress: 'София, ул. Индустриална 11',
    baseLat: 42.6605,
    baseLng: 23.3746,
    avgStopMinutes: 25,
    avgSpeedKmh: 25,
    dayStart: '08:30',
  },
}

const DEMO_FEATURES = {
  publicQrPage: true,
  publicFaultReport: true,
  gpsCapture: false,
  demoMode: true,
}

export async function seedDemoTenant(): Promise<{
  counts: Record<string, number>
  tenantId: string
}> {
  const counts: Record<string, number> = { users: 0 }
  let tenant = await db.tenant.findFirst({ where: { eik: DEMO.tenant.eik } })
  if (!tenant) {
    tenant = await db.tenant.create({
      data: {
        id: newId(),
        name: DEMO.tenant.name,
        eik: DEMO.tenant.eik,
        address: 'София, ул. Индустриална 11',
        phone: '02 999 1234',
        emergencyPhone: '0700 12 345',
        email: 'office@demolift.example',
        locale: 'bg',
        settings: DEMO_SETTINGS,
        features: DEMO_FEATURES,
      },
    })
  } else {
    // Settings merge keeps whatever the owner changed and (re)applies the demo defaults below it.
    const settings = { ...DEMO_SETTINGS, ...(tenant.settings as object) }
    const billing = {
      ...DEMO_SETTINGS.billing,
      ...((tenant.settings as { billing?: object }).billing ?? {}),
    }
    const features = { ...DEMO_FEATURES, ...(tenant.features as object) }
    await db.tenant.update({
      where: { id: tenant.id },
      data: { settings: { ...settings, billing }, features },
    })
  }
  const tenantId = tenant.id

  for (const u of DEMO.users) {
    const existing = await db.user.findUnique({ where: { username: u.username } })
    if (!existing) {
      await db.user.create({
        data: {
          id: newId(),
          tenantId,
          username: u.username,
          passwordHash: await hashPassword(u.password),
          name: u.name,
          role: u.role,
          phone: null,
        },
      })
      counts.users!++
    }
  }

  const generated = await generateDemoData(tenantId, { months: 12 })
  Object.assign(counts, generated.counts)
  return { counts, tenantId }
}
