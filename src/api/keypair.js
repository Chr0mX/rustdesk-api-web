import request from '@/utils/request'

export function getSkKey () {
  return request({
    url: '/keypair',
    method: 'get',
  })
}

export function resetSkKey () {
  return request({
    url: '/keypair',
    method: 'post',
  })
}

export function updateSkKey (priKey) {
  return request({
    url: '/keypair',
    method: 'put',
    data: priKey,
  })
}
