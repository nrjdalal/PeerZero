// Runner for the api-hono golden suite.
//
// 1. Make an isolated HOME + download dir (so the suite never touches the real ~/.peerzero or
//    ~/Downloads/PeerZero - the engine reads both, and os.homedir() is fixed at process start).
// 2. Seed the completed-torrent fixture into them in a separate process, before the engine boots.
// 3. Run `bun test` with that isolated env.
// 4. Clean up.
//
// Env passes down to the children at spawn time, so their os.homedir() picks up the temp HOME.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const here = import.meta.dir
const home = mkdtempSync(join(tmpdir(), "pz-golden-home-"))
const dl = mkdtempSync(join(tmpdir(), "pz-golden-dl-"))

const env = {
  ...process.env,
  HOME: home,
  TORRENT_DOWNLOAD_DIR: dl,
  NODE_ENV: "test",
  SKIP_ENV_VALIDATION: "true",
  REGISTRY_SYNC_URL: "off",
}

function cleanup() {
  for (const dir of [home, dl]) rmSync(dir, { recursive: true, force: true })
}

const seed = Bun.spawnSync(["bun", "run", join(here, "fixtures/seed.ts")], {
  cwd: here,
  env,
  stdout: "inherit",
  stderr: "inherit",
})
if (seed.exitCode !== 0) {
  cleanup()
  process.exit(seed.exitCode ?? 1)
}

const test = Bun.spawnSync(["bun", "test", ...process.argv.slice(2)], {
  cwd: here,
  env,
  stdout: "inherit",
  stderr: "inherit",
})

cleanup()
process.exit(test.exitCode ?? 1)
