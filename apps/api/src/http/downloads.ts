import { Router } from 'express'
import type { Request, Response } from 'express'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import QRCode from 'qrcode'
import { config } from '../platform/config.js'
import { urls } from '../platform/urls.js'
import { esc, page } from './templates/html.js'

/**
 * Sideloading page of the native technician app (step 10). The deploy step copies the signed
 * release APK to `DATA_DIR/releases/tech.apk` (docs/ANDROID-RELEASE.md); nothing is committed
 * to git and no build happens on the server. `GET /downloads/` is a small Bulgarian page with the
 * install steps and a QR of the download URL (the owner opens it on the office screen, the
 * technician scans it); `GET /downloads/tech.apk` streams the file with the Android MIME type,
 * 404 when no APK has been uploaded yet. No login: the APK is a public artefact, the data is not.
 */
export const APK_MIME = 'application/vnd.android.package-archive'
export const APK_FILE_NAME = 'tech.apk'

export function apkPath(): string {
  return resolve(config.DATA_DIR, 'releases', APK_FILE_NAME)
}

function apkInfo(): { size: number; mtime: Date } | null {
  const p = apkPath()
  if (!existsSync(p)) return null
  const st = statSync(p)
  return { size: st.size, mtime: st.mtime }
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('bg-BG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(d)
}

const CSS = `
  .box { max-width: 560px; margin: 0 auto; padding: 24px 16px; }
  .qr { width: 220px; height: 220px; margin: 16px auto; }
  .qr svg { width: 100%; height: 100%; }
  .btn { display: block; text-align: center; background: #1d5fd1; color: #fff; text-decoration: none;
         padding: 14px 20px; border-radius: 10px; font-size: 18px; font-weight: 600; margin: 16px 0; }
  .btn.off { background: #9aa3b2; pointer-events: none; }
  ol li { margin: 8px 0; }
  .muted { color: #5b6470; font-size: 14px; }
  code { background: #eef2f8; padding: 2px 5px; border-radius: 4px; }
`

async function render(): Promise<string> {
  const info = apkInfo()
  const url = `${urls.base()}/downloads/${APK_FILE_NAME}`
  const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  const status = info
    ? `<p class="muted">Файл: <code>${esc(APK_FILE_NAME)}</code> · ${esc(formatSize(info.size))} · качен на ${esc(formatDate(info.mtime))}</p>`
    : `<p class="muted"><strong>Все още няма качено приложение.</strong> Офисът трябва да качи файла на сървъра (вж. docs/ANDROID-RELEASE.md).</p>`
  const body = `
<div class="box">
  <h1>Avroleva Elevators – приложение за Android</h1>
  <p>Приложението за монтьори работи и без интернет: записва посещенията на телефона и ги изпраща, когато има връзка. Инсталира се от файл (APK), не през Google Play.</p>
  <a class="btn${info ? '' : ' off'}" href="${esc(url)}" download="${esc(APK_FILE_NAME)}">Изтегли приложението</a>
  ${status}
  <div class="qr">${qr}</div>
  <p class="muted" style="text-align:center">Сканирайте кода с камерата на телефона, за да изтеглите файла направо там.<br><code>${esc(url)}</code></p>
  <h2>Как се инсталира</h2>
  <ol>
    <li>Отворете тази страница на телефона (или сканирайте кода) и натиснете <strong>„Изтегли приложението“</strong>.</li>
    <li>Когато изтеглянето приключи, отворете файла <code>tech.apk</code> от известията или от папка „Изтегляния“ (Downloads).</li>
    <li>Ако телефонът попита <em>„Инсталирането от този източник не е разрешено“</em> – натиснете <strong>„Настройки“</strong>, включете <strong>„Разрешаване от този източник“</strong> за браузъра и се върнете назад.</li>
    <li>Натиснете <strong>„Инсталиране“</strong>. При предупреждение от Play Protect изберете <strong>„Инсталирай въпреки това“</strong> (приложението не е в Google Play).</li>
    <li>Отворете <strong>Avroleva Elevators</strong>. Поискайте от офиса код за свързване („Потребители“ → „Свържи телефон“) и го сканирайте – адресът на сървъра се попълва сам.</li>
  </ol>
  <h2>Нова версия</h2>
  <p>Инсталира се по същия начин върху старата – данните и чакащите записи на телефона се запазват. Ако инсталирането откаже с „приложението не е инсталирано“, старата версия е подписана с друг ключ: първо изпратете чакащите записи, после я деинсталирайте.</p>
</div>`
  return page({
    title: 'Avroleva Elevators – приложение за Android',
    body,
    css: CSS,
    robots: 'noindex',
  })
}

export const downloadsRouter = Router()

downloadsRouter.get(/^\/?$/, async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache')
  res.type('html').send(await render())
})

downloadsRouter.get(`/${APK_FILE_NAME}`, (_req: Request, res: Response) => {
  const p = apkPath()
  if (!existsSync(p)) {
    res.status(404)
    res.setHeader('Cache-Control', 'no-cache')
    return res.type('html').send(
      page({
        title: 'Няма качено приложение',
        body: `<div class="box"><h1>Няма качено приложение</h1><p>Файлът <code>${esc(APK_FILE_NAME)}</code> още не е качен на сървъра. <a href="${esc(urls.base())}/downloads/">Назад</a></p></div>`,
        css: CSS,
        robots: 'noindex',
      }),
    )
  }
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Content-Type', APK_MIME)
  res.setHeader('Content-Disposition', `attachment; filename="${APK_FILE_NAME}"`)
  res.sendFile(p, { headers: { 'Content-Type': APK_MIME } })
})
