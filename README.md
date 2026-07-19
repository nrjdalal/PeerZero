# PeerZero

> [!IMPORTANT]
> **For educational and personal use only.** PeerZero is a local-only tool for learning
> about BitTorrent, peer-to-peer networking, and web development. Only download content
> you are legally entitled to - Linux distributions, public-domain works, Creative Commons
> media, and files you own or have permission to share. You alone are responsible for what
> you download and for complying with copyright law where you live. The maintainers do not
> endorse or facilitate copyright infringement and will honor valid legal notices.

A local-only **BitTorrent client** in one web UI. Search, paste a magnet link, or add a
`.torrent`, and watch it download with live progress - all on your own machine. No account,
no cloud, nothing hosted.

---

## Download

Grab the desktop app for your OS from the **[latest release](https://github.com/nrjdalal/PeerZero/releases/latest)**:

| OS                    | File                         |
| --------------------- | ---------------------------- |
| macOS (Apple Silicon) | `.dmg`                       |
| macOS (Intel)         | `.dmg`                       |
| Windows               | `.exe` installer (or `.msi`) |
| Linux (Debian/Ubuntu) | `.deb`                       |

The app self-updates on new releases. Builds are unsigned for now, so first launch needs a
one-time bypass:

- **macOS:** drag `PeerZero.app` to `Applications`, then run this once (macOS quarantines
  unsigned downloads and reports them as "damaged"; this clears the flag):

  ```bash
  xattr -dr com.apple.quarantine /Applications/PeerZero.app
  ```

- **Windows:** on the SmartScreen prompt, click **More info -> Run anyway**.

Prefer to run from source instead? See below.

---

## Get started

### 1. Install the prerequisites (one-time)

Install these two yourself first - each link has a normal installer:

- **Bun** - runs the app, including the download engine · [bun.sh](https://bun.sh)
- **Node.js** - runs the dev tooling (turbo, Next.js), pick the **LTS** build · [nodejs.org](https://nodejs.org)

### 2. Get the project and start it

Open your terminal and run these, one at a time:

```bash
bunx gitpick nrjdalal/PeerZero   # download the project (no git needed)
cd PeerZero
bun install
bun run dev
```

When it's ready it prints a URL - open it in your browser:

**→ http://peerzero.localhost:1355**

Press `Ctrl+C` to stop; run `bun run dev` again to restart.

### Updating later

Re-download the latest code with `bunx gitpick nrjdalal/PeerZero`, then `bun install`. You
rarely need to - the app keeps its trackers and indexes fresh on its own in the background
(see **How updates work** below).

---

## What it does

- **Search** across public indexes from the **Search** tab, or paste a magnet link / drop a
  `.torrent`.
- **Download** with a real [WebTorrent](https://webtorrent.io) client over the normal
  TCP/uTP/DHT swarm. Pause, resume, remove, and watch live progress (speed, peers, ETA)
  stream over a WebSocket into the **Transfers** tab.
- **Stays a downloader.** Completed torrents auto-stop instead of seeding.
- **Runs entirely locally.** Nothing is uploaded to a server; downloads land in
  `~/Downloads/PeerZero` by default (change it any time in the app's Settings).

---

## How it works

Two processes start together with `bun run dev`:

| Service    | Runtime | Role                                                  |
| ---------- | ------- | ----------------------------------------------------- |
| `web/next` | Bun     | Next.js UI                                            |
| `api/hono` | Bun     | API layer + the in-process WebTorrent download engine |

The WebTorrent engine runs in-process inside the Hono API (a Bun process), so a torrent
operation is a direct function call, not an HTTP hop. WebTorrent's two Bun-incompatible native
addons are kept out of the process: WebRTC (`node-datachannel`) is neutralized by a stub plugin
(`api/hono/src/lib/torrent/webrtc-stub.mjs`, preloaded via `bunfig.toml` in dev/test and applied
at bundle time for the build) and uTP (`utp-native`) is disabled with `{ utp: false }`; both
otherwise crash Bun on an unsupported libuv function. Peers are found via the DHT plus udp/http
trackers over TCP. The engine sits behind a small typed seam
(`api/hono/src/lib/torrent/engine.ts`), so it could later be swapped for another client.

Dev URLs are named `.localhost` hosts served by [portless](https://www.npmjs.com/package/portless)
(`bunx portless list` shows them). `PORTLESS=0 bun run dev` uses plain ports instead
(web `:9410`, api `:9336`).

### How updates work

The app reads its provider/tracker/directory data from a committed, encoded **registry**
(`api/hono/src/lib/torrent/registry.json`). In the background - once at startup, then every
few hours - it refreshes that data, in order of preference:

1. **Locally**, straight from the upstream lists (freshest).
2. If those are blocked on your network, from the **canary mirror**, which a scheduled job
   keeps up to date from an unblocked environment.
3. Otherwise it keeps the last good copy it had.

All of this is non-blocking: the UI is always served instantly from the in-memory copy while
refreshes happen in the background. No git pull required to stay current.

---

## Configuration

Everything works out of the box with no config at all - the app is local-first and defaults
every setting. To tweak, set any of these as environment variables (no `.env` file needed).
Highlights:

| Variable               | Default                | What it does                                                                       |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `TORRENT_DOWNLOAD_DIR` | `~/Downloads/PeerZero` | Where finished files land (also changeable in the app's Settings)                  |
| `TORRENT_MAX_CONNS`    | `25`                   | Per-torrent connection cap (kept low to be gentle on home routers)                 |
| `REGISTRY_SYNC_URL`    | canary mirror          | Where background refresh falls back to; set to any non-URL (e.g. `off`) to disable |

See `packages/env/src` for the full list of overridable variables and their defaults.

---

Built on top of [ZeroStarter](https://zerostarter.dev).

> [!IMPORTANT]
> **Reminder:** BitTorrent is a neutral transport; how it's used is up to you. Use PeerZero
> only for content you have the legal right to download (for example Linux ISOs,
> public-domain and Creative Commons media, or files you own). You are solely responsible
> for your downloads and for obeying the law in your jurisdiction.
