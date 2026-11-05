/**
 * Client hash of a member password, for `OrgMember.password` and `AuthRequest.password`.
 * Throws on an empty password after trim+NFC: hashing '' gives a guessable credential, so omit the field instead.
 * Throws on an address that is not 0x + 40 hex: the hash would never match at login.
 */
export async function hashMemberPassword(orgAddress: string, password: string): Promise<string> {
  const org = '0x' + orgAddress.toLowerCase().replace(/^0x/, '')
  if (!/^0x[0-9a-f]{40}$/.test(org)) throw new Error(`not an organization address: ${orgAddress}`)
  const pw = password.trim().normalize('NFC')
  if (!pw) throw new Error('empty password')
  const data = new TextEncoder().encode(`vocdoni-member-password:${org}:${pw}`)
  // browsers expose crypto.subtle only in secure contexts (https or localhost)
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('hashMemberPassword needs Web Crypto (a secure context)')
  const digest = await subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
