import request from '@/utils/request'

export function list (params) {
  return request({
    url: '/admin_action_log/list',
    params,
  })
}

export function remove (data) {
  return request({
    url: '/admin_action_log/delete',
    method: 'post',
    data,
  })
}

export function batchDelete (data) {
  return request({
    url: '/admin_action_log/batchDelete',
    method: 'post',
    data,
  })
}
