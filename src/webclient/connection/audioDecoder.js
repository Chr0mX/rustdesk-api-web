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
let ready = false
// The last {channels, sampleRate} init message - re-sent once the worker
// signals it's actually ready, and again if the worker had to be
// recreated (see createWorker() below).
let pendingInit = null
// Opus packets that arrived before the worker signaled ready - flushed
// in order once it does.
let pendingPackets = []

// libopus.js registers its `message` listener synchronously at the top of
// the script, but the actual WASM runtime (Module._Decoder_new etc.)
// finishes loading asynchronously - a message sent immediately after
// `new Worker(...)` can (and, confirmed live via two separate browser
// console logs, does) arrive before the module is ready, crashing with
// "Aborted(Assertion failed: native function `Decoder_new` called before
// runtime initialization)". An earlier version of this fix just recreated
// the worker and immediately resent the same message on that error - which
// doesn't actually fix the race, it just retries at the same "immediately"
// timing, so it hit the identical race almost every time and spun in a
// visible crash loop (confirmed live: dozens of libopus.js/libopus.wasm
// re-fetches, never producing sound).
//
// Real fix: don't guess when the module is ready - ask it. libopus.js
// itself provides the hook for this (its own header comment: "Sometimes
// an existing Module object exists with properties meant to overwrite the
// default module functionality") - `Module["onRuntimeInitialized"]` calls
// `Module.onload()` if we've predefined one, and `Module["locateFile"]`
// resolves the wasm binary via a predefined `LIBOPUS_WASM_URL` if present.
// A tiny wrapper script (loaded via a Blob URL, so libopus.js's own
// `self.location`-relative wasm lookup can't accidentally kick in) predefines
// both before `importScripts`-ing the real file, then posts a "ready"
// message back out once `onload` fires - genuinely gating every real
// message behind actual readiness instead of a timing guess.
function createWorker () {
  ready = false
  const scriptUrl = new URL('./libopus.js', document.baseURI).href
  const wasmUrl = new URL('./libopus.wasm', document.baseURI).href
  const wrapperSrc = 'self.LIBOPUS_WASM_URL = ' + JSON.stringify(wasmUrl) + ';\n' +
    'self.Module = { onload: function () { postMessage({ __ready: true }) } };\n' +
    'importScripts(' + JSON.stringify(scriptUrl) + ');\n'
  const wrapperUrl = URL.createObjectURL(new Blob([wrapperSrc], { type: 'application/javascript' }))
  const w = new Worker(wrapperUrl)
  URL.revokeObjectURL(wrapperUrl)
  w.onmessage = (e) => {
    if (e.data && e.data.__ready) {
      ready = true
      flushPending(w)
      return
    }
    if (player && e.data?.length) player.feed(e.data)
  }
  w.onerror = (e) => {
    console.error('libopus worker crashed: ' + e.message)
    w.terminate()
    worker = createWorker()
  }
  return w
}

function flushPending (w) {
  if (pendingInit) w.postMessage(pendingInit)
  for (const p of pendingPackets) w.postMessage(p, [p.buffer])
  pendingPackets = []
}

export function initAudio (channels, sampleRate) {
  pendingInit = { channels, sampleRate }
  pendingPackets = []
  if (!worker) worker = createWorker()
  player?.close()
  player = new PcmPlayer(channels, sampleRate)
  if (ready) worker.postMessage(pendingInit)
}

export function playAudio (packet) {
  if (!worker) return
  if (!ready) {
    pendingPackets.push(packet)
    return
  }
  worker.postMessage(packet, [packet.buffer])
}

export function closeAudio () {
  worker?.terminate()
  worker = null
  ready = false
  pendingInit = null
  pendingPackets = []
  player?.close()
  player = null
}
