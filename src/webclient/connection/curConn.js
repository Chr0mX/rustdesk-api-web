// Ported/adapted from Chr0mX/rustdesk's flutter/web/js/src/connection.ts
// (v1, recovered in Phase 2). Named CurConn (not Connection) to match what
// the recovered Flutter engine actually expects at runtime - Phase 3 found
// nearly every setByName/getByName case in flutter/lib/web/bridge.dart
// dispatching into a global object literally called `curConn`, itself a
// descendant of this same v1 connection.ts lineage.
//
// See this directory's README.md for exactly what's a straight port, what
// was adapted for the shell/engine split (Phase 3's onGlobalEvent/onRgba
// contract, replacing v1's own standalone UI/canvas calls), and what's
// still a stub because v1 never had it (file transfer, terminal, virtual
// display, 2FA, elevation, codec switching - all added to the real
// protocol after v1 was last touched, per Phase 1 findings).
import Websock from './websock'
import * as message from './message'
import * as rendezvous from './rendezvous'
import * as sha256 from 'fast-sha256'
import * as globals from './globals'
import { mapKey, sleep } from './common'
import { initVideoDecoder, decodeFrame, closeVideoDecoder } from './videoDecoder'
import { closeAudio } from './audioDecoder'
import { usbHidToPositionCode, isLetterKey, isNumpadKey } from './keycodes'

// TerminalModel._handleTerminalData (models/terminal_model.dart) expects
// "data" as a base64 string ("Try to decode as base64 first") - chunked to
// avoid a call-stack blowup on String.fromCharCode(...bytes) for larger
// terminal output bursts.
function bytesToBase64 (bytes) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// v1's own URI construction (SCHEMA='ws://' always, plus a flat PORT+offset
// for every host) is NOT what the currently-deployed legacy webclient
// bundle (resources/web/js/dist/index.js) actually does - decompiled and
// ported faithfully below instead of guessing, since that bundle is the
// one already proven working against this exact server. Two real
// differences from v1 that matter here:
//   - scheme follows the page's own protocol (wss:// behind the
//     Nginx+Certbot TLS install.sh sets up), not hardcoded ws:// - a
//     plain ws:// socket from an https:// page throws a SecurityError
//     synchronously, which is what was hanging the engine at "Loading
//     RustDesk...".
//   - a domain-name host (the common case for a real TLS deployment) is
//     NOT reached via host:port at all - it's a fixed /ws/id or
//     /ws/relay path with no port, since a reverse proxy terminating TLS
//     on 443 is expected to route those paths to hbbs's real internal
//     ports. Only bare IP hosts use the PORT+offset scheme v1 always
//     used. Getting this wrong for a domain host is a silent failure,
//     not an error - the socket just never reaches anything real.
const ID_PORT = 21118
const RELAY_PORT = 21119

function hasWsScheme (u) {
  return u.startsWith('ws://') || u.startsWith('wss://')
}
function isIPv4 (u) {
  return /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(:\d+)?$/.test(u)
}
function isIPv6 (u) {
  return /^((([a-fA-F0-9]{1,4}:{1,2})+[a-fA-F0-9]{1,4})|(\[([a-fA-F0-9]{1,4}:{1,2})+[a-fA-F0-9]{1,4}\]:\d+))$/.test(u)
}
function isDomainWithPort (u) {
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z-]{0,61}[a-z]:\d{1,5}$/i.test(u)
}
function isDomain (u) {
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z-]{0,61}[a-z]$/i.test(u)
}
function isHttps () {
  return typeof window !== 'undefined' && window.location.protocol === 'https:'
}

// v1 defaulted to RustDesk's own public relay fleet if unconfigured -
// appropriate for its original purpose (a public demo page anyone could
// point at any server), wrong for this self-hosted product. The real
// bundle's own fallback (window.location.host, i.e. same-origin) is
// ported here instead: still a guess, but one that at least has a
// chance of being routed by the same reverse proxy serving this page,
// rather than silently phoning home to a third party.
function defaultRendezvousHost () {
  const host = typeof window !== 'undefined' ? window.location.host : ''
  if (host.indexOf('localhost:') === 0) return '127.0.0.1'
  const parts = host.split(':')
  return parts.length > 1 ? parts[0] + ':' + (parseInt(parts[1]) + 2) : host
}

// rustdesk-api's real hbbs rendezvous port (see config/rustdesk.go's
// DefaultRelayServerPort-adjacent constants and its own
// EffectiveWebclientApiServer doc comment's example, "http://121.6.58.12:21114"
// - that's this exact port minus 2). Deliberately separate from this
// file's own ID_PORT (21118 - the *websocket* id port getDefaultUri talks
// to), which is a different +2-offset convention for a different purpose.
const RENDEZVOUS_PORT = 21116

// Faithful port of the legacy bundled webclient's own `cs(u, e)` (see
// resources/web/js/dist/index.js) - adjusts a "host[:port]" string's port
// by `e`, leaving the string unchanged if there's no parseable port to
// adjust (e.g. a bare domain with no port at all).
function adjustPort (u, e) {
  if (isIPv6(u)) {
    if (u.startsWith('[')) {
      const parts = u.split(']:')
      if (parts.length === 2) {
        const p = parseInt(parts[1]) || 0
        if (p > 0) return `${parts[0]}]:${p + e}`
      }
    }
  } else if (u.includes(':')) {
    const parts = u.split(':')
    if (parts.length === 2) {
      const p = parseInt(parts[1]) || 0
      if (p > 0) return `${parts[0]}:${p + e}`
    }
  }
  return u
}

// Faithful port of the legacy bundled webclient's own `ne()` (see
// resources/web/js/dist/index.js) - the real implementation behind
// getByName("api_server"). Every /api/* call the engine makes (address
// book, etc.) string-concatenates this value directly onto a path, so
// just returning localStorage's 'api-server' verbatim and giving up when
// that's unset (as this webclient briefly did) reproduces exactly the
// malformed-URI failure ("Failed to fetch, uri=///api/ab/...") this ports
// around: derive a sensible api-server from custom-rendezvous-server (the
// id-server, which - unlike api-server - is always configured whenever a
// connection works at all) before falling back further.
export function getApiServer () {
  const u = localStorage.getItem('api-server')
  if (u) return u
  const e = localStorage.getItem('custom-rendezvous-server')
  if (e) {
    const n = adjustPort(e, -2)
    return n === e ? `http://${n}:${RENDEZVOUS_PORT - 2}` : `http://${n}`
  }
  if (typeof window !== 'undefined' && window.location.host.indexOf('localhost:') === 0) {
    return `http://localhost:${RENDEZVOUS_PORT - 2}`
  }
  return typeof window !== 'undefined' ? window.location.origin : ''
}

export default class CurConn {
  constructor () {
    this._msgs = []
    this._id = ''
    this._videoTestSpeed = [0, 0]
    this._frameCount = {}
    // getOption/setOption/getRemember/getToggleOption etc. all assume
    // this is already an object - _start() is the only other place that
    // sets it (from globals.getPeers()[id]), but that only runs after a
    // "session_start" setByName call. Dart calls window.getByName("option:...")
    // well before that, while constructing PeerTabModel/ServerModel/
    // ChatModel during initGlobalFFI (its very first startup pass, before
    // any peer is even chosen) - without this, that first call dereferences
    // undefined and crashes the engine before it ever gets to render
    // anything.
    this._options = {}
    // File transfer state - see readRemoteDir/sendFiles/sendLocalFiles/
    // selectFiles/cancelJob below. _downloads tracks in-progress remote->
    // local downloads keyed by actId (id -> {fileName, chunks, ...}).
    // _pendingFileHandles holds browser File objects picked via
    // selectFiles(), indexed by the handleIndex pushed in "selected_files"
    // (mirrors web_unique.dart's webSendLocalFiles handle_index contract).
    // _uploadCancelled is actIds whose upload loop should stop early.
    this._downloads = new Map()
    this._pendingFileHandles = []
    this._uploadCancelled = new Set()
  }

  async start (id) {
    try {
      await this._start(id)
    } catch (e) {
      globals.msgbox(
        'error',
        'Connection Error',
        e?.type === 'close' ? 'Reset by the peer' : String(e),
      )
    }
  }

