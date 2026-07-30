import { createRouter, createWebHistory } from 'vue-router'
import { useWebclientUserStore } from '@/webclient/store/user'

const routes = [
  {
    path: '/login',
    name: 'WebclientLogin',
    component: () => import('@/webclient/views/Login.vue'),
  },
  {
    path: '/',
    name: 'WebclientDashboard',
    component: () => import('@/webclient/views/Dashboard.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/settings',
    name: 'WebclientSettings',
    component: () => import('@/webclient/views/Settings.vue'),
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
