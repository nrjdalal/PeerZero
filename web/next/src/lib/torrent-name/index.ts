import { refineNameWithAi } from "./native-ai"
import { cleanNameFromRaw } from "./parse"
import { sanitizeDisplayName } from "./sanitize"

// Small abstraction so another local inference provider could be swapped in later without
// touching the trigger or the UI. isAvailable reflects whether ANY generation is possible;
// with the deterministic parser as the base it is always true.
export type TorrentNameGenerator = {
  isAvailable(): Promise<boolean>
  generateName(input: {
    originalName: string
    files?: { name: string; path: string }[]
  }): Promise<string | null>
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

// Parser-first, on-device-LLM-polish. The parser runs everywhere (desktop WKWebView included);
// the LLM refines the result only where the browser exposes it. Returns null when there is no
// meaningful improvement over the original name, so we never persist a redundant display name.
export const torrentNameGenerator: TorrentNameGenerator = {
  async isAvailable() {
    return true
  },
  async generateName({ originalName, files }) {
    const parsed = sanitizeDisplayName(cleanNameFromRaw(originalName))
    const ai = sanitizeDisplayName(await refineNameWithAi(originalName, files))
    const result = ai ?? parsed
    if (!result) return null
    if (normalize(result) === normalize(originalName)) return null
    return result
  },
}

export { sanitizeDisplayName } from "./sanitize"
export { parseTorrentName, cleanNameFromRaw, toDisplayName } from "./parse"
