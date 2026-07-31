// Adapted from Chr0mX/rustdesk's flutter/web/js/src/globals.js (v1,
// recovered in Phase 2). Only the subset curConn.js/websock.js actually
// use is ported here - see README.md in this directory for what's a
// straight port, what's adapted, and what's still missing.
//
// IMPORTANT ARCHITECTURAL ADAPTATION (not present in v1): v1 was written to
// be a fully standalone client - msgbox/pushEvent/draw talked to its own
// UI and canvas directly. This webclient instead embeds the real Flutter
// engine (Phase 2), which - per Phase 3's findings - expects to be told
// about these exact same events via a handful of global callbacks it
// registers on window: window.onGlobalEvent (msgbox/pushEvent) and
// window.onRgba (decoded video frames -> Dart paints them). So instead of
// rendering anything itself, this module forwards to those globals when
// the engine has registered them, matching the live setByName/getByName
// contract found in flutter/lib/web/bridge.dart and models/web_model.dart.
//
// depends on libsodium-wrappers for the crypto functions (genBoxKeyPair,
// genSecretKey, seal, verify, encrypt, decrypt) - NOT YET added to
// package.json, see this directory's README.md.
import sodium from 'libsodium-wrappers'

// Ported directly from v1 (flutter/web/js/src/globals.js) - not a
// simplified heuristic. Confirmed load-bearing, not just cosmetic:
// flutter/lib/web/common.dart's `isWebDesktop_` calls
// `js.context.callMethod('isMobile')` directly (not through
// setByName/getByName at all), and since nothing defined window.isMobile
// before, that call itself threw ("Cannot read properties of undefined
// (reading 'apply')") during Dart's own startup, before the engine ever
// got as far as painting anything.
window.isMobile = () => {
  return /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|ipad|iris|kindle|Android|Silk|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(navigator.userAgent)
    || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(navigator.userAgent.substr(0, 4))
}

export function isDesktop () {
  return !window.isMobile()
}

// Dart's own event handlers (models/model.dart's startEventListener and
// everything it calls - handleMsgBox, handleCursorData, etc.) read most
// evt[key] values as plain strings compared directly against string
// literals (`evt['type'] == 'error'`, `evt['secure'] == 'true'`), matching
// how the native client's Rust side serializes event payloads as
// HashMap<String, String> - every value pre-stringified once, not a nested
// JSON document. A *non*-string value (bool/number/array/object) still
// needs JSON.stringify to reach that same convention (`JSON.stringify(true)`
// -> the 4-char string "true", matching `evt['secure'] == 'true'`; a
// List/Map value -> a JSON string Dart re-decodes itself, e.g.
// handleSyncPeerInfo's `json.decode(evt['displays'])`) - but a value that's
// *already* a JS string must NOT also be run through JSON.stringify, since
// that wraps it in an extra pair of literal `"` characters
// (`JSON.stringify('error')` -> the 7-char string `"error"`, not `error`),
// which silently fails every `==` comparison against it. Confirmed live:
// this broke every msgbox call already made through this function -
// `evt['type'] == 'error'` etc. never matched, so every msgbox event fell
// through handleMsgBox's generic `else` branch (see msgbox()'s own comment
// below for why that branch was also crashing outright).
function jsonfyForDart (payload) {
  const tmp = {}
  for (const [key, value] of Object.entries(payload || {})) {
    if (!key) continue
    if (value instanceof Uint8Array) {
      tmp[key] = '[' + value.toString() + ']'
    } else if (typeof value === 'string') {
      tmp[key] = value
    } else {
      tmp[key] = JSON.stringify(value)
    }
  }
  return tmp
}

// Forwards to the Flutter engine's window.onGlobalEvent, if it's
// registered (see Phase 3 findings) - otherwise a no-op, so this can still
// run (e.g. in tests, or before the engine has initialized) without
// throwing.
export function pushEvent (name, payload) {
  if (typeof window.onGlobalEvent !== 'function') {
    console.warn(`pushEvent("${name}") dropped - window.onGlobalEvent not registered yet (engine not loaded?)`)
    return
  }
  window.onGlobalEvent(JSON.stringify({ name, ...jsonfyForDart(payload) }))
}

