<template>
  <div class="login-page">
    <el-card class="login-card" shadow="always">
      <div class="brand">
        <span class="brand-name">RustDesk</span>
      </div>
      <div class="subtitle">Web Client</div>
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
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--el-bg-color-page);
}
.login-card {
  width: 340px;
}
.brand {
  text-align: center;
}
.brand-name {
  font-size: 26px;
  font-weight: 700;
}
.subtitle {
  text-align: center;
  color: var(--el-text-color-secondary);
  margin-bottom: 20px;
}
</style>
