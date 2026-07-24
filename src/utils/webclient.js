import Websock from '@/utils/webclient/websock'
import * as rendezvous from '@/utils/webclient/rendezvous'
import * as message from '@/utils/webclient/message'
import { ElMessageBox } from 'element-plus'
import { T } from '@/utils/i18n'
import { useAppStore } from '@/store/app'
import { getToken } from '@/utils/auth'



const app = useAppStore()

export const toWebClientLink = (row) => {
  // webclient2 was removed upstream (DMCA takedown). The server now bundles
  // a single client (a current v2-style build) at /webclient/, replacing
  // the old v1 (flutter_hbb) build that used to live there.
  //
  // The server only hands out the real id-server/relay-server/api-server/
  // key (see rustdesk-api's ConfigJs + middleware.WebclientAuth) to
  // visitors who show up with a valid api-token or share_token - otherwise
  // those values would be readable by anyone, unauthenticated. Since we're
  // already logged in here, pass our token along so the webclient actually
  // gets a working config instead of a blank one.
  const token = getToken()
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  window.open(`${app.setting.rustdeskConfig.api_server}/webclient/${query}#/${row.id}`)
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