export function msgbox (type, title, text, link = '') {
  if (!type || (type === 'error' && !text)) return
  // v1 also computed a "hasRetry" flag here via checkIfRetry(), sourced
  // from gen_js_from_hbb.ts (generated from the actual rustdesk client's
  // src/client.rs constants - see the plan doc's "Why this is tractable"
  // section for why that generator was deliberately not carried over).
  // Dropped for now; add back if the engine actually needs it.
  //
  // `link` is required even when there's nothing to link to: handleMsgBox
  // (models/model.dart) reads `evt['link']` unconditionally, and its
  // generic fallback branch (any type that isn't one of ~15 specifically
  // named ones - "error" included, so every globals.msgbox('error', ...)
  // call in curConn.js hits this) passes it straight into showMsgBox's
  // non-nullable `String link` parameter. Omitting it meant `evt['link']`
  // was `null`, which crashed Dart outright ("type 'Null' is not a subtype
  // of type 'String'") before any dialog could render - confirmed live via
  // a stray "main.dart.js:... Uncaught" console line immediately after
  // "Got relay response" on every offline/error connect attempt, which is
  // also why the UI just sat there black instead of showing "Remote
  // desktop is offline" or any other error.
  pushEvent('msgbox', { type, title, text, link })
}

// Forwards decoded video frames to the Flutter engine's window.onRgba, if
// registered - this is the actual rendering path per Phase 3's findings
// (JS decodes, Dart paints). frame's exact shape depends on Phase 1's
// codec decision (reuse ffmpeg-core.wasm) landing in Phase 4 - this just
// wires the call, it doesn't decode anything itself.
export function draw (display, rgba) {
  if (typeof window.onRgba !== 'function') {
    console.warn('draw() dropped - window.onRgba not registered yet (engine not loaded?)')
    return
  }
  window.onRgba(display, rgba)
}

export function getPeers () {
  try {
    return JSON.parse(localStorage.getItem('peers')) || {}
  } catch (e) {
    return {}
  }
}

export function copyToClipboard (text) {
  navigator.clipboard?.writeText(text).catch((e) => console.error('copyToClipboard failed', e))
}

// --- libsodium-backed crypto, ported from v1 (same logic, needs
// libsodium-wrappers added as a dependency - see README.md) ---

export function genBoxKeyPair () {
  const pair = sodium.crypto_box_keypair()
  return [pair.privateKey, pair.publicKey]
}

export function genSecretKey () {
  return sodium.crypto_secretbox_keygen()
}

export function seal (unsigned, theirPk, ourSk) {
  const nonce = Uint8Array.from(Array(24).fill(0))
  return sodium.crypto_box_easy(unsigned, nonce, theirPk, ourSk)
}

export async function verify (signed, pk) {
  await sodium.ready
  const pkBytes = typeof pk === 'string' ? sodium.from_base64(pk, sodium.base64_variants.ORIGINAL) : pk
  return sodium.crypto_sign_open(signed, pkBytes)
}

function makeNonce (value) {
  const byteArray = Array(24).fill(0)
  for (let index = 0; index < byteArray.length && value > 0; index++) {
    const byte = value & 0xff
    byteArray[index] = byte
    value = (value - byte) / 256
  }
  return Uint8Array.from(byteArray)
}

export function encrypt (unsigned, nonce, key) {
  return sodium.crypto_secretbox_easy(unsigned, makeNonce(nonce), key)
}

export function decrypt (signed, nonce, key) {
  return sodium.crypto_secretbox_open_easy(signed, makeNonce(nonce), key)
}

// --- Not yet ported from v1 - stubs so curConn.js's imports resolve ---

export function initAudio (channels, sampleRate) {
  // v1 used pcm-player + a libopus.js Web Worker for decode. The current
  // compiled bundle already ships libopus.wasm/libopus.js directly (see
  // Phase 1 findings) - wire this up to that instead of pcm-player once
  // Phase 4 gets to audio.
  console.warn('initAudio() not yet implemented', channels, sampleRate)
}

export function playAudio (packet) {
  console.warn('playAudio() not yet implemented', packet)
}
