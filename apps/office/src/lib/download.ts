import { ApiError, apiUrl } from './api'
import type { Problem } from '@avroleva/contracts'

/**
 * Downloads a file from the API into the browser's download folder. A plain `<a href download>`
 * cannot be used for /api routes: every cookie-authenticated request, GET included, must carry
 * `X-Requested-With: avroleva` (csrfGuard), which only fetch() can add.
 */
export async function downloadFromApi(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(apiUrl(path), {
    headers: { 'X-Requested-With': 'avroleva' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let problem: Problem = {
      type: 'about:blank',
      title: res.statusText,
      status: res.status,
      code: 'error.internal',
    }
    try {
      if ((res.headers.get('content-type') ?? '').includes('json'))
        problem = (await res.json()) as Problem
    } catch {
      /* keep the generic problem */
    }
    throw new ApiError(res.status, problem)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** GET /exports/:dataset.csv -> `<dataset>.csv` in the download folder. */
export const downloadCsv = (dataset: string) =>
  downloadFromApi(`/exports/${dataset}.csv`, `${dataset}.csv`)
