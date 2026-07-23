import { channelColor } from "@/lib/channel"
import { cn } from "@/lib/utils"

// The PeerZero "0" brand mark. Inlined (the brand colors are part of the mark, like
// an OG image) so it renders crisply with no asset request. The rounded border
// (matching the tile's 22.5% corner radius) keeps the tile legible against the navbar
// in both themes. The tile background is tinted per build channel (channelColor):
// near-black on stable, amber on canary, blue on a local/dev build - so which build
// you're running is obvious, matching env.style's per-environment favicon tint.
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn("rounded-[22.5%] border", className)}
      role="img"
      aria-label="PeerZero"
    >
      <rect width="512" height="512" rx="115" fill={channelColor} />
      <svg x="163" y="106" width="186" height="300" viewBox="27 48 186 300">
        <path
          fill="#fafafa"
          d="M120 348L120 348Q91.6 348 70.8 337.2Q50 326.4 38.6 306.8Q27.2 287.2 27.2 260.8L27.2 260.8L27.2 135.2Q27.2 108.8 38.6 89.2Q50 69.6 70.8 58.8Q91.6 48 120 48L120 48Q148.8 48 169.4 58.8Q190 69.6 201.4 89.2Q212.8 108.8 212.8 135.2L212.8 135.2L212.8 260.8Q212.8 287.2 201.4 306.8Q190 326.4 169.2 337.2Q148.4 348 120 348ZM120 304.8L120 304.8Q140.8 304.8 153.2 292.8Q165.6 280.8 165.6 260.8L165.6 260.8L165.6 135.2Q165.6 115.2 153.2 103.2Q140.8 91.2 120 91.2L120 91.2Q99.2 91.2 86.8 103.2Q74.4 115.2 74.4 135.2L74.4 135.2L74.4 260.8Q74.4 280.8 86.8 292.8Q99.2 304.8 120 304.8ZM120 224L120 224Q108.4 224 101 216.4Q93.6 208.8 93.6 196.8L93.6 196.8Q93.6 184.8 100.8 177.6Q108 170.4 120 170.4L120 170.4Q132 170.4 139.2 177.6Q146.4 184.8 146.4 196.8L146.4 196.8Q146.4 208.8 139.2 216.4Q132 224 120 224Z"
        />
      </svg>
    </svg>
  )
}