  async _start (id) {
    // Guards against reconnect() (which reuses this same instance) reloading
    // stale persisted options over ones already in memory - _options is
    // always an object now (see constructor), so this can't key off its
    // truthiness anymore.
    if (!this._optionsLoaded) {
      this._options = globals.getPeers()[id] || {}
      this._optionsLoaded = true
    }
    if (!this._password) {
      const p = this.getOption('password')
      if (p) {
        try {
          this._password = Uint8Array.from(JSON.parse('[' + p + ']'))
        } catch (e) {
          console.error(e)
        }
      }
    }
    this._interval = setInterval(() => {
      while (this._msgs.length) {
        this._ws?.sendMessage(this._msgs[0])
        this._msgs.splice(0, 1)
      }
    }, 1)
    this.loadVideoDecoder()
    const uri = getDefaultUri()
    const ws = new Websock(uri, true)
    this._ws = ws
    this._id = id
    console.log(new Date() + ': Connecting to rendezvous server: ' + uri + ', for ' + id)
    await ws.open()
    console.log(new Date() + ': Connected to rendezvous server')
    const conn_type = rendezvous.ConnType.DEFAULT_CONN
    const nat_type = rendezvous.NatType.SYMMETRIC
    const punch_hole_request = rendezvous.PunchHoleRequest.fromPartial({
      id,
      licence_key: localStorage.getItem('key') || undefined,
      conn_type,
      nat_type,
      token: localStorage.getItem('access_token') || undefined,
    })
    ws.sendRendezvous({ punch_hole_request })
    const msg = await ws.next()
    ws.close()
    console.log(new Date() + ': Got relay response')
    const phr = msg.punch_hole_response
    const rr = msg.relay_response
    if (phr) {
      if (phr?.other_failure) {
        globals.msgbox('error', 'Error', phr?.other_failure)
        return
      }
      if (phr.failure !== rendezvous.PunchHoleResponse_Failure.UNRECOGNIZED) {
        switch (phr?.failure) {
          case rendezvous.PunchHoleResponse_Failure.ID_NOT_EXIST:
            globals.msgbox('error', 'Error', 'ID does not exist')
            break
          case rendezvous.PunchHoleResponse_Failure.OFFLINE:
            globals.msgbox('error', 'Error', 'Remote desktop is offline')
            break
          case rendezvous.PunchHoleResponse_Failure.LICENSE_MISMATCH:
            globals.msgbox('error', 'Error', 'Key mismatch')
            break
          case rendezvous.PunchHoleResponse_Failure.LICENSE_OVERUSE:
            globals.msgbox('error', 'Error', 'Key overuse')
            break
        }
      }
    } else if (rr) {
      if (!rr.version) {
        globals.msgbox('error', 'Error', 'Remote version is low, not support web')
        return
      }
      await this.connectRelay(rr)
    }
  }

  async connectRelay (rr) {
    const pk = rr.pk
    let uri = rr.relay_server
    if (uri) {
      uri = getrUriFromRs(uri, true)
    } else {
      uri = getDefaultUri(true)
    }
    const uuid = rr.uuid
    console.log(new Date() + ': Connecting to relay server: ' + uri)
    const ws = new Websock(uri, false)
    await ws.open()
    console.log(new Date() + ': Connected to relay server')
    this._ws = ws
    const request_relay = rendezvous.RequestRelay.fromPartial({
      licence_key: localStorage.getItem('key') || undefined,
      uuid,
    })
    ws.sendRendezvous({ request_relay })
    const secure = (await this.secure(pk)) || false
    globals.pushEvent('connection_ready', { secure, direct: false })
    await this.msgLoop()
  }

  async secure (pk) {
    if (pk) {
      const RS_PK = 'OeVuKk5nlHiXp+APNn0Y3pC1Iwpwn44JGqrQCsWqmBw='
      try {
        pk = await globals.verify(pk, localStorage.getItem('key') || RS_PK)
        if (pk) {
          const idpk = message.IdPk.decode(pk)
          if (idpk.id === this._id) {
            pk = idpk.pk
          }
        }
        if (pk?.length !== 32) {
          pk = undefined
        }
      } catch (e) {
        console.error(e)
        pk = undefined
      }
      if (!pk) console.error('Handshake failed: invalid public key from rendezvous server')
    }
    if (!pk) {
      // send an empty message out in case server is setting up secure and waiting for first message
      const public_key = message.PublicKey.fromPartial({})
      this._ws?.sendMessage({ public_key })
      return
    }
    const msg = await this._ws?.next()
    let signedId = msg?.signed_id
    if (!signedId) {
      console.error('Handshake failed: invalid message type')
      const public_key = message.PublicKey.fromPartial({})
      this._ws?.sendMessage({ public_key })
      return
    }
    try {
      signedId = await globals.verify(signedId.id, Uint8Array.from(pk))
    } catch (e) {
      console.error(e)
      // fall back to non-secure connection in case pk mismatch
      console.error('pk mismatch, fall back to non-secure')
      const public_key = message.PublicKey.fromPartial({})
      this._ws?.sendMessage({ public_key })
      return
    }
    const idpk = message.IdPk.decode(signedId)
    const id = idpk.id
    const theirPk = idpk.pk
    if (id !== this._id) {
      console.error('Handshake failed: sign failure')
      const public_key = message.PublicKey.fromPartial({})
      this._ws?.sendMessage({ public_key })
      return
    }
    if (theirPk.length !== 32) {
      console.error('Handshake failed: invalid public box key length from peer')
      const public_key = message.PublicKey.fromPartial({})
      this._ws?.sendMessage({ public_key })
      return
    }
    const [mySk, asymmetric_value] = globals.genBoxKeyPair()
    const secret_key = globals.genSecretKey()
    const symmetric_value = globals.seal(secret_key, theirPk, mySk)
    const public_key = message.PublicKey.fromPartial({ asymmetric_value, symmetric_value })
    this._ws?.sendMessage({ public_key })
    this._ws?.setSecretKey(secret_key)
    console.log('secured')
    return true
  }

