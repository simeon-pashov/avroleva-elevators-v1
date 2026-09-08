const HEX: string[] = []
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'))

let lastMs = 0
let seq = 0

/**
 * UUID v7 (RFC 9562): 48-bit unix-ms timestamp + 12-bit sequence + 62 random bits. Time-ordered,
 * so outbox rows sort FIFO by id as well; a plain v4 would be accepted by the server too.
 * Uses crypto.getRandomValues, which (unlike randomUUID) also works outside secure contexts.
 */
export function uuidv7(): string {
  let now = Date.now()
  if (now === lastMs) seq = (seq + 1) & 0xfff
  else if (now < lastMs) now = lastMs
  else {
    lastMs = now
    seq = 0
  }
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[0] = Math.floor(now / 2 ** 40) & 0xff
  b[1] = Math.floor(now / 2 ** 32) & 0xff
  b[2] = Math.floor(now / 2 ** 24) & 0xff
  b[3] = Math.floor(now / 2 ** 16) & 0xff
  b[4] = Math.floor(now / 2 ** 8) & 0xff
  b[5] = now & 0xff
  b[6] = 0x70 | ((seq >> 8) & 0x0f)
  b[7] = seq & 0xff
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  let s = ''
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s += '-'
    s += HEX[b[i] ?? 0]
  }
  return s
}
