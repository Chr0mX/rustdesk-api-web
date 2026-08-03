import Websock from '@/utils/webclient/websock'
import * as rendezvous from '@/utils/webclient/rendezvous'
import * as message from '@/utils/webclient/message'
import { ElMessageBox } from 'element-plus'
import { T } from '@/utils/i18n'
import { useAppStore } from '@/store/app'
import { webclientSession } from '@/api/config'

const app = useAppStore()

// Real bug, not just a leftover: a `?token=<_admin access token>` on the
// OUTER /webclient/ page URL does nothing at all in the webclient v2 app
// (src/webclient) - confirmed by grep, nothing there ever reads
// location.search/route.query.token. That app authenticates itself in one
// of two ways: its own login form, or router/index.js's beforeEach guard
// calling tryWebclientSessionBridge() (src/webclient/api/user.js), which
// depends entirely on the wc_sess cookie set by webclientSession() below -
// never on this page's own query string. Engine.vue's later
// `/webclient-config/index.js?token=...` call does pass a token, but it's
// the webclient app's OWN internal access_token (populated by one of the
// two paths above), not anything derived from this URL.
//
// _admin's login flow (store/user.js:saveUserData) already calls
// webclientSession() once, right after login, for exactly this reason -
// see that function's own comment ("so opening the webclient afterwards
// doesn't need a ?token= in the URL"). But that cookie can go stale (or
// never have been set - e.g. a session that predates this bridge, or a
// shorter cookie lifetime than the access token) long before the admin
// actually clicks this button, which is what made it look like the
// button "does nothing" - the webclient tab opens, finds no usable
// session, and silently falls back to its own login screen instead of
// the requested peer.
//
// Fix: call webclientSession() fresh right before opening the link, the
// same way login does, so the cookie is guaranteed current regardless of
// session age. The blank window is opened synchronously, in the same
// click-handler tick, so browsers don't treat it as an unrequested
// popup; its location is only set once the cookie POST has actually
// resolved, so the new tab's own /webclient-config/index.js request goes
// out after the cookie exists.
export const toWebClientLink = async (row) => {
  const win = window.open('', '_blank')
  const url = `${app.setting.rustdeskConfig.api_server}/webclient/#/${row.id}`
  try {
    await webclientSession()
  } catch (e) {
    // Best-effort, same as saveUserData()'s own call - the webclient app's
    // own login form is still there as a fallback if this fails.
  }
  if (win) win.location.href = url
  else window.open(url)
}

export async function getPeerSlat (id) {
  const [addr, port] = app.setting.rustdeskConfig.id_server.split(':')
  if (!addr) {
    return
  }
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new Websock(`${scheme}://${addr}:21118`, true)
  await ws.open()
  const conn_type = rendezvous.ConnType.DEFAULT_CONN
  const nat_type = rendezvous.NatType.SYMMETRIC
  const punch_hole_request = rendezvous.PunchHoleRequest.fromPartial({
    id,
    licence_key: app.setting.rustdeskConfig.value.key || undefined,
    conn_type,
    nat_type,
    token: undefined,
  })
  ws.sendRendezvous({ punch_hole_request })
  //rendezvous.RendezvousMessage
  const msg = (await ws.next())
  ws.close()
  console.log(new Date() + ': Got relay response', msg)
  const phr = msg.punch_hole_response
  const rr = msg.relay_response
  if (phr) {
    if (phr?.other_failure) {
      this.msgbox('error', 'Error', phr?.other_failure)
      return
    }
    if (phr.failure != rendezvous.PunchHoleResponse_Failure.UNRECOGNIZED) {
      switch (phr?.failure) {
        case rendezvous.PunchHoleResponse_Failure.ID_NOT_EXIST:
          ElMessageBox.alert(T('IDNotExist'), T('Error'))
          break
        case rendezvous.PunchHoleResponse_Failure.OFFLINE:
          ElMessageBox.alert(T('RemoteDesktopOffline'), T('Error'))
          break
        case rendezvous.PunchHoleResponse_Failure.LICENSE_MISMATCH:
          ElMessageBox.alert(T('KeyMismatch'), T('Error'))
          break
        case rendezvous.PunchHoleResponse_Failure.LICENSE_OVERUSE:
          ElMessageBox.alert(T('KeyOveruse'), T('Error'))
          break
      }
    }
    return false
  } else if (rr) {
    const uuid = rr.uuid
    console.log(new Date() + ': Connecting to relay server')

    const _ws = new Websock(`${scheme}://${addr}:21119`, false)
    await _ws.open()
    console.log(new Date() + ': Connected to relay server')
    const request_relay = rendezvous.RequestRelay.fromPartial({
      licence_key: app.setting.rustdeskConfig.key || undefined,
      uuid,
    })
    _ws.sendRendezvous({ request_relay })

    //暂不支持pk
    const public_key = message.PublicKey.fromPartial({})
    _ws?.sendMessage({ public_key })
    // const secure = (await this.secure(pk)) || false;
    // globals.pushEvent("connection_ready", { secure, direct: false });
    while (true) {
      const msg = (await _ws?.next())
      console.log('msg', msg)
      if (msg?.hash) {
        console.log('hash msg.....', msg.hash)
        _ws.close()
        return msg.hash
      }
    }
    return false
  }

}

export function getV2ShareUrl (token) {
  // share_token has to be a real query param (before the #), not part of
  // the SPA hash route: the server's auth gate (middleware.WebclientAuth)
  // reads it off the request's query string to decide whether to hand out
  // the real id-server/relay-server/key, and fragments are never sent to
  // the server at all.
  return `${app.setting.rustdeskConfig.api_server}/webclient/?share_token=${token}#/`
}