  async msgLoop () {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const msg = await this._ws?.next()
      if (msg?.hash) {
        this._hash = msg?.hash
        if (!this._password) globals.msgbox('input-password', 'Password Required', '')
        this.login()
      } else if (msg?.test_delay) {
        const test_delay = msg?.test_delay
        console.log(test_delay)
        if (!test_delay.from_client) {
          // Drives the toolbar's connection-quality indicator and the
          // quality monitor panel (models/model.dart's QualityMonitorModel,
          // fed from setEventCallback's "update_quality_status" handler) -
          // entirely unhandled before, so both looked permanently "not
          // working" (blank/default) since no delay/bitrate data ever
          // reached them, regardless of the actual connection quality.
          // Matches the legacy bundle's own test_delay handling exactly
          // (push before echoing the message back).
          globals.pushEvent('update_quality_status', {
            delay: String(test_delay.last_delay),
            target_bitrate: String(test_delay.target_bitrate),
          })
          this._ws?.sendMessage({ test_delay })
        }
      } else if (msg?.login_response) {
        const r = msg?.login_response
        if (r.error) {
          if (r.error === 'Wrong Password') {
            this._password = undefined
            globals.msgbox('re-input-password', r.error, 'Do you want to enter again?')
          } else {
            globals.msgbox('error', 'Login Error', r.error)
          }
        } else if (r.peer_info) {
          this.handlePeerInfo(r.peer_info)
        }
      } else if (msg?.video_frame) {
        this.handleVideoFrame(msg?.video_frame)
      } else if (msg?.clipboard) {
        const cb = msg?.clipboard
        if (cb.compress) {
          const { decompress } = await import('./common')
          try {
            cb.content = await decompress(cb.content)
          } catch (e) {
            console.error('Failed to decompress clipboard content', e)
            continue
          }
        }
        try {
          globals.copyToClipboard(new TextDecoder().decode(cb.content))
        } catch (e) {
          console.error(e)
        }
      } else if (msg?.cursor_data) {
        const { decompress } = await import('./common')
        const cd = msg?.cursor_data
        try {
          cd.colors = await decompress(cd.colors)
        } catch (e) {
          console.error('Failed to decompress cursor colors', e)
          continue
        }
        globals.pushEvent('cursor_data', cd)
      } else if (msg?.cursor_id) {
        globals.pushEvent('cursor_id', { id: msg?.cursor_id })
      } else if (msg?.cursor_position) {
        globals.pushEvent('cursor_position', msg?.cursor_position)
      } else if (msg?.misc) {
        if (!this.handleMisc(msg?.misc)) break
      } else if (msg?.audio_frame) {
        globals.playAudio(msg?.audio_frame.data)
      } else if (msg?.file_response) {
        await this.handleFileResponse(msg?.file_response)
      } else if (msg?.terminal_response) {
        await this.handleTerminalResponse(msg?.terminal_response)
      } else if (msg?.message_box) {
        // Peer-proactively-sent message box (distinct from this client's
        // own internally-generated globals.msgbox() calls elsewhere in
        // this file) - was entirely undispatched before, so anything the
        // remote side pushed this way (e.g. a permission notice) never
        // showed up at all.
        const mb = msg.message_box
        globals.msgbox(mb.msgtype, mb.title, mb.text, mb.link)
      }
    }
  }

  close () {
    this._msgs = []
    clearInterval(this._interval)
    this._ws?.close()
    closeVideoDecoder()
    closeAudio()
    // Any in-progress download's chunks just get dropped - future blocks/
    // done for these ids will find no entry and no-op harmlessly.
    this._downloads.clear()
  }

  refresh () {
    const misc = message.Misc.fromPartial({ refresh_video: true })
    this._ws?.sendMessage({ misc })
  }

  login (password = undefined) {
    if (password) {
      const salt = this._hash?.salt
      let p = hash([password, salt])
      this._password = p
      const challenge = this._hash?.challenge
      p = hash([p, challenge])
      globals.msgbox('connecting', 'Connecting...', 'Logging in...')
      this._sendLoginMessage(p)
    } else {
      let p = this._password
      if (p) {
        const challenge = this._hash?.challenge
        p = hash([p, challenge])
      }
      this._sendLoginMessage(p)
    }
  }

  // setByName case "login" - see Phase 3 findings.
  handle_login_from_ui (osUsername, osPassword, password, remember) {
    this.setRemember(!!remember)
    this.login(password)
  }

  async reconnect () {
    this.close()
    await this.start(this._id)
  }

  _sendLoginMessage (password = undefined) {
    const login_request = message.LoginRequest.fromPartial({
      username: this._id,
      my_id: 'web', // to-do
      my_name: 'web', // to-do
      password,
      option: this.getOptionMessage(),
      video_ack_required: true,
    })
    this._ws?.sendMessage({ login_request })
  }

  getOptionMessage () {
    let n = 0
    const msg = message.OptionMessage.fromPartial({})
    const q = this.getImageQualityEnum(this.getImageQuality(), true)
    const yes = message.OptionMessage_BoolOption.Yes
    if (q !== undefined) {
      msg.image_quality = q
      n += 1
    }
    if (this._options['show-remote-cursor']) {
      msg.show_remote_cursor = yes
      n += 1
    }
    if (this._options['lock-after-session-end']) {
      msg.lock_after_session_end = yes
      n += 1
    }
    if (this._options['privacy-mode']) {
      msg.privacy_mode = yes
      n += 1
    }
    if (this._options['disable-audio']) {
      msg.disable_audio = yes
      n += 1
    }
    if (this._options['disable-clipboard']) {
      msg.disable_clipboard = yes
      n += 1
    }
    return n > 0 ? msg : undefined
  }

  sendVideoReceived () {
    const misc = message.Misc.fromPartial({ video_received: true })
    this._ws?.sendMessage({ misc })
  }

  // Feeds the same "update_quality_status" event the test_delay handler
  // does (see _start()'s msgLoop) - fps per display plus received-byte
  // rate, matching the legacy bundle's own updateStatus() exactly
  // (including its formula: KB/s from websock.js's recv-byte-count divided
  // by elapsed ms, fps from per-display decoded-frame counts divided by
  // elapsed seconds). Throttled to once/second like the original,
  // otherwise every single decoded frame would fire a pushEvent.
  updateQualityStats () {
    const now = new Date().getTime()
    if (!this._statsUpdateTs) this._statsUpdateTs = now
    const elapsed = now - this._statsUpdateTs
    if (elapsed < 1000) return
    const recvBytes = this._ws?.getRecvDataCount() || 0
    this._ws?.resetRecvDataCount()
    const speed = (recvBytes / 1024 / elapsed * 1000).toFixed(2) + ' kb/s'
    const fps = {}
    for (const display in this._frameCount) {
      fps[display] = Math.floor(this._frameCount[display] / (elapsed / 1000))
    }
    this._frameCount = {}
    this._statsUpdateTs = now
    globals.pushEvent('update_quality_status', { speed, fps: JSON.stringify(fps) })
  }

  // ffmpeg-core.wasm's own build expects this exact integer per codec -
  // confirmed against the legacy bundle's own dispatch (resources/web/js/
  // dist/index.js), not guessed, since we're reusing that same compiled
  // .wasm binary (see videoDecoder.js) rather than rebuilding it.
  getCodecType (vf) {
    if (vf.vp8s) return [0, vf.vp8s]
    if (vf.vp9s) return [1, vf.vp9s]
    if (vf.av1s) return [2, vf.av1s]
    if (vf.h264s) return [3, vf.h264s]
    if (vf.h265s) return [4, vf.h265s]
    return [undefined, undefined]
  }

  // Matches the legacy bundle's own getCodecFormat() - display-only label
  // for the quality monitor panel's "Codec" row.
  getCodecFormat (vf) {
    if (vf.vp9s) return 'VP9'
    if (vf.vp8s) return 'VP8'
    if (vf.av1s) return 'AV1'
    if (vf.h264s) return 'H264'
    if (vf.h265s) return 'H265'
    return 'Unknown'
  }

  // Queued rather than decoded inline: ffmpeg-core.wasm runs in a single
  // Worker and must see frames in order (later frames can reference earlier
  // ones), so a second video_frame message arriving mid-decode has to wait
  // its turn rather than racing the first through decodeFrame().
  handleVideoFrame (vf) {
    if (!this._firstFrame) {
      globals.msgbox('', '', '')
      this._firstFrame = true
    }
    this._videoQueue = this._videoQueue || []
    this._videoQueue.push(vf)
    if (!this._decodingVideo) this.processVideoQueue()
  }

  async processVideoQueue () {
    this._decodingVideo = true
    try {
      while (this._videoQueue.length > 0) {
        await this.handleOneVideoFrame(this._videoQueue.shift())
      }
    } catch (e) {
      console.error('deal video queue failed', e)
    }
    this._decodingVideo = false
  }

  // Matches the legacy bundle's own handleOneVideoFrame exactly: a
  // video_frame message can carry several encoded frames at once (codec
  // frame batching) - all of them have to be fed through the decoder in
  // order to keep its reference-frame state correct, but only the last
  // one in the batch is actually worth painting (drawing the earlier ones
  // too would just mean immediately-superseded frames flash by, wasting
  // paint work for no visible benefit).
  async handleOneVideoFrame (vf) {
    const [codec, s] = this.getCodecType(vf)
    if (codec === undefined) {
      console.log('unknown codec')
      return
    }
    const codecFormat = this.getCodecFormat(vf)
    if (this._videoFormat !== codecFormat) {
      this._videoFormat = codecFormat
      globals.pushEvent('update_quality_status', { codec_format: codecFormat })
    }
    const frameCount = s.frames?.length || 0
    this._frameCount[vf.display] = (this._frameCount[vf.display] || 0) + frameCount
    this.updateQualityStats()
    this.sendVideoReceived()
    const tm = new Date().getTime()
    try {
      // loadVideoDecoder() fires off the Worker spin-up/wasm fetch without
      // waiting for it (see its own comment), so a fresh connect/reconnect/
      // switch_display can have video_frame messages arriving well before
      // the decoder is ready - confirmed live ("decode error: FFmpeg not
      // loaded", repeated for every frame during that window on a
      // reconnect). Wait for it here instead of dropping those frames -
      // dropping them left the decoder missing whatever reference frame
      // they carried, corrupting the next frame it actually did decode
      // ("decode error: {}" right after "FFmpeg loaded" in the same log).
      await this._videoDecoderReady
      for (let i = 0; i < frameCount; i++) {
        const frame = s.frames[i]
        const result = await decodeFrame(codec, frame.data.slice(0).buffer)
        if (result?.data && i === frameCount - 1) {
          globals.draw(vf.display, new Uint8Array(result.data.data))
          // yuvFormat 5 == 4:4:4 chroma subsampling in ffmpeg-core.wasm's
          // own encoding (matches the legacy bundle's own check) - purely
          // a quality-monitor display value, not used for painting itself
          // (see videoDecoder.js's own comment on why the decoded buffer
          // needs no further color-space handling here).
          const i444 = result.data.yuvFormat === 5
          if (this._i444 !== i444) {
            this._i444 = i444
            globals.pushEvent('update_quality_status', { chroma: i444 ? '4:4:4' : '4:2:0' })
          }
          const elapsed = new Date().getTime() - tm
          this._videoTestSpeed[1] += elapsed
          this._videoTestSpeed[0] += 1
          if (this._videoTestSpeed[0] >= 30) {
            console.log('video decoder: ' + parseInt('' + this._videoTestSpeed[1] / this._videoTestSpeed[0]))
            this._videoTestSpeed = [0, 0]
          }
        }
      }
    } catch (e) {
      console.error('decode error: ', e)
    }
  }

  handlePeerInfo (pi) {
    this._peerInfo = pi
    if (pi.displays.length === 0) {
      globals.msgbox('error', 'Remote Error', 'No Display')
      return
    }
    globals.msgbox('success', 'Successful', 'Connected, waiting for image...')
    globals.pushEvent('peer_info', pi)
    this.recordRecentPeer(pi)
    if (pi.encoding) this._supportedEncoding = pi.encoding
    const p = this.shouldAutoLogin()
    if (p) this.inputOsPassword(p)
    const username = this.getOption('info')?.username
    if (username && !pi.username) pi.username = username
    this.setOption('info', pi)
    if (this.getRemember()) {
      if (this._password?.length) {
        const p = this._password.toString()
        if (p !== this.getOption('password')) {
          this.setOption('password', p)
          console.log('remember password of ' + this._id)
        }
      }
    } else {
      this.setOption('password', undefined)
    }
  }

  // Backs the Recents tab (models/peer_model.dart's Peers class, name:
  // "recent" - see bridge.js's "load_recent_peers" getByName case). A
  // webclient has no native connection-history file to read the way a
  // desktop client does, so this is the closest equivalent: record every
  // peer actually connected to (most-recent-first, deduped by id), the
  // same way v1 never did but the legacy bundle's own "wc-" prefixed
  // recent-peers storage does. Peer.fromJson (peer_model.dart) is the
  // exact field shape expected - matches ab_cache's own peer records,
  // just without the address-book-specific hash/tags/rdp fields we don't
  // have data for from a live connection alone.
  recordRecentPeer (pi) {
    const entry = {
      id: this._id,
      hash: '',
      password: '',
      username: pi.username || '',
      hostname: pi.hostname || '',
      platform: pi.platform || '',
      alias: '',
      tags: [],
      forceAlwaysRelay: 'false',
      rdpPort: '',
      rdpUsername: '',
      loginName: '',
      device_group_name: '',
      note: '',
    }
    let recents
    try {
      recents = JSON.parse(localStorage.getItem('recent_peers_cache') || '[]')
    } catch (e) {
      recents = []
    }
    recents = recents.filter((p) => p.id !== this._id)
    recents.unshift(entry)
    if (recents.length > 100) recents.length = 100
    localStorage.setItem('recent_peers_cache', JSON.stringify(recents))
  }

  shouldAutoLogin () {
    const l = this.getOption('lock-after-session-end')
    const a = !!this.getOption('auto-login')
    const p = this.getOption('os-password')
    if (p && l && a) {
      return p
    }
    return ''
  }

  handleMisc (misc) {
    if (misc.audio_format) {
      globals.initAudio(misc.audio_format.channels, misc.audio_format.sample_rate)
    } else if (misc.chat_message) {
      // This is the ONLY real wire path for chat - chat_message exists
      // solely inside Misc (message.proto: Misc.chat_message, field 4),
      // not as a top-level Message field (an earlier version of this file
      // wrongly assumed a top-level msg.chat_message case too; that
      // branch could never fire and has been removed). Event name must be
      // "chat_client_mode" to match model.dart's chatModel.receive()
      // handler in the fixed branch - this used to push the wrong name
      // ("chat"), which that switch has no case for.
      globals.pushEvent('chat_client_mode', { text: misc.chat_message.text })
    } else if (misc.permission_info) {
      const p = misc.permission_info
      console.info('Change permission ' + p.permission + ' -> ' + p.enabled)
      let name
      switch (p.permission) {
        case message.PermissionInfo_Permission.Keyboard:
          name = 'keyboard'
          break
        case message.PermissionInfo_Permission.Clipboard:
          name = 'clipboard'
          break
        case message.PermissionInfo_Permission.Audio:
          name = 'audio'
          break
        default:
          return true
      }
      globals.pushEvent('permission', { [name]: p.enabled })
    } else if (misc.switch_display) {
      this.loadVideoDecoder()
      globals.pushEvent('switch_display', misc.switch_display)
    } else if (misc.supported_encoding) {
      // A later re-negotiation of the peer's own codec support (e.g. after
      // it toggles hardware encoding) - handlePeerInfo already sets this
      // from peer_info.encoding on connect; this keeps getAlternativeCodecs()
      // current if it changes mid-session.
      this._supportedEncoding = misc.supported_encoding
    } else if (misc.close_reason) {
      globals.msgbox('error', 'Connection Error', misc.close_reason)
      this.close()
      return false
    }
    return true
  }

  getRemember () {
    return this._options['remember'] || false
  }

  setRemember (v) {
    this.setOption('remember', v)
  }

  getOption (name) {
    return this._options[name]
  }

  setOption (name, value) {
    if (value === undefined) {
      delete this._options[name]
    } else {
      this._options[name] = value
    }
    this._options['tm'] = new Date().getTime()
    const peers = globals.getPeers()
    peers[this._id] = this._options
    localStorage.setItem('peers', JSON.stringify(peers))
  }

  inputKey (name, down, press, alt, ctrl, shift, command) {
    const key_event = mapKey(name, globals.isDesktop())
    if (!key_event) return
    if (alt && (name === 'VK_MENU' || name === 'RAlt')) alt = false
    if (ctrl && (name === 'VK_CONTROL' || name === 'RControl')) ctrl = false
    if (shift && (name === 'VK_SHIFT' || name === 'RShift')) shift = false
    if (command && (name === 'Meta' || name === 'RWin')) command = false
    key_event.down = down
    key_event.press = press
    key_event.modifiers = this.getMod(alt, ctrl, shift, command)
    this._ws?.sendMessage({ key_event })
  }

  // Settings > Keyboard > Map Mode. usb_hid is the physical key's USB HID
  // usage code (Flutter's web engine already computes this from the
  // browser's native KeyboardEvent before calling bridge.dart - we don't
  // need our own browser-code-to-USB-HID table). lock_modes is Dart's own
  // already-computed bitmask (bit1=CapsLock, bit2=NumLock, matching
  // src/keyboard.rs's CAPS_LOCK=1/NUM_LOCK=2 exactly) - relayed into
  // modifiers the same way src/keyboard.rs's parse_add_lock_modes_modifiers
  // does (only for a letter key + caps-lock bit, or a numpad key +
  // num-lock bit).
  handleFlutterKeyEvent (value) {
    try {
      const e = JSON.parse(value)
      const usbHid = e.usb_hid
      const down = e.down === 'true'
      const platform = this._peerInfo?.platform || ''
      const chr = usbHidToPositionCode(usbHid, platform)
      const modifiers = []
      const lockModes = e.lock_modes || 0
      if (isLetterKey(usbHid) && (lockModes & (1 << 1))) modifiers.push(message.ControlKey.CapsLock)
      if (isNumpadKey(usbHid) && (lockModes & (1 << 2))) modifiers.push(message.ControlKey.NumLock)
      const key_event = message.KeyEvent.fromPartial({
        down, press: false, chr, modifiers, mode: message.KeyboardMode.Map,
      })
      this._ws?.sendMessage({ key_event })
    } catch (err) {
      console.error('Failed to handle flutter key event: ' + err.message)
    }
  }

  ctrlAltDel () {
    const key_event = message.KeyEvent.fromPartial({ down: true })
    if (this._peerInfo?.platform === 'Windows') {
      key_event.control_key = message.ControlKey.CtrlAltDel
    } else {
      key_event.control_key = message.ControlKey.Delete
      key_event.modifiers = this.getMod(true, true, false, false)
    }
    this._ws?.sendMessage({ key_event })
  }

  inputString (seq) {
    const key_event = message.KeyEvent.fromPartial({ seq })
    this._ws?.sendMessage({ key_event })
  }

  switchDisplay (display) {
    const switch_display = message.SwitchDisplay.fromPartial({ display })
    const misc = message.Misc.fromPartial({ switch_display })
    this._ws?.sendMessage({ misc })
  }

  async inputOsPassword (seq) {
    this.inputMouse()
    await sleep(50)
    this.inputMouse(0, 3, 3)
    await sleep(50)
    this.inputMouse(1 | (1 << 3))
    this.inputMouse(2 | (1 << 3))
    await sleep(1200)
    const key_event = message.KeyEvent.fromPartial({ press: true, seq })
    this._ws?.sendMessage({ key_event })
  }

  lockScreen () {
    const key_event = message.KeyEvent.fromPartial({
      down: true,
      control_key: message.ControlKey.LockScreen,
    })
    this._ws?.sendMessage({ key_event })
  }

  getMod (alt, ctrl, shift, command) {
    const mod = []
    if (alt) mod.push(message.ControlKey.Alt)
    if (ctrl) mod.push(message.ControlKey.Control)
    if (shift) mod.push(message.ControlKey.Shift)
    if (command) mod.push(message.ControlKey.Meta)
    return mod
  }

  inputMouse (mask = 0, x = 0, y = 0, alt = false, ctrl = false, shift = false, command = false) {
    const mouse_event = message.MouseEvent.fromPartial({
      mask, x, y,
      modifiers: this.getMod(alt, ctrl, shift, command),
    })
    this._ws?.sendMessage({ mouse_event })
  }

  // Ported from the legacy bundle's own toggleOption (resources/web/js/
  // dist/index.js, decompiled) - this file's previous version only
  // recognized a subset of real toggle names and silently no-op'ed
  // (`default: return`, never touching _options at all) on the rest,
  // including "show-quality-monitor" - confirmed live as exactly why
  // that toolbar toggle did nothing: checkShowQualityMonitor
  // (models/model.dart) reads it back via getToggleOption, which reads
  // straight off _options, so a name that was never actually written
  // there could never toggle on. "show-quality-monitor"/"allow_swap_key"
  // are genuinely peer-message-free (no OptionMessage field exists for
  // them) but still need their local option persisted, unlike the
  // default case (for any name this switch doesn't recognize at all),
  // which updates local state via a "Y"/unset convention instead and
  // never sends anything to the peer.
  toggleOption (name) {
    const v = !this._options[name]
    const option = message.OptionMessage.fromPartial({})
    const v2 = v ? message.OptionMessage_BoolOption.Yes : message.OptionMessage_BoolOption.No
    switch (name) {
      case 'show-remote-cursor':
        option.show_remote_cursor = v2
        break
      case 'follow-remote-cursor':
        option.follow_remote_cursor = v2
        break
      case 'follow-remote-window':
        option.follow_remote_window = v2
        break
      case 'disable-audio':
        option.disable_audio = v2
        break
      case 'disable-clipboard':
        option.disable_clipboard = v2
        break
      case 'lock-after-session-end':
        option.lock_after_session_end = v2
        break
      case 'privacy-mode':
        option.privacy_mode = v2
        break
      case 'enable-file-copy-paste':
        option.enable_file_transfer = v2
        break
      case 'block-input':
        option.block_input = message.OptionMessage_BoolOption.Yes
        break
      case 'unblock-input':
        option.block_input = message.OptionMessage_BoolOption.No
        break
      case 'show-quality-monitor':
      case 'allow_swap_key':
        break
      case 'view-only':
        if (v) {
          option.disable_keyboard = message.OptionMessage_BoolOption.Yes
          option.disable_clipboard = message.OptionMessage_BoolOption.Yes
          option.show_remote_cursor = message.OptionMessage_BoolOption.Yes
          option.enable_file_transfer = message.OptionMessage_BoolOption.No
          option.lock_after_session_end = message.OptionMessage_BoolOption.No
        } else {
          option.disable_keyboard = message.OptionMessage_BoolOption.No
          option.disable_clipboard = this.getToggleOption('disable-clipboard') ? message.OptionMessage_BoolOption.Yes : message.OptionMessage_BoolOption.No
          option.show_remote_cursor = this.getToggleOption('show-remote-cursor') ? message.OptionMessage_BoolOption.Yes : message.OptionMessage_BoolOption.No
          option.enable_file_transfer = this.getToggleOption('enable-file-copy-paste') ? message.OptionMessage_BoolOption.Yes : message.OptionMessage_BoolOption.No
          option.lock_after_session_end = this.getToggleOption('lock-after-session-end') ? message.OptionMessage_BoolOption.Yes : message.OptionMessage_BoolOption.No
        }
        break
      case 'terminal-persistent':
        option.terminal_persistent = v2
        break
      default:
        this.setOption(name, this._options[name] ? undefined : 'Y')
        return
    }
    if (name.indexOf('block-input') < 0) this.setOption(name, v)
    const misc = message.Misc.fromPartial({ option })
    this._ws?.sendMessage({ misc })
  }

  // setByName case "option:toggle" (get half is getToggleOption below).
  getToggleOption (name) {
    return !!this._options[name]
  }

  getImageQuality () {
    return this.getOption('image-quality')
  }

  getImageQualityEnum (value, ignoreDefault) {
    switch (value) {
      case 'low':
        return message.ImageQuality.Low
      case 'best':
        return message.ImageQuality.Best
      case 'balanced':
        return ignoreDefault ? undefined : message.ImageQuality.Balanced
      default:
        return undefined
    }
  }

  setImageQuality (value) {
    this.setOption('image-quality', value)
    const image_quality = this.getImageQualityEnum(value, false)
    if (image_quality === undefined) return
    const option = message.OptionMessage.fromPartial({ image_quality })
    const misc = message.Misc.fromPartial({ option })
    this._ws?.sendMessage({ misc })
  }

  // Replaces v1's loadVp9()/codec.js (OGV.js-based VP9/Theora, confirmed
  // stale in Phase 1 findings) - the current bundle uses ffmpeg-core.wasm
  // instead (videoDecoder.js), matching the legacy bundle's own decoder.
  // Doesn't block the connect flow on the Worker spin-up + ~1MB wasm fetch
  // this kicks off - handleOneVideoFrame awaits _videoDecoderReady itself,
  // right before it actually needs a decoder, instead of stalling
  // everything else (rendezvous/relay handshake, login) on it here.
  loadVideoDecoder () {
    closeVideoDecoder()
    this._videoDecoderReady = initVideoDecoder().catch((e) => console.error('Failed to load video decoder', e))
  }

  // --- Everything below is NOT in v1 - the setByName/getByName cases
  // Phase 3 found in the live compiled bundle that v1 never had (file
  // transfer, terminal, virtual display, elevation, 2FA, codec switching).
  // v1's connection.ts predates all of these - they were added to the real
  // protocol after v1 was last touched (see Phase 1 findings item 4:
  // LoginRequest.union gained view_camera/terminal, OptionMessage gained
  // disable_camera/terminal_persistent, etc.). The message shapes below
  // (ToggleVirtualDisplay, TogglePrivacyMode, ElevationRequest,
  // ElevationRequestWithLogon, SupportedDecoding.PreferCodec, Chroma,
  // CodecAbility) are confirmed directly against hbb_common's real
  // message.proto (rustdesk/hbb_common@master, libs/hbb_common/protos/
  // message.proto), not guessed or inferred from the legacy bundle's
  // minified field names alone - the legacy bundle's own control flow
  // (which fields get set when, e.g. custom_image_quality's `<< 8` shift)
  // was still used to confirm behavior, decompiled from resources/web/
  // js/dist/index.js. ---

  toggleVirtualDisplay (arg) {
    try {
      const { index, on } = JSON.parse(arg)
      const toggle_virtual_display = message.ToggleVirtualDisplay.fromPartial({ display: index, on })
      const misc = message.Misc.fromPartial({ toggle_virtual_display })
      this._ws?.sendMessage({ misc })
    } catch (e) {
      console.log(`Failed to toggle virtual display, invalid param "${arg}"`)
    }
  }

  togglePrivacyMode (arg) {
    try {
      const { impl_key, on } = JSON.parse(arg)
      const toggle_privacy_mode = message.TogglePrivacyMode.fromPartial({ impl_key, on })
      const misc = message.Misc.fromPartial({ toggle_privacy_mode })
      this._ws?.sendMessage({ misc })
    } catch (e) {
      console.log(`Failed to toggle privacy mode, invalid param "${arg}"`)
    }
  }

  // bridge.dart's sessionSetCustomImageQuality passes a raw int (not JSON),
  // so `value` arrives here as a genuine JS number already. The `<< 8`
  // shift matches hbb_common's own convention for this field (the low
  // byte is reserved, only the native client's Rust side actually reads
  // the shifted-out bits) - confirmed against the legacy bundle's own
  // identical shift, not something to "clean up".
  setCustomImageQuality (value) {
    const custom_image_quality = value << 8
    const option = message.OptionMessage.fromPartial({ custom_image_quality })
    const misc = message.Misc.fromPartial({ option })
    this._ws?.sendMessage({ misc })
    this.setOption('custom_image_quality', value.toString())
    this.setOption('image_quality', 'custom')
  }

  setCustomFps (fps) {
    const option = message.OptionMessage.fromPartial({ custom_fps: fps })
    const misc = message.Misc.fromPartial({ option })
    this._ws?.sendMessage({ misc })
    this._lastSendFps = fps
    this.setOption('custom-fps', fps.toString())
  }

  send2fa (code) {
    console.warn('send2fa() not implemented', code)
  }

  elevateDirect () {
    const elevation_request = message.ElevationRequest.fromPartial({ direct: true })
    const misc = message.Misc.fromPartial({ elevation_request })
    this._ws?.sendMessage({ misc })
    this._elevationRequested = true
  }

  elevateWithLogon (arg) {
    try {
      const { username, password } = JSON.parse(arg)
      const logon = message.ElevationRequestWithLogon.fromPartial({ username, password })
      const elevation_request = message.ElevationRequest.fromPartial({ logon })
      const misc = message.Misc.fromPartial({ elevation_request })
      this._ws?.sendMessage({ misc })
      this._elevationRequested = true
    } catch (e) {
      console.error('Failed to elevate with logon', e)
    }
  }

  // Ignores its own arg on purpose - bridge.dart's sessionChangePreferCodec
  // takes none either (matches the legacy bundle's own zero-arg version).
  // The actual codec preference is already stored via the existing
  // option:session plumbing (Settings writes "codec-preference"/"i444"
  // through setOption like any other session option) - this just re-sends
  // the resulting capability set to the peer.
  changePreferCodec () {
    const supported_decoding = this.getSupportedDecoding()
    const option = message.OptionMessage.fromPartial({ supported_decoding })
    const misc = message.Misc.fromPartial({ option })
    this._ws?.sendMessage({ misc })
  }

  getSupportedDecoding () {
    const PreferCodec = message.SupportedDecoding_PreferCodec
    const codecPref = this.getOption('codec-preference')
    let prefer = PreferCodec.Auto
    if (codecPref === 'vp8') prefer = PreferCodec.VP8
    else if (codecPref === 'vp9') prefer = PreferCodec.VP9
    else if (codecPref === 'av1') prefer = PreferCodec.AV1
    else if (codecPref === 'h264') prefer = PreferCodec.H264
    else if (codecPref === 'h265') prefer = PreferCodec.H265
    const prefer_chroma = this.getOption('i444') === 'Y' ? message.Chroma.I444 : message.Chroma.I420
    return message.SupportedDecoding.fromPartial({
      ability_vp8: 1,
      ability_vp9: 1,
      ability_av1: 1,
      ability_h264: 1,
      ability_h265: 1,
      prefer,
      prefer_chroma,
      i444: message.CodecAbility.fromPartial({ vp9: true, av1: true }),
    })
  }

  // Backs the codec picker in Settings - which codecs it's actually worth
  // offering depends on both what the peer can encode (_supportedEncoding,
  // set from peer_info.encoding in handlePeerInfo) and what this browser
  // claims it can decode (getSupportedDecoding's ability_* fields, which
  // are unconditionally 1 above - ffmpeg-core.wasm decodes all five).
  getAlternativeCodecs () {
    const enc = this._supportedEncoding || {}
    const dec = this.getSupportedDecoding()
    return JSON.stringify({
      vp8: !!enc.vp8 && dec.ability_vp8 === 1,
      av1: !!enc.av1 && dec.ability_av1 === 1,
      h264: !!enc.h264 && dec.ability_h264 === 1,
      h265: !!enc.h265 && dec.ability_h265 === 1,
    })
  }

  sendNote (connId, note) {
    console.warn('sendNote() not implemented', connId, note)
  }

  // Real bug, not just a gap: chat_message is NOT a top-level Message
  // oneof field - confirmed directly against the real message.proto,
  // which only has it inside Misc (message Misc { ... ChatMessage
  // chat_message = 4; ... }). The original version of this method built
  // `{ chat_message }` directly as if Message had that field - ts-proto's
  // fromPartial/encode silently ignores object keys that don't match any
  // real field, so every outgoing chat message was actually sent as an
  // empty Message with nothing set at all. Wrapping in Misc is the fix;
  // receiving already goes through handleMisc()'s misc.chat_message
  // branch above, which was real all along (only its pushEvent name was
  // wrong - see that branch's own comment).
  sendChat (text) {
    const chat_message = message.ChatMessage.fromPartial({ text })
    const misc = message.Misc.fromPartial({ chat_message })
    this._ws?.sendMessage({ misc })
  }

  setAuditGuid (guid) {
    console.warn('setAuditGuid() not implemented', guid)
  }

  // FileAction/FileResponse field names confirmed against hbb_common's real
  // message.proto (fetched directly, same discipline as the toolbar/codec
  // batch) AND against the actual ts-proto-generated output already
  // committed for the legacy v1 webclient (src/utils/webclient/message.ts) -
  // that file is generated by the exact same protoc-gen-ts_proto tool this
  // v2 client's own gitignored message.ts is built with (see
  // Rustdesk-Server-Installer/lib.sh's build_webclient_protos()), so its
  // naming conventions (oneofs flattened as optional properties, non-nested
  // enums exported flat) are trustworthy ground truth for fields this
  // session couldn't otherwise verify without a live connection.
  readRemoteDir (value) {
    try {
      const e = JSON.parse(value)
      const read_dir = message.ReadDir.fromPartial({ path: e.path, include_hidden: !!e.include_hidden })
      this._ws?.sendMessage({ file_action: message.FileAction.fromPartial({ read_dir }) })
    } catch (err) {
      console.error('Failed to read remote dir: ' + err.message)
    }
  }

  createDir (value) {
    try {
      const e = JSON.parse(value)
      const create = message.FileDirCreate.fromPartial({ id: e.id, path: e.path })
      this._ws?.sendMessage({ file_action: message.FileAction.fromPartial({ create }) })
    } catch (err) {
      console.error('Failed to create dir: ' + err.message)
    }
  }

  removeFile (value) {
    try {
      const e = JSON.parse(value)
      const remove_file = message.FileRemoveFile.fromPartial({ id: e.id, path: e.path, file_num: e.file_num })
      this._ws?.sendMessage({ file_action: message.FileAction.fromPartial({ remove_file }) })
    } catch (err) {
      console.error('Failed to remove file: ' + err.message)
    }
  }

  renameFile (value) {
    try {
      const e = JSON.parse(value)
      const rename = message.FileRename.fromPartial({ id: e.id, path: e.path, new_name: e.new_name })
      this._ws?.sendMessage({ file_action: message.FileAction.fromPartial({ rename }) })
    } catch (err) {
      console.error('Failed to rename file: ' + err.message)
    }
  }

  // web/web_unique.dart's webselectFiles - opens a browser file (or, with
  // is_folder, a webkitdirectory) picker and reports each pick back via
  // pushEvent("selected_files", {handleIndex, file}), matching
  // FileModel.onSelectedFiles's exact expected shape (a JSON-encoded
  // Entry with entry_type/name/size/modified_time). Dart then turns around
  // and calls setByName("send_local_files", {..., handle_index}) per file,
  // which sendLocalFiles() below resolves back to the real browser File
  // object via _pendingFileHandles. There's no local directory browsing on
  // web at all (FileModel only calls localController.onReady()/refresh()
  // when !isWeb, and sessionReadLocalDirSync throws UnimplementedError in
  // bridge.dart directly) - a flat multi-file/folder picker is the actual
  // ceiling for "local file browsing" in a browser, not a gap to close.
  selectFiles (arg) {
    const isFolder = arg === 'true' || arg === true
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (isFolder) input.webkitdirectory = true
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      for (const file of input.files) {
        const idx = this._pendingFileHandles.length
        this._pendingFileHandles.push(file)
        const entry = {
          entry_type: message.FileType.File,
          name: file.webkitRelativePath || file.name,
          size: file.size,
          modified_time: Math.floor(file.lastModified / 1000),
        }
        globals.pushEvent('selected_files', { handleIndex: String(idx), file: JSON.stringify(entry) })
      }
      input.remove()
    })
    input.click()
  }

  // Remote -> local download (session_send_files, is_remote=true only -
  // uploading isn't meaningful for this method, that's sendLocalFiles).
  // Directory downloads are intentionally NOT supported yet: FileTransferBlock/
  // FileTransferDone only carry a bare file_num index, never a filename, so
  // multi-file transfers require the client to already know the full,
  // ordered file listing beforehand (the native Rust client gets this from
  // its own recursive directory walk before calling add_job - not
  // reproducible here without a live connection to confirm the exact
  // ordering contract). Single-file download doesn't have this ambiguity
  // (file_num is always 0), so that's what's implemented.
  sendFiles (value) {
    try {
      const e = JSON.parse(value)
      if (!e.is_remote) {
        console.warn('sendFiles(): local -> local is not a real transfer, ignoring', e)
        return
      }
      if (e.is_dir) {
        console.warn('sendFiles(): directory download is not yet supported on web - download files individually. See curConn.js', e)
        globals.pushEvent('job_error', { id: String(e.id), err: 'Directory download is not yet supported on the web client - please download files individually.', file_num: '0' })
        return
      }
      const fileName = String(e.path).split(/[\\/]/).pop() || 'download'
      this._downloads.set(e.id, { fileName, chunks: [], receivedSize: 0, startTime: Date.now(), lastTime: Date.now(), lastBytes: 0 })
      const send = message.FileTransferSendRequest.fromPartial({
        id: e.id, path: e.path, include_hidden: !!e.include_hidden, file_num: e.file_num || 0,
      })
      this._ws?.sendMessage({ file_action: message.FileAction.fromPartial({ send }) })
    } catch (err) {
      console.error('Failed to start download: ' + err.message)
    }
  }

  // Local -> remote upload. Streams the already-picked browser File (see
  // selectFiles()) as FileTransferBlock chunks under file_response (the
  // browser is the "sender" here, same message type the remote uses when
  // streaming a download - FileResponse isn't direction-fixed, it's just
  // "here are file transfer bytes for id/file_num", confirmed by
  // FileTransferSendConfirmRequest living in the FileAction oneof instead,
  // i.e. requests always flow as file_action regardless of which side is
  // about to send bytes). No resume/digest/compression support - always a
  // full send from offset 0; see plan doc for what's still open.
  sendLocalFiles (value) {
    try {
      const e = JSON.parse(value)
      const file = this._pendingFileHandles[e.handle_index]
      if (!file) {
        console.error('sendLocalFiles(): no local file for handle_index ' + e.handle_index)
        globals.pushEvent('job_error', { id: String(e.id), err: 'Local file handle not found', file_num: '0' })
        return
      }
      this._uploadFile(e.id, e.file_num || 0, e.to, file)
    } catch (err) {
      console.error('Failed to start upload: ' + err.message)
    }
  }

  async _uploadFile (id, fileNum, to, file) {
    const CHUNK_SIZE = 256 * 1024
    this._uploadCancelled.delete(id)
    try {
      const entry = message.FileEntry.fromPartial({
        entry_type: message.FileType.File,
        name: file.name,
        size: file.size,
        modified_time: Math.floor(file.lastModified / 1000),
      })
      const receive = message.FileTransferReceiveRequest.fromPartial({
        id, path: to, files: [entry], file_num: fileNum, total_size: file.size,
      })
      this._ws?.sendMessage({ file_action: message.FileAction.fromPartial({ receive }) })

      let offset = 0
      let blkId = 0
      const startTime = Date.now()
      let lastTime = startTime
      let lastBytes = 0
      while (offset < file.size) {
        if (this._uploadCancelled.has(id)) return
        const slice = file.slice(offset, offset + CHUNK_SIZE)
        const data = new Uint8Array(await slice.arrayBuffer())
        const block = message.FileTransferBlock.fromPartial({ id, file_num: fileNum, data, compressed: false, blk_id: blkId })
        this._ws?.sendMessage({ file_response: message.FileResponse.fromPartial({ block }) })
        offset += data.length
        blkId += 1
        const now = Date.now()
        if (now - lastTime >= 500 || offset >= file.size) {
          const speed = (offset - lastBytes) / (((now - lastTime) || 1) / 1000)
          globals.pushEvent('job_progress', { id: String(id), file_num: String(fileNum), speed: String(speed), finished_size: String(offset) })
          lastTime = now
          lastBytes = offset
        }
      }
      if (this._uploadCancelled.has(id)) return
      const done = message.FileTransferDone.fromPartial({ id, file_num: fileNum })
      this._ws?.sendMessage({ file_response: message.FileResponse.fromPartial({ done }) })
      globals.pushEvent('job_done', { id: String(id), file_num: String(fileNum), speed: '0' })
    } catch (err) {
      console.error('Upload failed: ' + err.message)
      globals.pushEvent('job_error', { id: String(id), err: err.message, file_num: String(fileNum) })
    } finally {
      this._uploadCancelled.delete(id)
    }
  }

  // FileResponse - the stream of results for whichever side currently has
  // data to hand back (directory listings, download bytes, errors). See
  // handleFileResponse() below for the dispatch, msgLoop() for where this
  // is fed in.
  async handleFileResponse (fr) {
    if (fr.dir) {
      const fd = fr.dir
      globals.pushEvent('file_dir', {
        is_local: 'false',
        value: JSON.stringify({
          id: fd.id,
          path: fd.path,
          entries: (fd.entries || []).map((e) => ({
            entry_type: e.entry_type,
            name: e.name,
            size: Number(e.size),
            modified_time: Number(e.modified_time),
          })),
        }),
      })
    } else if (fr.error) {
      const err = fr.error
      globals.pushEvent('job_error', { id: String(err.id), err: err.error, file_num: String(err.file_num) })
    } else if (fr.digest) {
      const dl = this._downloads.get(fr.digest.id)
      if (dl) dl.totalSize = Number(fr.digest.file_size)
    } else if (fr.block) {
      await this._handleFileBlock(fr.block)
    } else if (fr.done) {
      this._handleFileDone(fr.done)
    }
  }

  async _handleFileBlock (block) {
    const dl = this._downloads.get(block.id)
    if (!dl) return
    let data = block.data
    if (block.compressed) {
      const { decompress } = await import('./common')
      try {
        data = await decompress(data)
      } catch (e) {
        console.error('Failed to decompress download block', e)
        globals.pushEvent('job_error', { id: String(block.id), err: 'Failed to decompress a block of this file: ' + e.message, file_num: String(block.file_num) })
        this._downloads.delete(block.id)
        return
      }
    }
    dl.chunks.push(data)
    dl.receivedSize += data.length
    const now = Date.now()
    if (now - dl.lastTime >= 500) {
      const speed = (dl.receivedSize - dl.lastBytes) / (((now - dl.lastTime) || 1) / 1000)
      globals.pushEvent('job_progress', {
        id: String(block.id), file_num: String(block.file_num), speed: String(speed), finished_size: String(dl.receivedSize),
      })
      dl.lastTime = now
      dl.lastBytes = dl.receivedSize
    }
  }

  _handleFileDone (done) {
    const dl = this._downloads.get(done.id)
    if (!dl) return
    const blob = new Blob(dl.chunks)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = dl.fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
    globals.pushEvent('job_progress', { id: String(done.id), file_num: String(done.file_num), speed: '0', finished_size: String(dl.receivedSize) })
    globals.pushEvent('job_done', { id: String(done.id), file_num: String(done.file_num), speed: '0' })
    this._downloads.delete(done.id)
  }

  cancelJob (jobId) {
    const id = parseInt(jobId, 10)
    this._uploadCancelled.add(id)
    this._downloads.delete(id)
    const cancel = message.FileTransferCancel.fromPartial({ id })
    this._ws?.sendMessage({ file_action: message.FileAction.fromPartial({ cancel }) })
  }

  // Terminal - TerminalAction/TerminalResponse, confirmed against the real
  // message.proto ("Terminal messages - standalone feature like
  // FileAction" per its own comment there) and against
  // models/terminal_model.dart's handleTerminalResponse, which explicitly
  // branches on string vs int fields with a comment noting "Web sends
  // terminal_id as a string" - i.e. this exact JSON-over-pushEvent shape is
  // something the recovered engine already anticipated for a web build.
  openTerminal (value) {
    try {
      const e = JSON.parse(value)
      const open = message.OpenTerminal.fromPartial({ terminal_id: e.terminal_id, rows: e.rows, cols: e.cols })
      this._ws?.sendMessage({ terminal_action: message.TerminalAction.fromPartial({ open }) })
    } catch (err) {
      console.error('Failed to open terminal: ' + err.message)
    }
  }

  sendTerminalInput (value) {
    try {
      const e = JSON.parse(value)
      const data = new TextEncoder().encode(e.data)
      const term_data = message.TerminalData.fromPartial({ terminal_id: e.terminal_id, data, compressed: false })
      this._ws?.sendMessage({ terminal_action: message.TerminalAction.fromPartial({ data: term_data }) })
    } catch (err) {
      console.error('Failed to send terminal input: ' + err.message)
    }
  }

  resizeTerminal (value) {
    try {
      const e = JSON.parse(value)
      const resize = message.ResizeTerminal.fromPartial({ terminal_id: e.terminal_id, rows: e.rows, cols: e.cols })
      this._ws?.sendMessage({ terminal_action: message.TerminalAction.fromPartial({ resize }) })
    } catch (err) {
      console.error('Failed to resize terminal: ' + err.message)
    }
  }

  closeTerminal (value) {
    try {
      const e = JSON.parse(value)
      const close = message.CloseTerminal.fromPartial({ terminal_id: e.terminal_id })
      this._ws?.sendMessage({ terminal_action: message.TerminalAction.fromPartial({ close }) })
    } catch (err) {
      console.error('Failed to close terminal: ' + err.message)
    }
  }

  async handleTerminalResponse (tr) {
    if (tr.opened) {
      const o = tr.opened
      globals.pushEvent('terminal_response', {
        type: 'opened',
        terminal_id: String(o.terminal_id),
        success: String(!!o.success),
        message: o.message || '',
        service_id: o.service_id || '',
        persistent_sessions: o.persistent_sessions || [],
        replay_terminal_output: !!o.replay_terminal_output,
      })
    } else if (tr.data) {
      let bytes = tr.data.data
      if (tr.data.compressed) {
        const { decompress } = await import('./common')
        try {
          bytes = await decompress(bytes)
        } catch (e) {
          console.warn('Dropping compressed terminal output - decompress failed', e)
          return
        }
      }
      globals.pushEvent('terminal_response', {
        type: 'data',
        terminal_id: String(tr.data.terminal_id),
        data: bytesToBase64(bytes),
      })
    } else if (tr.closed) {
      const c = tr.closed
      globals.pushEvent('terminal_response', { type: 'closed', terminal_id: String(c.terminal_id), exit_code: String(c.exit_code) })
    } else if (tr.error) {
      const e = tr.error
      globals.pushEvent('terminal_response', { type: 'error', terminal_id: String(e.terminal_id), message: e.message })
    }
  }

  restart () {
    this._restartingRemoteDevice = true
    const misc = message.Misc.fromPartial({ restart_remote_device: true })
    this._ws?.sendMessage({ misc })
  }

  getStatus () {
    return JSON.stringify({ status_num: this._ws ? 1 : 0 })
  }

  // bridge.dart's sessionGetConnSessionId - a low-traffic info getter with
  // no real native equivalent to read on web, so mint a fresh id per
  // connection attempt (same lazy-init pattern as _peerInfo).
  getConnSessionId () {
    if (!this._connSessionId) {
      this._connSessionId = 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    }
    return this._connSessionId
  }

  getFlutterUiOption (name) {
    return this.getOption(`flutter:${name}`) || ''
  }

  setFlutterUiOption (name, value) {
    this.setOption(`flutter:${name}`, value)
  }

  enterOrLeave (enter) {
    console.warn('enterOrLeave() not implemented', enter)
  }
}

