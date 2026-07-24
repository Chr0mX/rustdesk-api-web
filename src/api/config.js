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
