import request from '@/webclient/utils/request'

// Matches rustdesk-api's api.LoginForm - the same POST /api/login every
// native RustDesk client and the legacy webclient's own login page use.
// Any enabled account can sign in here, not just admins.
export function login (username, password) {
  return request({
    url: '/login',
    method: 'post',
    data: {
      username,
      password,
      deviceInfo: { name: navigator.userAgent, os: 'web', type: 'webclient' },
      id: '',
      uuid: '',
    },
  })
}

export function logout () {
  return request({
    url: '/logout',
    method: 'post',
    silentError: true,
  })
}

// Mirrors _admin's own store/user.js:tryWebclientBridge(), in the opposite
// direction. _admin's login (store/user.js:saveUserData) proactively POSTs
// /config/webclient-session right after signing in, which establishes the
// exact wc_sess cookie middleware.WebclientAuth checks - so an admin who's
// already signed into _admin, then opens this webclient, holds a valid
// session before ever touching this app's own login form.
//
// Loading /webclient-config/index.js (no ?token= needed - the cookie
// alone satisfies WebclientAuth's cookie fast-path) re-uses that session:
// ConfigJs (http/controller/web/index.go) embeds the real access_token/
// user_info directly into the served script under the plain (unprefixed)
// keys shared with the Dart core / legacy webclient when it's valid, and
// actively clears those same keys (clearConfigScript) when it isn't - so
// checking them immediately after the script resolves is a reliable
// yes/no, never leftover state from an earlier visit.
export function tryWebclientSessionBridge () {
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = '/webclient-config/index.js'
    const finish = (result) => {
      script.remove()
      resolve(result)
    }
    script.onload = () => {
      const token = localStorage.getItem('access_token')
      const userInfoRaw = localStorage.getItem('user_info')
      if (!token || !userInfoRaw) {
        finish(false)
        return
      }
      try {
        finish({ access_token: token, user: JSON.parse(userInfoRaw) })
      } catch (e) {
        finish(false)
      }
    }
    script.onerror = () => finish(false)
    document.body.appendChild(script)
  })
}

// Mirrors ConfigJs's own clearConfigScript (http/controller/web/index.go)
// exactly - every key it seeds when authed, unprefixed and "wc-" prefixed
// alike. Without this, logging out only cleared this app's own token
// (store/user.js's clearLocal) and revoked the session server-side; the
// connection config a previous /webclient-config/index.js load had
// already written to localStorage (custom-rendezvous-server/api-server/
// relay-server/key/access_token/user_info) would keep sitting there,
// stale, until the next authenticated load overwrote it - a real gap on a
// shared/public machine, and confusing on a personal one (relay-server
// showing values from a session that's already been signed out of).
export function clearSharedWebclientConfig () {
  const keys = ['api-server', 'custom-rendezvous-server', 'relay-server', 'key', 'access_token', 'user_info']
  keys.forEach((k) => localStorage.removeItem(k))
  keys.forEach((k) => localStorage.removeItem('wc-' + k))
}
