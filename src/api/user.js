import request from '@/utils/request'

export function login (data) {
  return request({
    url: '/login',
    method: 'post',
    data,
  })
}

// logout tells the backend to invalidate this session - notably, it also
// revokes any webclient session tied to this login (see rustdesk-api's
// middleware.RevokeWebclientSession), so a webclient tab that had picked
// up id-server/relay-server/key from this account stops working and gets
// them cleared on its next load. Silent on failure: local logout
// (userStore.logout, which always clears the local token) should still go
// through even if this call doesn't reach the server.
export function logout () {
  return request({
    url: '/logout',
    method: 'post',
    silentError: true,
  })
}

export function current () {
  return request({
    url: '/user/current',
    method: 'get',
  })
}

export function list (params) {
  return request({
    url: '/user/list',
    params,
  })
}

export function detail (id) {
  return request({
    url: `/user/detail/${id}`,
  })
}

export function create (data) {
  return request({
    url: '/user/create',
    method: 'post',
    data,
  })
}

export function update (data) {
  return request({
    url: '/user/update',
    method: 'post',
    data,
  })
}

export function remove (data) {
  return request({
    url: '/user/delete',
    method: 'post',
    data,
  })
}

export function changePwd (data) {
  return request({
    url: '/user/changePwd',
    method: 'post',
    data,
  })
}

export function changeCurPwd (data) {
  return request({
    url: '/user/changeCurPwd',
    method: 'post',
    data,
  })
}

export function myOauth () {
  return request({
    url: '/user/myOauth',
    method: 'post',
  })
}

export function myPeer (params) {
  return request({
    url: '/user/myPeer',
    params,
  })
}

export function groupUsers (data) {
  return request({
    url: '/user/groupUsers',
    method: 'post',
    data,
  })
}

export function register (data) {
  return request({
    url: '/user/register',
    method: 'post',
    data,
  })
}
