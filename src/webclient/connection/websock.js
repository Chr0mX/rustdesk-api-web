// Ported from Chr0mX/rustdesk's flutter/web/js/src/websock.ts (v1, recovered
// in Phase 2 - see docs/WEBCLIENT_V2_REBUILD_PLAN.md), stripped of
// TypeScript types to match this project's plain-JS convention. Logic is
// unchanged from the original.
//
// Depends on ./message and ./rendezvous, which don't exist yet in this
// tree - they're generated (as message.ts/rendezvous.ts) at build time via
// protoc/ts-proto against rustdesk-server's libs/hbb_common/*.proto (see
// v1's ts_proto.py; v1 never committed these either, they were always
// gitignored). Imported without an extension, not "./message.js" like v1
// did - v1 had its own tsconfig.json where a ".js"-suffixed import
// resolving to a ".ts" file is a normal TS-ESM convention; this plain-JS
// Vite project has no TypeScript compiler in its resolution pipeline, so
// an explicit ".js" extension would only ever look for a literal
// message.js and never find the generated .ts file. See this directory's
// README.md for the actual protoc/ts-proto command to run. This file is
// otherwise complete and should work unmodified once that codegen step is
// wired up as part of Phase 2/4's build.
import * as message from './message'
import * as rendezvous from './rendezvous'
import * as globals from './globals'

export default class Websock {
  constructor (uri, isRendezvous = true) {
    this._eventHandlers = {
      message: (_) => {},
      open: () => {},
      close: () => {},
      error: () => {},
    }
    this._uri = uri
    this._status = ''
    this._buf = []
    this._websocket = new WebSocket(uri)
    this._websocket.onmessage = this._recv_message.bind(this)
    this._websocket.binaryType = 'arraybuffer'
    this._latency = new Date().getTime()
    this._isRendezvous = isRendezvous
  }

  latency () {
    return this._latency
  }

  setSecretKey (key) {
    this._secretKey = [key, 0, 0]
  }

  sendMessage (json) {
    let data = message.Message.encode(
      message.Message.fromPartial(json),
    ).finish()
    const k = this._secretKey
    if (k) {
      k[1] += 1
      data = globals.encrypt(data, k[1], k[0])
    }
    this._websocket.send(data)
  }

  sendRendezvous (data) {
    this._websocket.send(
      rendezvous.RendezvousMessage.encode(
        rendezvous.RendezvousMessage.fromPartial(data),
      ).finish(),
    )
  }

  parseMessage (data) {
    return message.Message.decode(data)
  }

  parseRendezvous (data) {
    return rendezvous.RendezvousMessage.decode(data)
  }

  // Event Handlers
  off (evt) {
    this._eventHandlers[evt] = () => {}
  }

  on (evt, handler) {
    this._eventHandlers[evt] = handler
  }

  async open (timeout = 12000) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (this._status !== 'open') {
          reject(this._status || 'Timeout')
        }
      }, timeout)
      this._websocket.onopen = () => {
        this._latency = new Date().getTime() - this._latency
        this._status = 'open'
        console.debug('>> WebSock.onopen')
        if (this._websocket?.protocol) {
          console.info(
            'Server choose sub-protocol: ' + this._websocket.protocol,
          )
        }

        this._eventHandlers.open()
        console.info('WebSock.onopen')
        resolve(this)
      }
      this._websocket.onclose = (e) => {
        if (this._status === 'open') {
          // e.code 1000 means that the connection was closed normally.
        }
        this._status = e
        console.error('WebSock.onclose: ')
        console.error(e)
        this._eventHandlers.close(e)
        reject('Reset by the peer')
      }
      this._websocket.onerror = (e) => {
        if (!this._status) {
          reject('Failed to connect to ' + (this._isRendezvous ? 'rendezvous' : 'relay') + ' server')
          return
        }
        this._status = e
        console.error('WebSock.onerror: ')
        console.error(e)
        this._eventHandlers.error(e)
      }
    })
  }

  async next (timeout = 12000) {
    const func = (resolve, reject, tm0) => {
      if (this._buf.length) {
        resolve(this._buf[0])
        this._buf.splice(0, 1)
      } else {
        if (this._status !== 'open') {
          reject(this._status)
          return
        }
        if (new Date().getTime() > tm0 + timeout) {
          reject('Timeout')
        } else {
          setTimeout(() => func(resolve, reject, tm0), 1)
        }
      }
    }
    return new Promise((resolve, reject) => {
      func(resolve, reject, new Date().getTime())
    })
  }

  close () {
    this._status = ''
    if (this._websocket) {
      if (
        this._websocket.readyState === WebSocket.OPEN ||
        this._websocket.readyState === WebSocket.CONNECTING
      ) {
        console.info('Closing WebSocket connection')
        this._websocket.close()
      }

      this._websocket.onmessage = () => {}
    }
  }

  _recv_message (e) {
    if (e.data instanceof window.ArrayBuffer) {
      let bytes = new Uint8Array(e.data)
      const k = this._secretKey
      if (k) {
        k[2] += 1
        bytes = globals.decrypt(bytes, k[2], k[0])
      }
      this._buf.push(
        this._isRendezvous
          ? this.parseRendezvous(bytes)
          : this.parseMessage(bytes),
      )
    }
    this._eventHandlers.message(e.data)
  }
}
