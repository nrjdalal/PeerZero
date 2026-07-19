// Shared constants for the completed-torrent fixture. The seed process writes a torrent with this
// exact deterministic content into the isolated $HOME/.peerzero + $TORRENT_DOWNLOAD_DIR; the golden
// suite recomputes the same bytes to assert /stream serves them.
export const FIXTURE_NAME = "peerzero-golden.bin"
export const FIXTURE_SIZE = 1024
export const FIXTURE_ADDED_AT = 1_700_000_000

// Deterministic content: byte i = i % 256. Tiny, so the golden .bin stays small and reviewable.
export function fixtureContent(): Buffer {
  const buf = Buffer.alloc(FIXTURE_SIZE)
  for (let i = 0; i < FIXTURE_SIZE; i++) buf[i] = i % 256
  return buf
}
