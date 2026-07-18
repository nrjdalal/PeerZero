// Reversible obfuscation (in-repo key, not secrecy) so provider names stay out of the
// repo as searchable plaintext. Deterministic + hex so unchanged input skips a commit.

import { createCipheriv, createDecipheriv, createHash } from "node:crypto"

const KEY_MATERIAL = "peerzero:registry:v1"
const KEY = createHash("sha256").update(KEY_MATERIAL).digest()
const IV = createHash("sha256").update(`${KEY_MATERIAL}:iv`).digest().subarray(0, 16)

export function seal(plaintext: string): string {
  const cipher = createCipheriv("aes-256-cbc", KEY, IV)
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("hex")
}

export function unseal(blob: string): string | null {
  try {
    const decipher = createDecipheriv("aes-256-cbc", KEY, IV)
    return Buffer.concat([decipher.update(Buffer.from(blob, "hex")), decipher.final()]).toString(
      "utf8",
    )
  } catch {
    return null
  }
}
