<template>
  <div class="login-page" :class="{ dark: isDark }">
    <div class="brand">
      <img class="brand-logo" src="@/assets/rustdesk-logo.svg" alt="RustDesk"/>
      <span class="brand-name">RustDesk</span>
    </div>
    <div class="subtitle">Web Client</div>
    <el-card class="login-card" shadow="always">
      <el-form ref="formRef" :model="form" :rules="rules" @keyup.enter="handleLogin">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="Username" autocomplete="username"/>
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="Password" autocomplete="current-password" show-password/>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" style="width: 100%" @click="handleLogin">Login</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
  import { reactive, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { login } from '@/webclient/api/user'
  import { useWebclientUserStore } from '@/webclient/store/user'

  const router = useRouter()
  const userStore = useWebclientUserStore()

  const formRef = ref(null)
  const loading = ref(false)
  const form = reactive({
    username: '',
    password: '',
  })
  const rules = {
    username: [{ required: true, message: 'Username is required', trigger: 'blur' }],
    password: [{ required: true, message: 'Password is required', trigger: 'blur' }],
  }

  // Matches the legacy bundle's own splash screen (resources/web/index.html):
  // system dark/light preference, overridden by whatever the engine's own
  // Settings -> Theme most recently wrote. That write lands in plain
  // localStorage under the unprefixed key "theme" - Dart's
  // mainSetLocalOption(key: 'theme', ...) routes through this webclient's
  // "option:local" bridge case (bridge.js), which is a plain, unprefixed
  // localStorage read/write (see its own comment - deliberately not
  // namespaced, matching what ConfigJs/curConn.js already use for
  // access_token). So this reads the exact same key the engine itself
  // will have written on a previous visit, not a copy of it.
  const isDark = ref(
    localStorage.getItem('theme') === 'dark' ||
    (localStorage.getItem('theme') !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches),
  )

  const handleLogin = async () => {
    const valid = await formRef.value.validate().catch(() => false)
    if (!valid) {
      return
    }
    loading.value = true
    const res = await login(form.username, form.password).catch(() => false)
    loading.value = false
    if (!res) {
      return
    }
    userStore.setUser(res)
    await router.push({ name: 'WebclientEngine' })
  }
</script>

<style scoped>
.login-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 4px;
  background: #fff;
  transition: background-color .2s ease;
}
.login-page.dark {
  background: #000;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
.brand-logo {
  width: 40px;
  height: 40px;
}
.brand-name {
  font-size: 26px;
  font-weight: 700;
  color: #1a1a1a;
}
.login-page.dark .brand-name {
  color: #fff;
}
.subtitle {
  color: #888;
  margin-bottom: 20px;
}
.login-card {
  width: 340px;
}
</style>
