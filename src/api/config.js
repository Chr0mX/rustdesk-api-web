import request from '@/utils/request'

export function server () {
  return request({
    url: '/config/server',
    method: 'get',
  })
}

export function app () {
  return request({
    url: '/config/app',
    method: 'get',
  })
}

export function admin () {
  return request({
    url: '/config/admin',
    method: 'get',
  })
}

// updateWebclientConfig forces (blank values un-force) the id-server/
// relay-server the bundled webclient is handed, independent of what
// native clients get.
export function updateWebclientConfig (data) {
  return request({
    url: '/config/webclient',
    method: 'post',
    data,
  })
}

// webclientSession proactively establishes the webclient's auth session
// (see rustdesk-api's middleware.WebclientAuth) for the current logged-in
// user, so opening the webclient afterwards doesn't need a ?token= in the
// URL. Only actually bridges the two when the server's
// App.WebclientCookieDomain is set to a domain that covers both the admin
// console and the webclient (e.g. they're sibling subdomains) - otherwise
// this is harmless but pointless.
export function webclientSession () {
  return request({
    url: '/config/webclient-session',
    method: 'post',
  })
}

// webclientBridge is the reverse: if the visitor already holds a webclient
// session cookie (opened the webclient first) and it's tied to an admin
// account, this logs them into _admin without a password. Deliberately not
// authed by the request interceptor (no api-token exists yet at this
// point) - relies entirely on the wc_sess cookie.
export function webclientBridge () {
  return request({
    url: '/config/webclient-bridge',
    method: 'get',
  })
}
