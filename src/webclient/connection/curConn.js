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

const PORT = 21116
const HOSTS = [
  'rs-sg.rustdesk.com',
  'rs-cn.rustdesk.com',
  'rs-us.rustdesk.com',
]
let HOST = localStorage.getItem('rendezvous-server') || HOSTS[0]
const SCHEMA = 'ws://'

export default class CurConn {
  constructor () {
    this._msgs = []
    this._id = ''
    this._videoTestSpeed = [0, 0]
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
    if (!this._options) {
      this._options = globals.getPeers()[id] || {}
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
      uri = getrUriFromRs(uri, true, 2)
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
          const c = await decompress(cb.content)
          if (!c) continue
          cb.content = c
        }
        try {
          globals.copyToClipboard(new TextDecoder().decode(cb.content))
        } catch (e) {
          console.error(e)
        }
      } else if (msg?.cursor_data) {
        const { decompress } = await import('./common')
        const cd = msg?.cursor_data
        const c = await decompress(cd.colors)
        if (!c) continue
        cd.colors = c
        globals.pushEvent('cursor_data', cd)
      } else if (msg?.cursor_id) {
        globals.pushEvent('cursor_id', { id: msg?.cursor_id })
      } else if (msg?.cursor_position) {
        globals.pushEvent('cursor_position', msg?.cursor_position)
      } else if (msg?.misc) {
        if (!this.handleMisc(msg?.misc)) break
      } else if (msg?.audio_frame) {
        globals.playAudio(msg?.audio_frame.data)
      }
    }
  }

  close () {
    this._msgs = []
    clearInterval(this._interval)
    this._ws?.close()
    this._videoDecoder?.close()
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

  // Adapted for Phase 1's codec decision (reuse ffmpeg-core.wasm, not
  // v1's OGV.js-based vp9s decode) and Phase 3's onRgba contract (draw()
  // now forwards to the Flutter engine instead of painting locally) - see
  // README.md. The actual ffmpeg-core.wasm wiring isn't implemented yet;
  // this preserves v1's control flow (per-frame decode callback, video-
  // received ack, fps tracking) so it's a small diff once that lands.
  handleVideoFrame (vf) {
    if (!this._firstFrame) {
      globals.msgbox('', '', '')
      this._firstFrame = true
    }
    if (!this._videoDecoder) {
      console.warn('handleVideoFrame: no video decoder loaded yet (see loadVideoDecoder)')
      return
    }
    const dec = this._videoDecoder
    const tm = new Date().getTime()
    dec.decode(vf, (display, rgba) => {
      this.sendVideoReceived()
      globals.draw(display, rgba)
      const now = new Date().getTime()
      const elapsed = now - tm
      this._videoTestSpeed[1] += elapsed
      this._videoTestSpeed[0] += 1
      if (this._videoTestSpeed[0] >= 30) {
        console.log('video decoder: ' + parseInt('' + this._videoTestSpeed[1] / this._videoTestSpeed[0]))
        this._videoTestSpeed = [0, 0]
      }
    })
  }

  handlePeerInfo (pi) {
    this._peerInfo = pi
    if (pi.displays.length === 0) {
      globals.msgbox('error', 'Remote Error', 'No Display')
      return
    }
    globals.msgbox('success', 'Successful', 'Connected, waiting for image...')
    globals.pushEvent('peer_info', pi)
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
      globals.pushEvent('chat', { text: misc.chat_message.text })
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

  toggleOption (name) {
    const v = !this._options[name]
    const option = message.OptionMessage.fromPartial({})
    const v2 = v ? message.OptionMessage_BoolOption.Yes : message.OptionMessage_BoolOption.No
    switch (name) {
      case 'show-remote-cursor':
        option.show_remote_cursor = v2
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
      case 'block-input':
        option.block_input = message.OptionMessage_BoolOption.Yes
        break
      case 'unblock-input':
        option.block_input = message.OptionMessage_BoolOption.No
        break
      default:
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
  // stale in Phase 1 findings) - the current bundle uses ffmpeg-core.wasm/
  // libopus.wasm instead, decided but not yet wired up here.
  loadVideoDecoder () {
    this._videoDecoder?.close()
    console.warn('loadVideoDecoder(): ffmpeg-core.wasm wiring not implemented yet (see Phase 1 findings\' codec decision)')
  }

  // --- Everything below is NOT in v1 - stubs matching the setByName/
  // getByName cases Phase 3 found in the live compiled bundle that v1
  // never had (file transfer, terminal, virtual display, elevation, 2FA,
  // codec switching). v1's connection.ts predates all of these - they were
  // added to the real protocol after v1 was last touched (see Phase 1
  // findings item 4: LoginRequest.union gained view_camera/terminal,
  // OptionMessage gained disable_camera/terminal_persistent, etc.).
  // Implementing these needs the actual wire messages for each, which
  // isn't recoverable from v1 - has to be worked out against a real
  // connection once Phase 2's engine build exists to compare against. ---

  toggleVirtualDisplay (value) {
    console.warn('toggleVirtualDisplay() not implemented', value)
  }

  togglePrivacyMode (value) {
    console.warn('togglePrivacyMode() not implemented', value)
  }

  setCustomImageQuality (value) {
    console.warn('setCustomImageQuality() not implemented', value)
  }

  setCustomFps (value) {
    console.warn('setCustomFps() not implemented', value)
  }

  send2fa (code) {
    console.warn('send2fa() not implemented', code)
  }

  elevateDirect () {
    console.warn('elevateDirect() not implemented')
  }

  elevateWithLogon (value) {
    console.warn('elevateWithLogon() not implemented', value)
  }

  changePreferCodec (value) {
    console.warn('changePreferCodec() not implemented', value)
  }

  getAlternativeCodecs () {
    console.warn('getAlternativeCodecs() not implemented')
    return JSON.stringify([])
  }

  sendNote (connId, note) {
    console.warn('sendNote() not implemented', connId, note)
  }

  setAuditGuid (guid) {
    console.warn('setAuditGuid() not implemented', guid)
  }

  readRemoteDir (value) {
    console.warn('readRemoteDir() not implemented - file transfer needs its own protocol messages, see plan doc Phase 5', value)
  }

  sendFiles (value) {
    console.warn('sendFiles() not implemented - file transfer needs its own protocol messages, see plan doc Phase 5', value)
  }

  sendLocalFiles (value) {
    console.warn('sendLocalFiles() not implemented - file transfer needs its own protocol messages, see plan doc Phase 5', value)
  }

  cancelJob (jobId) {
    console.warn('cancelJob() not implemented', jobId)
  }

  restart () {
    console.warn('restart() not implemented')
  }

  getStatus () {
    return JSON.stringify({ status_num: this._ws ? 1 : 0 })
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
  let nearest = ''
  HOSTS.forEach((host) => {
    const now = new Date().getTime()
    new Websock(getrUriFromRs(host), true).open().then(() => {
      console.log('latency of ' + host + ': ' + (new Date().getTime() - now))
      if (!nearest) {
        HOST = host
        localStorage.setItem('rendezvous-server', host)
      }
    })
  })
}

// v1 ran this unconditionally at module load - kept as an exported function
// instead of a side effect, so importing this module for other reasons
// (e.g. just the class, in a test) doesn't open six sockets. Call it once
// at webclient app startup instead.
export { testDelay }

function getDefaultUri (isRelay = false) {
  const host = localStorage.getItem('custom-rendezvous-server')
  return getrUriFromRs(host || HOST, isRelay)
}

function getrUriFromRs (uri, isRelay = false, roffset = 0) {
  if (uri.indexOf(':') > 0) {
    const tmp = uri.split(':')
    const port = parseInt(tmp[1])
    uri = tmp[0] + ':' + (port + (isRelay ? roffset || 3 : 2))
  } else {
    uri += ':' + (PORT + (isRelay ? 3 : 2))
  }
  return SCHEMA + uri
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