function testDelay () {
  // v1 raced all of HOSTS (its public relay fleet) to pick the nearest one
  // - meaningless here, there's exactly one server to talk to (whatever
  // the admin configured). Just log its latency; never crash startup over
  // it - a slow/unreachable relay test shouldn't block the login gate or
  // the engine bootstrap that's waiting on initBridge().
  const host = localStorage.getItem('custom-rendezvous-server')
  if (!host) {
    console.warn('testDelay: no custom-rendezvous-server configured, skipping')
    return
  }
  const now = new Date().getTime()
  try {
    new Websock(getrUriFromRs(host), true).open().then(() => {
      console.log('latency of ' + host + ': ' + (new Date().getTime() - now))
    }).catch((e) => {
      console.warn('testDelay: could not reach ' + host, e)
    })
  } catch (e) {
    console.warn('testDelay: could not reach ' + host, e)
  }
}

// v1 ran this unconditionally at module load - kept as an exported function
// instead of a side effect, so importing this module for other reasons
// (e.g. just the class, in a test) doesn't open six sockets. Call it once
// at webclient app startup instead.
export { testDelay }

// bridge.dart's queryOnlines - decompiled from the real (up-to-date)
// legacy webclient bundle rather than guessed, after an earlier pass
// wrongly concluded this needed new backend work. It doesn't: hbbs (the
// rendezvous server, the same one _start()'s punch_hole_request already
// talks to) natively supports an online-status check via
// RendezvousMessage.online_request/.online_response - a short-lived
// WebSocket opened just for this query, matching the legacy bundle's own
// "WebSock.onopen query onlines" / "WebSock.onclose query onlines" log
// lines exactly. OnlineResponse.states is a bitset (bytes), one bit per
// queried peer in request order, MSB-first within each byte
// (byte = i>>3, mask = 1<<(7-(i&7))) - confirmed against the decompiled
// bundle's own bit-unpacking loop, not guessed.
//
// Result goes through pushRegisteredEvent, not pushEvent -
// models/peer_model.dart's Peers class listens for
// "callback_query_onlines" via platformFFI.registerEventHandler(), a
// separate JS entry point (window.onRegisteredEvent) from the generic
// fixed-branch one (window.onGlobalEvent) pushEvent() talks to - see
// globals.js's own header comment on makeEventChannel(). Sending it
// through pushEvent reaches Dart's generic else-branch instead, which
// just logs "Event is not handled in the fixed branch:
// callback_query_onlines" and does nothing - confirmed live, this was
// the actual reason the online-status indicator never updated even
// after the real hbbs round trip below started working.
function getQueryClientId () {
  let id = localStorage.getItem('webclient-query-id')
  if (!id) {
    id = 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    localStorage.setItem('webclient-query-id', id)
  }
  return id
}

