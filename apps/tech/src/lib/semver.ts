function parts(v: string): number[] {
  return v
    .trim()
    .replace(/^v/, '')
    .split('-')[0]!
    .split('.')
    .map((p) => Number.parseInt(p, 10) || 0)
}

/** -1 / 0 / 1 like a comparator; prerelease tags are ignored. */
export function compareSemver(a: string, b: string): number {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}
