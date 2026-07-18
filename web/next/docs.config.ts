import type { DocsConfig } from "./src/lib/docs"

const docsConfig = {
  docs: {
    "Getting Started": [
      {
        "/docs": {
          title: "Introduction",
          description: "What PeerZero is, who it's for, and how the app is laid out.",
        },
      },
      {
        "/docs/downloading": {
          title: "Downloading & transfers",
          description: "Add a torrent and manage it on the Transfers tab.",
        },
      },
    ],
    Reference: [
      {
        "/docs/troubleshooting": {
          title: "Troubleshooting",
          description: "Slow downloads, network overload, dead torrents, and other fixes.",
        },
      },
      {
        "/docs/architecture": {
          title: "How it works",
          description: "The three processes behind PeerZero and why it's built this way.",
        },
      },
    ],
  },
  console: {
    "Getting Started": [
      {
        "/console/docs": {
          title: "Introduction",
          description: "Internal documentation.",
        },
      },
    ],
  },
} satisfies DocsConfig

export default docsConfig