export async function queryOnlines (arg) {
  let ids = []
  try {
    ids = JSON.parse(arg)
  } catch (e) {
    console.error('Failed to query onlines: ' + e.message)
    return
  }
  if (ids.length === 0) return
  const ws = new Websock(getDefaultUri(), true)
  try {
    await ws.open()
    const online_request = rendezvous.OnlineRequest.fromPartial({ id: getQueryClientId(), peers: ids })
    ws.sendRendezvous({ online_request })
  } catch (e) {
    console.error('Failed to query onlines: ' + e)
    globals.pushRegisteredEvent('callback_query_onlines', { onlines: '', offlines: ids.join(',') })
    ws.close()
    return
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let msg
    try {
      msg = await ws.next(3000)
    } catch (e) {
      continue
    }
    if (!msg || msg.key_exchange || msg.online_response === undefined) continue
    const states = msg.online_response.states
    const onlines = []
    const offlines = []
    for (let i = 0; i < ids.length; i++) {
      const byteIdx = i >> 3
      const bitMask = 1 << (7 - (i & 7))
      if ((states[byteIdx] & bitMask) === bitMask) onlines.push(ids[i])
      else offlines.push(ids[i])
    }
    globals.pushRegisteredEvent('callback_query_onlines', { onlines: onlines.join(','), offlines: offlines.join(',') })
    ws.close()
    return
  }
  ws.close()
  console.error('Failed to query online states, no online response')
}

