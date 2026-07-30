<template>
  <div class="engine-page">
    <div v-if="loading" class="loading">
      <el-icon class="is-loading" :size="32"><Loading/></el-icon>
      <span>Loading RustDesk...</span>
    </div>
    <div v-if="error" class="error">
      <p>{{ error }}</p>
      <el-button @click="handleLogout">Back to login</el-button>
    </div>
    <!--
      The Flutter engine (Phase 2's `flutter build web` output) mounts
      itself into the document directly - it doesn't render into a Vue
      component tree (see docs/WEBCLIENT_V2_REBUILD_PLAN.md's Phase 3
      findings: Dart owns painting via CanvasKit, driven by onRgba, not
      Vue). This div exists only as a landmark/host element; nothing here
      renders Vue-side once the engine takes over.
    -->
    <div id="engine-host"></div>
  </div>
</template>

<script setup>
  import { onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { Loading } from '@element-plus/icons'
  import { initBridge } from '@/webclient/connection/bridge'
  import { logout, clearSharedWebclientConfig } from '@/webclient/api/user'
  import { useWebclientUserStore } from '@/webclient/store/user'

  const router = useRouter()
  const userStore = useWebclientUserStore()

  const loading = ref(true)
  const error = ref('')

  // Where Phase 2's `flutter build web --release` output actually gets
  // served from isn't decided yet - that's part of Phase 6 (Cutover), or
  // a dev-only path before then. Configurable so this doesn't need
  // editing once that's settled.
  const ENGINE_BASE_URL = import.meta.env.VITE_ENGINE_BASE_URL || '/engine/'

  function loadScript (src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = src
      script.onload = resolve
      script.onerror = () => reject(new Error(`Failed to load ${src}`))
      document.body.appendChild(script)
    })
  }

  // main.dart.js resolves its own assets (FontManifest.json, canvaskit,
  // packages/.../no_sleep.js, ...) against document.baseURI at runtime,
  // not anything baked in at flutter-build time - confirmed in the
  // compiled engine itself (both this repo's and the legacy bundled
  // one's main.dart.js reference document.baseURI/assetBase directly).
  // `flutter build web --base-href` only rewrites Flutter's OWN
  // generated index.html, which we never load - we load main.dart.js
  // straight into THIS page (webclient.html), which has no <base> tag
  // of its own, so it defaulted to this page's own directory
  // (/webclient-dev/) instead of where the engine files actually live
  // (/webclient-dev/engine/), 404ing on every asset. Setting <base>
  // ourselves, right before loading the engine, is the actual fix -
  // removed again on logout so it doesn't affect Login.vue's own
  // relative resource resolution afterward.
  let baseEl = null
  function setDocumentBase (href) {
    baseEl = document.querySelector('base') || document.createElement('base')
    baseEl.setAttribute('href', href)
    if (!baseEl.parentNode) document.head.prepend(baseEl)
  }
  function clearDocumentBase () {
    if (baseEl && baseEl.parentNode) baseEl.parentNode.removeChild(baseEl)
    baseEl = null
  }

  onMounted(async () => {
    try {
      // rustdesk-api's /webclient-config/index.js is what actually knows
      // the real id-server/relay-server/key (admin-configured) - it's
      // gated by WebclientAuth (see rustdesk-api's http/middleware/
      // webclient.go), which our webclient login never satisfies on its
      // own (it's a plain /api/login, a completely separate auth path
      // from WebclientAuth's wc_sess cookie / ?token= check). Passing our
      // own access token as ?token= here authenticates this one request
      // the same way opening /webclient/?token=... does, and also mints
      // the wc_sess cookie for next time. Without this, curConn.js has no
      // custom-rendezvous-server in localStorage at all and testDelay()/
      // getDefaultUri() have nothing to connect to.
      await loadScript(`/webclient-config/index.js?token=${encodeURIComponent(userStore.token)}`)
    } catch (e) {
      console.error('Failed to load webclient config', e)
    }

    // window.setByName/window.getByName must exist before the engine's
    // first frame runs, since it calls them immediately on init (see
    // Phase 3 findings) - initBridge() before loading main.dart.js, not
    // after.
    initBridge()

    try {
      setDocumentBase(ENGINE_BASE_URL)
      // Mirrors the currently-vendored bundle's own loader (see Phase 1
      // findings: service-worker-gated, falls back to a plain <script>
      // tag) - simplified here since there's no engine build to actually
      // test this against yet. Revisit once Phase 2 has real output to
      // point at.
      await loadScript(`${ENGINE_BASE_URL}main.dart.js`)
      loading.value = false
    } catch (e) {
      loading.value = false
      clearDocumentBase()
      error.value = 'Could not load the RustDesk engine. ' +
        '(Phase 2\'s flutter build web output isn\'t available at ' +
        `${ENGINE_BASE_URL} yet - see docs/WEBCLIENT_V2_REBUILD_PLAN.md.)`
      console.error(e)
    }
  })

  const handleLogout = async () => {
    clearDocumentBase()
    await logout().catch(() => {})
    userStore.clearLocal()
    // Matches ConfigJs's own clearConfigScript - without this the
    // connection config a previous /webclient-config/index.js load wrote
    // (custom-rendezvous-server/api-server/relay-server/key/access_token/
    // user_info) would keep sitting in localStorage after logout instead
    // of actually being cleared.
    clearSharedWebclientConfig()
    await router.push({ name: 'WebclientLogin' })
  }
</script>

<style scoped>
.engine-page {
  min-height: 100vh;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.loading, .error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #fff;
}
</style>
