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
