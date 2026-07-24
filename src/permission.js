import { router } from '@/router'
import { useRouteStore } from '@/store/router'
import { useUserStore } from '@/store/user'
import { getToken } from '@/utils/auth'
import { pinia } from '@/store'
import NProgress from 'nprogress' // progress bar
import 'nprogress/nprogress.css'
import { useAppStore } from '@/store/app' // progress bar style
import { T } from '@/utils/i18n'

NProgress.configure({ showSpinner: false }) // NProgress Configuration

const whiteList = ['/login', '/register']
const routeStore = useRouteStore(pinia)
const appStore = useAppStore(pinia)
appStore.getAdminConfig()

// Only worth trying once per app load: if there's a webclient session
// cookie tied to an admin account (see App.WebclientCookieDomain), it logs
// us in without a password; otherwise it's a cheap no-op every time.
let triedWebclientBridge = false

router.beforeEach(async (to, from, next) => {

  document.title = T(to.meta?.title) + ' - ' + appStore.setting.title
  NProgress.start()

  let token = getToken()
  if (!token && !triedWebclientBridge) {
    triedWebclientBridge = true
    const userStore = useUserStore(pinia)
    if (await userStore.tryWebclientBridge()) {
      token = getToken()
    }
  }
  if (!token) {
    //无token，跳转到登录
    if (whiteList.indexOf(to.path) !== -1) {
      next()
    } else {
      next(`/login?redirect=${to.path}`)
    }

  } else {
    //有token

    const userStore = useUserStore(pinia)

    if (!userStore.route_names.length) {
      const info = await userStore.info()
      if (!info) {
        userStore.logout()
        next(`/login?redirect=${to.path}`)
      } else {
        next({ ...to, replace: true })
      }
    }/* else if (to.path === '/404') {
      next({path: to.redirectedFrom?.fullPath, replace: true})
    }*/ else {
      next()
    }
  }
})

router.afterEach(() => {
  NProgress.done()
})
