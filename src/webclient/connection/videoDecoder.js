// Wires up the ffmpeg-core.wasm video decoder Phase 1 decided to reuse
// (see docs/WEBCLIENT_V2_REBUILD_PLAN.md's Phase 1 findings: v1's OGV.js
// pipeline is stale, the currently-vendored legacy bundle already ships a
// working ffmpeg-core.wasm/ffmpeg.js pair - reuse that binary rather than
// rebuilding an FFmpeg-to-WASM toolchain from source, which is out of
// scope). This file is a straight port of that legacy bundle's own decoder
// wrapper class (resources/web/js/dist/index.js, decompiled via targeted
// string searches - not guessed), not new design: a dedicated Worker
// running ffmpeg.js, driven by a tiny id-keyed request/response RPC over
// postMessage (LOAD/DECODE/CLOSE message types, matching ffmpeg.js's own
// self.onmessage contract exactly).
//
// Confirmed live in the legacy bundle (curConn-equivalent's own
// `draw(display, frame){ onRgba(display, new Uint8Array(frame.data)) }`):
// the DECODE response's `data.data` buffer is already RGBA - ffmpeg-core.wasm's
// build does the YUV -> RGBA conversion internally, so there is no separate
// color-space-conversion step to port here. `data.yuvFormat` is only used
// to detect a 4:4:4 vs 4:2:0 chroma change for a cosmetic quality-status
// readout, not for painting.
//
// Asset paths are relative ("./ffmpeg.js" etc.), matching the legacy
// bundle's own convention (relative to wherever it's loaded from) - by the
// time loadVideoDecoder() (curConn.js) runs, Engine.vue has already set
// <base href> to the engine's own served directory, so these resolve
// there. The three files this depends on (ffmpeg.js, ffmpeg-core.js,
// ffmpeg-core.wasm) are vendored from rustdesk-api's resources/web/ into
// that same directory at build time - see Rustdesk-Web/lib.sh's
// build_flutter_engine().
class VideoDecoder {
  #worker = null
  #resolvers = {}
  #rejecters = {}
  #nextId = 0
  #arrayBufferPool = []

  async #fetchAsObjectUrl (url, mimeType) {
    const buf = await (await fetch(url)).arrayBuffer()
    const blob = new Blob([buf], { type: mimeType })
    return URL.createObjectURL(blob)
  }

  async load () {
    if (this.#worker) return
    this.#worker = new Worker('./ffmpeg.js', { type: 'module' })
    this.#worker.onmessage = ({ data: { id, type, data } }) => {
      if (type === 'LOAD') {
        console.log('FFmpeg loaded')
        this.#resolvers[id]?.(data)
      } else if (type === 'DECODE') {
        this.#arrayBufferPool.push(data.data.data)
        if (this.#arrayBufferPool.length > 8) this.#arrayBufferPool.shift()
        this.#resolvers[id]?.(data)
      } else if (type === 'CLOSE') {
        this.#arrayBufferPool = []
        this.#resolvers[id]?.(data)
      } else {
        this.#rejecters[id]?.(data)
      }
      delete this.#resolvers[id]
      delete this.#rejecters[id]
    }
    const coreURL = await this.#fetchAsObjectUrl('./ffmpeg-core.js', 'text/javascript')
    const wasmURL = await this.#fetchAsObjectUrl('./ffmpeg-core.wasm', 'application/wasm')
    return this.#send({ type: 'LOAD', data: { coreURL, wasmURL } })
  }

  async decode (codec, data) {
    const transferList = [data]
    let arrayBuffer = null
    if (this.#arrayBufferPool.length > 0) {
      arrayBuffer = this.#arrayBufferPool.pop()
      transferList.push(arrayBuffer)
    }
    return this.#send({ type: 'DECODE', data: { codec, data, arrayBuffer } }, transferList)
  }

  async #send ({ type, data }, transferList) {
    if (!this.#worker) return Promise.reject(new Error('FFmpeg not loaded'))
    return new Promise((resolve, reject) => {
      const id = this.#nextId++
      this.#resolvers[id] = resolve
      this.#rejecters[id] = reject
      this.#worker.postMessage({ id, type, data }, transferList)
    })
  }

  close () {
    if (!this.#worker) return
    this.#send({ type: 'CLOSE', data: {} })
    this.#worker.terminate()
    this.#worker = null
  }
}

let instance = null

export async function initVideoDecoder () {
  try {
    instance = new VideoDecoder()
    return instance.load()
  } catch (e) {
    console.error('Failed to load FFmpeg', e)
    return Promise.reject(e)
  }
}

export async function decodeFrame (codec, data) {
  if (!instance) return Promise.reject(new Error('FFmpeg is uninitialized'))
  return instance.decode(codec, data)
}

export function closeVideoDecoder () {
  if (!instance) return
  instance.close()
  instance = null
}
