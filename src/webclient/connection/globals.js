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

export function isDesktop () {
  // v1's isMobile() was a long UA-sniffing regex (see the recovered
  // source) - navigator.userAgentData / a small UA check covers the same
  // need. TODO: port the full UA regex if this proves insufficient.
  return !/android|iphone|ipad|mobile/i.test(navigator.userAgent)
}

function jsonfyForDart (payload) {
  const tmp = {}
  for (const [key, value] of Object.entries(payload || {})) {
    if (!key) continue
    tmp[key] = value instanceof Uint8Array ? '[' + value.toString() + ']' : JSON.stringify(value)
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

export function msgbox (type, title, text) {
  if (!type || (type === 'error' && !text)) return
  // v1 also computed a "hasRetry" flag here via checkIfRetry(), sourced
  // from gen_js_from_hbb.ts (generated from the actual rustdesk client's
  // src/client.rs constants - see the plan doc's "Why this is tractable"
  // section for why that generator was deliberately not carried over).
  // Dropped for now; add back if the engine actually needs it.
  pushEvent('msgbox', { type, title, text })
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
