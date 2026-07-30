import { createRouter, createWebHistory } from 'vue-router'
import { useWebclientUserStore } from '@/webclient/store/user'

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
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach((to, from, next) => {
  const userStore = useWebclientUserStore()
  if (to.meta.requiresAuth && !userStore.token) {
    next({ name: 'WebclientLogin' })
  } else {
    next()
  }
})
