// Adapt a Node Readable to a Web ReadableStream by hand.
//
// Bun's `Readable.toWeb()` throws `TypeError: QueuingStrategyInit.highWaterMark member is
// required` on a node stream, so the engine can't use it to build the Response body for
// /stream (a completed file would 500). This does the conversion manually and preserves
// backpressure via pause/resume, so a large media file streams without buffering the whole
// thing in memory. Kept in its own module so it can be unit-tested in isolation.
export function nodeToWebStream(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => {
        // Copy: fs read-stream chunks can share a pooled buffer that is reused before the
        // consumer reads the enqueued view.
        controller.enqueue(new Uint8Array(chunk))
        if (controller.desiredSize !== null && controller.desiredSize <= 0) nodeStream.pause()
      })
      nodeStream.once("end", () => controller.close())
      nodeStream.once("error", (err) => {
        try {
          controller.error(err)
        } catch {
          /* stream already errored/closed */
        }
      })
    },
    pull() {
      nodeStream.resume()
    },
    cancel() {
      nodeStream.destroy()
    },
  })
}
