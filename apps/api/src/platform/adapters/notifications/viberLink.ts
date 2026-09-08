import type { ViberLink, ViberLinker } from '../../ports/notifications.js'

/** "+359 888 123 456", "0888123456", "00359…" -> "359888123456" (Bulgarian default country code). */
export function viberDigits(phone: string, defaultCountry = '359'): string {
  let d = phone.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = defaultCountry + d.slice(1)
  return d
}

/**
 * Deep-link mode (ARCHITECTURE section 6, "viberLink"): nothing is sent by the server. The office
 * user taps `forwardUrl` (text prefilled, picks the contact) or `chatUrl` (opens the chat) on a
 * device with Viber, or `webUrl` from a desktop browser; the text is shown next to a copy button.
 */
export function buildViberLink(phone: string, text: string): ViberLink {
  const digits = viberDigits(phone)
  const number = `+${digits}`
  return {
    number,
    chatUrl: `viber://chat?number=${encodeURIComponent(number)}`,
    forwardUrl: `viber://forward?text=${encodeURIComponent(text)}`,
    webUrl: `https://viber.click/${digits}`,
    text,
  }
}

export const viberLinker: ViberLinker = { name: 'viber_link', build: buildViberLink }
