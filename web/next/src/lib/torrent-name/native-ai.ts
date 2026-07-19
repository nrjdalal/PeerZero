// On-device language-model refinement via the browser's built-in Prompt API (Chrome's
// Gemini Nano). Pure enhancement over the deterministic parser: present in Chromium (the web
// app), absent in the desktop WKWebView. Nothing leaves the device - no keys, no network, no
// cloud fallback. Feature-detected per the spec; we never assume `LanguageModel` exists.

type Availability = "available" | "downloadable" | "downloading" | "unavailable"

type LanguageModelSession = {
  prompt(input: string): Promise<string>
  destroy?(): void
}

type LanguageModelStatic = {
  availability(): Promise<Availability>
  create(options?: {
    initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[]
  }): Promise<LanguageModelSession>
}

function getApi(): LanguageModelStatic | null {
  const g = globalThis as unknown as { LanguageModel?: LanguageModelStatic }
  return typeof g.LanguageModel?.availability === "function" ? g.LanguageModel : null
}

const SYSTEM_PROMPT = [
  "You clean raw torrent/release file names into a short, human-readable title.",
  "Rules:",
  "- Reply with ONLY the final name. No quotes, no markdown, no explanation, no prefix.",
  "- Remove release-group tags, tracker/site tags, and filename clutter.",
  "- Turn separators (dots, underscores, excessive hyphens) into normal spacing.",
  "- Preserve meaningful product, media, and project names.",
  "- Preserve years, versions, editions, resolution, and language when genuinely part of the content.",
  "- Never invent or add information that is not in the input.",
  "- Keep it concise and on a single line.",
].join("\n")

function buildPrompt(originalName: string, files?: { name: string }[]): string {
  let p = `Clean this name:\n${originalName}`
  const sample = files?.slice(0, 5).map((f) => f.name)
  if (sample?.length) {
    p += `\n\nContained files (context only, do not list them):\n${sample.join("\n")}`
  }
  return p
}

let downloadKicked = false
// Start the one-time on-device model download (when the browser offers it) so later torrents
// can be AI-refined. Fire-and-forget; the first torrents get parser-only names in the meantime.
async function kickDownload(api: LanguageModelStatic) {
  if (downloadKicked) return
  downloadKicked = true
  try {
    const s = await api.create()
    s.destroy?.()
  } catch {
    /* download unavailable in this context; the parser still handles naming */
  }
}

// Returns a refined title, or null when the on-device model is absent/not-ready/errors - in
// which case the caller falls back to the deterministic parser result.
export async function refineNameWithAi(
  originalName: string,
  files?: { name: string }[],
): Promise<string | null> {
  const api = getApi()
  if (!api) return null
  try {
    const avail = await api.availability()
    if (avail === "unavailable") return null
    if (avail !== "available") {
      void kickDownload(api)
      return null // not ready yet; the parser result stands for now
    }
    const session = await api.create({
      initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
    })
    const out = await session.prompt(buildPrompt(originalName, files))
    session.destroy?.()
    return out
  } catch {
    return null
  }
}
