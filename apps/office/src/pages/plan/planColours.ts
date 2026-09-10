/**
 * One stable colour per plan (pair) of the day: the board column, its cards' sequence circles,
 * the map polyline and the numbered pins all index the same palette by the plan's position in
 * the board, so a colour means the same team everywhere on the page.
 */
export const PLAN_PALETTE = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#ca8a04',
  '#db2777',
] as const

/** The "Непланирани" column and its hollow map pins. */
export const UNPLANNED_COLOUR = '#9ca3af'

export function planColour(index: number): string {
  const n = PLAN_PALETTE.length
  return PLAN_PALETTE[((index % n) + n) % n] ?? PLAN_PALETTE[0]
}
