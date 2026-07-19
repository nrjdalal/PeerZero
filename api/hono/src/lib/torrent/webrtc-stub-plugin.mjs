// Shared Bun plugin that neutralizes WebRTC so webtorrent runs under Bun.
//
// webtorrent statically imports `@thaunknown/simple-peer/lite.js` -> `webrtc-polyfill`,
// which loads the `node-datachannel` native addon; that addon calls the libuv function
// `uv_timer_init`, which Bun does not implement, and the process hard-crashes
// (https://github.com/oven-sh/bun/issues/18546). WebRTC is only used to reach wss/browser
// swarms; a local client finds peers via the DHT plus udp/http trackers over TCP, so
// replacing webrtc-polyfill with inert stubs removes the crash without losing any real
// peer connectivity. The stub classes are only referenced when a WebRTC peer is
// constructed (which never happens here), so importing them is free.
//
// Used two ways: as a runtime preload (webrtc-stub.mjs, for `bun run`/`bun start`) and as
// a build-time plugin (scripts/build-binary.mjs). The build path needs it explicitly
// because `bun build --compile` does NOT apply bunfig `preload` plugins; without it the
// compiled binary bundles node_datachannel and dies at boot with
// "Cannot find module '.../node_datachannel.node'".

const CONTENTS = `
  class RTCPeerConnection { constructor() { throw new Error("WebRTC unavailable under Bun (webrtc-polyfill stubbed)") } }
  class RTCSessionDescription {}
  class RTCIceCandidate {}
  class RTCIceTransport {}
  class RTCDataChannel {}
  class RTCSctpTransport {}
  class RTCDtlsTransport {}
  class RTCCertificate {}
  class MediaStream {}
  class MediaStreamTrack {}
  class RTCDataChannelEvent {}
  class RTCPeerConnectionIceEvent {}
  class RTCTrackEvent {}
  class RTCRtpTransceiver {}
  class RTCError {}
  export {
    RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, RTCIceTransport,
    RTCDataChannel, RTCSctpTransport, RTCDtlsTransport, RTCCertificate,
    MediaStream, MediaStreamTrack, RTCDataChannelEvent, RTCPeerConnectionIceEvent,
    RTCTrackEvent, RTCRtpTransceiver, RTCError
  }
  export default {}
`

// Inert stand-in for node-datachannel's native-addon module. Any property is another inert
// (chainable), constructing yields {}, and calling is a no-op - enough for webtorrent to import
// the WebRTC surface without ever loading the .node binary (WebRTC peers are never constructed).
const NDC_CONTENTS = `
  const noop = function () {}
  const inert = new Proxy(noop, {
    get: (_t, key) => (key === "then" ? undefined : inert),
    construct: () => ({}),
    apply: () => undefined,
  })
  export default inert
`

export const webrtcStubPlugin = {
  name: "stub-webrtc-polyfill",
  setup(build) {
    // Bundler path (bun build --compile): the bare `webrtc-polyfill` specifier resolves here.
    build.onResolve({ filter: /^webrtc-polyfill$/ }, () => ({
      path: "webrtc-polyfill",
      namespace: "wrtc-stub",
    }))
    build.onLoad({ filter: /.*/, namespace: "wrtc-stub" }, () => ({
      loader: "js",
      contents: CONTENTS,
    }))
    // Runtime path (bun preload): Bun does NOT fire onResolve for the bare `webrtc-polyfill`
    // import, but it DOES for node-datachannel's own `./node-datachannel.mjs` (the module that
    // require()s the .node binary). Stub that directly so the addon is never loaded - the binary
    // is absent under `bun install --ignore-scripts` (CI), and loading it crashes Bun anyway.
    build.onResolve({ filter: /node-datachannel\.mjs$/ }, (args) => ({
      path: args.path,
      namespace: "ndc-stub",
    }))
    build.onLoad({ filter: /.*/, namespace: "ndc-stub" }, () => ({
      loader: "js",
      contents: NDC_CONTENTS,
    }))
  },
}

export default webrtcStubPlugin
