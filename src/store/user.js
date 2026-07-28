import { defineStore, acceptHMRUpdate } from 'pinia'
import { current, login, logout as logoutApi } from '@/api/user'
import { setToken, removeToken, setCode, removeCode } from '@/utils/auth'
import { useRouteStore } from '@/store/router'
import { useAppStore } from '@/store/app'
import { oidcAuth, oidcQuery } from '@/api/login'
import { webclientSession, webclientBridge } from '@/api/config'

export const useUserStore = defineStore({
  id: 'user',
  state: () => ({
    nickname: '',
    username: '',
    email: '',
    token: '',
    role: '',
    avatar: '',
    route_names: [],
  }),

  actions: {
    // Awaits the revoke call (callers should await this before navigating
    // away/reloading) so the request actually leaves the browser instead of
    // being torn down mid-flight by an immediate reload - which would
    // silently defeat the server-side webclient-session revocation this is
    // here for. Local logout still always happens regardless of whether the
    // call succeeds.
    async logout () {
      await logoutApi().catch(() => {})
      removeToken()
      removeCode()
      this.$patch({
        name: '',
        token: '',
        role: {},
      })
    },

    saveUserData (userData) {
      // useAppStore().getAppConfig()
      setToken(userData.token)
      //
      localStorage.setItem('user_info', JSON.stringify({ name: userData.username }))
      this.$patch({
        ...userData,
      })
      if (userData.route_names && userData.route_names.length) {
        useRouteStore().addRoutes(userData.route_names)
      }
      // Best-effort: bridges the admin console session to the (possibly
      // separately-hosted) webclient, see App.WebclientCookieDomain. Never
      // block login on this.
      webclientSession().catch(() => {})
    },

    // Reverse of webclientSession: if a webclient session cookie already
    // identifies an admin (see App.WebclientCookieDomain), logs them into
    // _admin without a password. Returns false (never throws) if there's no
    // such session, it's not tied to an admin, or the cookie can't reach
    // this host at all - all of those are just "not logged in", not errors.
    async tryWebclientBridge () {
      const res = await webclientBridge().catch(_ => false)
      if (res) {
        useAppStore().loadConfig()
        const userData = res.data
        this.saveUserData(userData)
        return userData
      }
      return false
    },

    async login (form) {
      const res = await login(form).catch(e => e)
      console.log('login', res)
      if (!res.code) {
        useAppStore().loadConfig()
        const userData = res.data
        this.saveUserData(userData)
        return userData
      } else {
        return Promise.reject(res)
      }
    },
    async info () {
      const res = await current().catch(_ => false)
      if (res) {
        useAppStore().loadConfig()
        const userData = res.data
        setToken(userData.token)
        this.$patch({
          ...userData,
        })
        useRouteStore().addRoutes(userData.route_names)
        return userData
      }
      return false
    },
    async oidc (provider, platform, browser) {
      // oidc data need to be implement
      const data = {
        deviceInfo: {
          name: navigator.userAgent, // 使用浏览器的 User-Agent 作为设备名
          os: platform, // 获取操作系统信息
          type: 'webadmin', // any vaule
        },
        id: `${platform}-${browser}`,
        op: provider, // 传入的 provider
        uuid: '',//crypto.randomUUID(), // 自动生成 UUID
      }
      const res = await oidcAuth(data).catch(_ => false)
      if (res) {
        const { code, url } = res.data
        setCode(code)
        if (provider == 'webauth') {
          window.open(url)
        } else {
          window.location.href = url
        }
      }
    },
    async query (code) {
      const params = { 'code': code, uuid: '' }
      const res = await oidcQuery(params).catch(_ => false)
      if (res) {
        removeCode()
        useAppStore().loadConfig()
        const userData = res.data
        this.saveUserData(userData)
        return userData
      }
      return false
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUserStore, import.meta.hot))
}
