// Wires up the libopus.wasm decoder Phase 1 decided to reuse (see docs/
// WEBCLIENT_V2_REBUILD_PLAN.md's Phase 1 findings and connection/README.md
// item 3) - the same pattern videoDecoder.js already applied to
// ffmpeg-core.wasm: reuse the legacy bundle's own prebuilt WASM binary
// rather than standing up an Opus-to-WASM cross-compile toolchain, which
// is well outside this project's scope.
//
// libopus.js is a plain Emscripten-compiled classic Worker script (not an
// ES module like ffmpeg.js) - confirmed by reading its own tail
// (resources/web/libopus.js): `self.addEventListener('message', ...)` is
// baked directly into the file, with a deliberately simple protocol, not
// the id-keyed request/response RPC ffmpeg.js uses:
//   postMessage({channels, sampleRate}) -> (re)creates the decoder
//   postMessage(opusPacketBytes, [transferable]) -> decodes one packet;
//     the worker replies with the raw Int16Array of decoded PCM samples
//     (interleaved if stereo), no id/type envelope at all.
// It also resolves its own libopus.wasm via `self.location.href` (a
// classic-worker Emscripten convention), so the only requirement is that
// libopus.wasm sits next to libopus.js wherever this is loaded from - see
// Rustdesk-Server-Installer/lib.sh's build_flutter_engine(), which copies
// both alongside the ffmpeg-core.wasm files it already vendors.
//
// The player half (decoded Int16 PCM -> actually audible sound) is a
// small hand-written port of the legacy bundle's own player (confirmed
// via resources/web/js/dist/index.js: `os(channels, sampleRate) { return
// new Sn({channels, sampleRate, flushingTime: 2000}) }` - Sn being a
// bundled copy of the well-known open-source `pcm-player` library, not
// custom protocol logic worth reverse-engineering byte-for-byte). This
// reimplements that same well-known algorithm directly against the Web
// Audio API instead of adding a new npm dependency for ~40 lines of
// straightforward buffer-queuing: convert each Int16 chunk to Float32,
// wrap it in an AudioBuffer, and schedule it to play back-to-back by
// tracking the running "next start time" against the AudioContext's own
// clock (falling forward to "now" if playback ever falls behind, so a
// network hiccup doesn't pile up a growing backlog of delayed audio).
class PcmPlayer {
  constructor (channels, sampleRate) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    this.ctx = new AudioContextCtor({ sampleRate })
    this.channels = channels
    this.nextStartTime = 0
  }

  feed (int16Samples) {
    const frameCount = int16Samples.length / this.channels
    const buffer = this.ctx.createBuffer(this.channels, frameCount, this.ctx.sampleRate)
    for (let ch = 0; ch < this.channels; ch++) {
      const channelData = buffer.getChannelData(ch)
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = int16Samples[i * this.channels + ch] / 32768
      }
    }
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.ctx.destination)
    const now = this.ctx.currentTime
    if (this.nextStartTime < now) this.nextStartTime = now
    source.start(this.nextStartTime)
    this.nextStartTime += buffer.duration
  }

  close () {
    this.ctx.close()
  }
}

let worker = null
let player = null

export function initAudio (channels, sampleRate) {
  if (!worker) {
    worker = new Worker('./libopus.js')
    worker.onmessage = (e) => {
      if (player && e.data?.length) player.feed(e.data)
    }
  }
  player?.close()
  player = new PcmPlayer(channels, sampleRate)
  worker.postMessage({ channels, sampleRate })
}

export function playAudio (packet) {
  if (!worker) return
  worker.postMessage(packet, [packet.buffer])
}

export function closeAudio () {
  worker?.terminate()
  worker = null
  player?.close()
  player = null
}
