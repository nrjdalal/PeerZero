// webtorrent ships no type declarations (the engine imports it from an untyped .mjs). The seed
// fixture only constructs a client and calls seed()/destroy(), so an `any` shim is enough for the
// type-check pass.
declare module "webtorrent" {
  const WebTorrent: new (opts?: unknown) => any
  export default WebTorrent
}