function getDefaultUri (isRelay = false) {
  const host = localStorage.getItem('custom-rendezvous-server')
  return getrUriFromRs(host || defaultRendezvousHost(), isRelay)
}

// Faithful port of the legacy bundled webclient's own `pe(u, e)` (see the
// comment above ID_PORT/RELAY_PORT for why this replaced v1's simpler
// version). `roffset` from the old signature is gone - the real bundle
// always adds +2 to an explicitly-given port regardless of isRelay
// (matches connectRelay's own v1-era `roffset=2` override below, which
// happened to already agree with this).
function getrUriFromRs (uri, isRelay = false) {
  if (hasWsScheme(uri)) return uri
  const port = isRelay ? RELAY_PORT : ID_PORT
  const path = isRelay ? '/ws/relay' : '/ws/id'
  const scheme = isHttps() ? 'wss' : 'ws'

  if (isIPv4(uri)) {
    const idx = uri.indexOf(':')
    if (idx !== -1) {
      const host = uri.substring(0, idx)
      const p = parseInt(uri.substring(idx + 1))
      return isNaN(p) ? `${scheme}://${host}:${port}` : `${scheme}://${host}:${p + 2}`
    }
    return `${scheme}://${uri}:${port}`
  }
  if (isIPv6(uri)) {
    const idx = uri.lastIndexOf(']')
    if (idx !== -1) {
      const host = uri.substring(0, idx + 1)
      const p = parseInt(uri.substring(idx + 2))
      return isNaN(p) ? `${scheme}://${host}:${port}` : `${scheme}://${host}:${p + 2}`
    }
    return uri.startsWith('[') ? `${scheme}://${uri}:${port}` : `${scheme}://[${uri}]:${port}`
  }
  if (uri.includes(':')) {
    if (isDomainWithPort(uri)) {
      const host = uri.split(':')[0]
      return `${scheme}://${host}${path}`
    }
  } else if (isDomain(uri)) {
    return `${scheme}://${uri}${path}`
  }
  return uri
}

function hash (datas) {
  const hasher = new sha256.Hash()
  datas.forEach((data) => {
    if (typeof data === 'string') {
      data = new TextEncoder().encode(data)
    }
    return hasher.update(data)
  })
  return hasher.digest()
}
