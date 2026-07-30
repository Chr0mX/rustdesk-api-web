import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useWebclientUserStore } from '@/webclient/store/user'
import { pinia } from '@/store'

// Separate axios instance from src/utils/request.js: this one talks to
// the plain /api surface (VITE_WEBCLIENT_SERVER_API) any enabled user can
// reach - not /api/admin, which _admin's request.js is pinned to and which
// most webclient users won't have permission for.
//
// This surface also uses a genuinely different response convention than
// /api/admin's: no {code, message, data} envelope. Endpoints return their
// payload directly on success (HTTP 200) and {error: "..."} on failure
// (HTTP 4xx - see rustdesk-api's response.Error and middleware.RustAuth),
// and auth is Bearer-token (middleware.RustAuth reads "Authorization:
// Bearer <token>"), not the api-token header /api/admin uses.
const service = axios.create({
  baseURL: import.meta.env.VITE_WEBCLIENT_SERVER_API,
  withCredentials: true,
  timeout: 50000,
})

service.interceptors.request.use(
  config => {
    if (!config.headers) {
      config.headers = {}
    }
    const userStore = useWebclientUserStore(pinia)
    if (userStore.token) {
      config.headers['Authorization'] = `Bearer ${userStore.token}`
    }
    return config
  },
  error => Promise.reject(error),
)

service.interceptors.response.use(
  // Axios only reaches here on a 2xx status, so no res.code check is
  // needed - a non-2xx (including the 401s middleware.RustAuth sends for
  // an invalid/expired token) already goes to the error handler below.
  response => response.data,
  error => {
    const status = error.response?.status
    const message = error.response?.data?.error || error.response?.data?.message || error.message

    if (status === 401 && !error.config?.skipAuthReload) {
      const userStore = useWebclientUserStore(pinia)
      userStore.clearLocal()
      window.location.reload()
    } else if (!error.config?.silentError) {
      ElMessage({
        message: message || 'error',
        type: 'error',
        duration: 5 * 1000,
      })
    }
    return Promise.reject(error.response?.data || error)
  },
)

export default service
