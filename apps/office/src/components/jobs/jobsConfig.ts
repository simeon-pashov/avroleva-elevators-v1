import { useEffect, useState } from 'react'
import type { JobStageDto, JobsConfigDto } from '@avroleva/contracts'
import { get } from '../../lib/api'

/**
 * `GET /jobs/config` once per page load (stages, kinds, evidence kinds, settings). The stage
 * list is DATA (system defaults + tenant override): every board column, badge and action list
 * in the office renders from it, never from a hard-coded enum.
 */
let cached: Promise<JobsConfigDto> | null = null

export function loadJobsConfig(force = false): Promise<JobsConfigDto> {
  if (!cached || force) cached = get<JobsConfigDto>('/jobs/config')
  return cached
}

export function useJobsConfig(version = 0): JobsConfigDto | null {
  const [cfg, setCfg] = useState<JobsConfigDto | null>(null)
  useEffect(() => {
    let cancelled = false
    loadJobsConfig(version > 0)
      .then((c) => !cancelled && setCfg(c))
      .catch(() => !cancelled && setCfg(null))
    return () => {
      cancelled = true
    }
  }, [version])
  return cfg
}

export function stageLabel(
  stages: JobStageDto[] | undefined,
  code: string,
  locale: string,
  t: (k: string) => string,
): string {
  const s = stages?.find((x) => x.code === code)
  if (s) return locale === 'en' ? s.label.en : s.label.bg
  const key = `enum.jobStage.${code}`
  const label = t(key)
  return label === key ? code : label
}

/** Colour of a stage badge: the default codes get a meaning, custom codes are neutral. */
export function stageBadge(code: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  switch (code) {
    case 'draft':
      return 'muted'
    case 'quoted':
      return 'info'
    case 'awaiting_approval':
      return 'warn'
    case 'approved':
      return 'info'
    case 'scheduled':
      return 'info'
    case 'in_progress':
      return 'warn'
    case 'done':
      return 'ok'
    case 'invoiced':
      return 'ok'
    case 'rejected':
      return 'danger'
    case 'cancelled':
      return 'muted'
    default:
      return 'muted'
  }
}
