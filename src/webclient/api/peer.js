import request from '@/webclient/utils/request'

// GET /api/peers - server-registered peers, scoped server-side to the
// current user's own group (see rustdesk-api's api.Group.Peers): non-admin
// users only ever get their own peers back regardless of the params here.
export function peers (page = 1, pageSize = 100) {
  return request({
    url: '/peers',
    method: 'get',
    params: { page, pageSize },
  })
}
