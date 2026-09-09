import type { EnrollResponse } from '@avroleva/contracts'
import { clearAllData, getMeta, setMetaMany } from '../db'
import { SESSION_TOKEN_KEY, platform } from '../platform'

export function readSessionToken(): string | null {
  return platform.secureStorage.get(SESSION_TOKEN_KEY)
}

export function hasSession(): boolean {
  return !!readSessionToken()
}

/**
 * Stores a fresh device session. Re-enrolling the same firm keeps every local row and the outbox
 * (ARCHITECTURE section 4 "sessions offline"); a phone handed to a different firm starts clean.
 */
export async function saveSession(r: EnrollResponse, deviceName: string): Promise<void> {
  const previousTenant = await getMeta('tenant')
  if (previousTenant && previousTenant.id !== r.tenant.id) await clearAllData()
  platform.secureStorage.set(SESSION_TOKEN_KEY, r.token)
  await setMetaMany({
    session: { sessionId: r.sessionId, expiresAt: r.expiresAt },
    user: { id: r.user.id, name: r.user.name, role: r.user.role },
    tenant: {
      id: r.tenant.id,
      name: r.tenant.name,
      emergencyPhone: r.tenant.emergencyPhone,
      settings: {
        checkIntervalDays: r.tenant.settings.checkIntervalDays,
        callbackSlaMinutes: r.tenant.settings.callbackSlaMinutes,
        defectFollowUpDays: r.tenant.settings.defectFollowUpDays,
        minTechnicians: r.tenant.settings.minTechnicians,
      },
      features: { gpsCapture: r.tenant.features.gpsCapture },
    },
    demoMode: !!r.tenant.features.demoMode,
    deviceName,
    needsReenroll: false,
  })
}

/** Logout: wipes the local database and the token. Callers check the outbox first. */
export async function destroySession(): Promise<void> {
  platform.secureStorage.remove(SESSION_TOKEN_KEY)
  await clearAllData()
}
