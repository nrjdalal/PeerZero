// Minimal static-file server for the Next.js static export. Maps clean routes to their
// exported html (/ -> index.html, /search -> search.html), serves hashed _next assets as
// they are, and falls back to index.html so a direct load of any route still boots the SPA.
import { join } from "node:path"

export async function serveStatic(pathname: string, dir: string): Promise<Response> {
  // For a clean route (no extension) the exported file is `${route}.html` or
  // `${route}/index.html` - never the bare path, which would match the route's directory
  // and hang when streamed. Assets carry an extension and are served as-is.
  const rel = pathname === "/" ? "/index.html" : pathname
  const candidates = rel.includes(".") ? [rel] : [`${rel}.html`, `${rel}/index.html`]
  for (const candidate of candidates) {
    const file = Bun.file(join(dir, candidate))
    if (await file.exists()) return new Response(file)
  }
  return new Response(Bun.file(join(dir, "index.html")), {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}
