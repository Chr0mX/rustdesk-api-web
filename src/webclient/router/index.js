import { createRouter, createWebHashHistory } from 'vue-router'
import { useWebclientUserStore } from '@/webclient/store/user'
import { tryWebclientSessionBridge } from '@/webclient/api/user'

const routes = [
  {
    path: '/login',
    name: 'WebclientLogin',
    component: () => import('@/webclient/views/Login.vue'),
  },
  {
    // The Flutter engine (Phase 2) renders the actual dashboard/settings/
    // connection UI itself once loaded - see
    // docs/WEBCLIENT_V2_REBUILD_PLAN.md's Phase 4 findings. This route just
    // bootstraps it; there's no separate Vue-rendered dashboard route.
    path: '/',
    name: 'WebclientEngine',
    component: () => import('@/webclient/views/Engine.vue'),
    meta: { requiresAuth: true },
  },
]

export const router = createRouter({
  // Hash history, not createWebHistory(import.meta.env.BASE_URL): this
  // build's vite.config.js sets base: './' since it's a shared build
  // served from multiple, not-known-at-build-time mount points
  // (/webclient-dev/ today, /webclient/ after Phase 6's cutover) - so
  // BASE_URL resolves to the literal string './', which isn't a valid
  // history-mode base and silently matches no route. router.go also has
  // no catch-all fallback for client-side paths (only exact routes for
  // /webclient-dev/ and /webclient-dev/static/*), so path-based history
  // would 404 on direct navigation anyway. _admin's own router
  // (src/router/index.js) already uses createWebHashHistory() for the
  // same reason - matching that here.
  history: createWebHashHistory(),
  routes,
})

// Attempted at most once per app load (not on every navigation) - a
// visitor who genuinely has no session shouldn't pay a network round trip
// on every route change, and a successful bridge already leaves
// userStore.token set for every check after the first.
let bridgeAttempted = false

router.beforeEach(async (to, from, next) => {
  const userStore = useWebclientUserStore()
  if (to.meta.requiresAuth && !userStore.token) {
    if (!bridgeAttempted) {
      bridgeAttempted = true
      const bridged = await tryWebclientSessionBridge()
      if (bridged) {
        userStore.setUser(bridged)
        next()
        return
      }
    }
    next({ name: 'WebclientLogin' })
  } else {
    next()
  }
})
