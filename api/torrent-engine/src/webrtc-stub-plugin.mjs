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

export const webrtcStubPlugin = {
  name: "stub-webrtc-polyfill",
  setup(build) {
    build.onResolve({ filter: /^webrtc-polyfill$/ }, () => ({
      path: "webrtc-polyfill",
      namespace: "wrtc-stub",
    }))
    build.onLoad({ filter: /.*/, namespace: "wrtc-stub" }, () => ({
      loader: "js",
      contents: CONTENTS,
    }))
  },
}

export default webrtcStubPlugin
