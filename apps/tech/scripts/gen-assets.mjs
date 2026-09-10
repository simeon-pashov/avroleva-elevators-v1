// Renders the brand mark (assets/*.svg: a stylised "A" with an elevator arrow, office brand blue
// #1d5fd1) into the PNG sources @capacitor/assets expects, then generates the Android launcher
// icons (adaptive: foreground + background), the round/legacy icons and the splash screens into
// android/app/src/main/res. Re-run after changing the SVGs: `npm run android:assets`.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const assets = join(root, 'assets')
const BRAND = '#1d5fd1'

async function render(svgFile, pngFile, size, background) {
  const svg = readFileSync(join(assets, svgFile))
  let img = sharp(svg, { density: 300 }).resize(size, size, {
    fit: 'contain',
    background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
  })
  if (background) img = img.flatten({ background })
  await img.png().toFile(join(assets, pngFile))
  console.log(`[assets] ${pngFile} ${size}x${size}`)
}

mkdirSync(assets, { recursive: true })
// Sources (names fixed by @capacitor/assets): icon-only (legacy square, 1024), icon-foreground /
// icon-background (adaptive, 1024, the foreground keeps its safe zone), splash / splash-dark (2732).
await render('icon.svg', 'icon-only.png', 1024, BRAND)
await render('icon-foreground.svg', 'icon-foreground.png', 1024)
await render('icon-background.svg', 'icon-background.png', 1024, BRAND)
await render('splash.svg', 'splash.png', 2732, BRAND)
await render('splash.svg', 'splash-dark.png', 2732, BRAND)

const r = spawnSync(
  'npx',
  [
    '@capacitor/assets',
    'generate',
    '--android',
    '--iconBackgroundColor',
    BRAND,
    '--iconBackgroundColorDark',
    BRAND,
    '--splashBackgroundColor',
    BRAND,
    '--splashBackgroundColorDark',
    BRAND,
  ],
  { cwd: root, stdio: 'inherit', shell: true },
)
process.exit(r.status ?? 1)
