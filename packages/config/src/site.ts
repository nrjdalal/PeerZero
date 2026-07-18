// Brand identity for this app: the single source a fork edits to rebrand. web reads it via lib/config.ts.
export const site = {
  name: "PeerZero",
  description: "A local-only BitTorrent client in one web UI, with live download progress.",
  tagline: "Local BitTorrent downloads.",
  social: {
    github: "https://github.com/nrjdalal/PeerZero",
    x: "",
    discord: "",
  },
  // Injectable long-form text block for the OpenAPI reference. A product sets its own, or leaves it empty.
  apiReferenceDescription: "",
} as const

export type Site = typeof site

// Optional surfaces a fork enables or disables. Typed boolean (not `as const`) so a fork can flip them and the runtime gates are not dead code. Off means the route 404s. apiDocs gates the OpenAPI document and the Scalar reference UI.
export const features = {
  apiDocs: false,
}

export type Feature = keyof typeof features
