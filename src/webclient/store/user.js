import { defineStore } from 'pinia'

// Dedicated localStorage key, distinct from both _admin's access_token
// and the legacy compiled webclient's access_token/wc-access_token, so
// all three can coexist on the same origin without clobbering each other
// during Phase 4/5 development and testing (this app isn't mounted at the
// canonical /webclient/ path until Phase 6).
const TOKEN_KEY = 'webclient_v2_access_token'

export const useWebclientUserStore = defineStore('webclientUser', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    name: '',
    email: '',
    isAdmin: false,
  }),
  actions: {
    // rustdesk-api's LoginRes serializes as snake_case (`json:"access_token"`
    // - see http/response/api/user.go), not accessToken - this was silently
    // storing undefined (then the literal string "undefined" via
    // localStorage.setItem, which is truthy) on every login, letting the
    // router's `!userStore.token` guard wave the user through to
    // Engine.vue with a garbage token that then broke everything
    // downstream (the webclient-config ?token= request, curConn's Bearer
    // auth header), rather than actually failing at login.
    setUser ({ access_token: accessToken, user }) {
      this.token = accessToken
      localStorage.setItem(TOKEN_KEY, accessToken)
      this.name = user?.name || ''
      this.email = user?.email || ''
      this.isAdmin = !!user?.is_admin
    },
    clearLocal () {
      this.token = ''
      this.name = ''
      this.email = ''
      this.isAdmin = false
      localStorage.removeItem(TOKEN_KEY)
    },
  },
})
