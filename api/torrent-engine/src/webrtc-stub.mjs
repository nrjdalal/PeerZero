// Bun preload: neutralize WebRTC so the engine runs under Bun.
//
// webtorrent statically imports `@thaunknown/simple-peer/lite.js`, which imports
// `webrtc-polyfill`, which loads the `node-datachannel` native addon. That addon
// calls the libuv function `uv_timer_init`, which Bun does not implement yet, and
// the process hard-crashes (panic: "unsupported uv function: uv_timer_init",
// see https://github.com/oven-sh/bun/issues/18546).
//
// WebRTC is only used to reach wss/browser swarms. A local client finds peers via
// the DHT plus udp/http trackers and connects over TCP, so replacing webrtc-polyfill
// with inert stubs removes the crash without losing any real peer connectivity. The
// stub classes are only ever referenced when a WebRTC peer is constructed (which never
// happens here), so importing them is free.
//
// The other native addon webtorrent can pull in, `utp-native`, crashes Bun the same
// way; it is disabled separately via `{ utp: false }` in the client options (index.mjs).
import { plugin } from "bun"

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

plugin({
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
})
