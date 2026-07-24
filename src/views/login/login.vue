<template>
  <div class="login-container">
    <div class="top-bar">
      <el-dropdown class="top-bar-item">
        <el-icon class="top-bar-icon"><svg preserveAspectRatio="xMidYMid meet" viewBox="0 0 24 24" width="1.2em" height="1.2em"><path fill="currentColor" d="m18.5 10l4.4 11h-2.155l-1.201-3h-4.09l-1.199 3h-2.154L16.5 10h2zM10 2v2h6v2h-1.968a18.222 18.222 0 0 1-3.62 6.301a14.864 14.864 0 0 0 2.336 1.707l-.751 1.878A17.015 17.015 0 0 1 9 13.725a16.676 16.676 0 0 1-6.201 3.548l-.536-1.929a14.7 14.7 0 0 0 5.327-3.042A18.078 18.078 0 0 1 4.767 8h2.24A16.032 16.032 0 0 0 9 10.877a16.165 16.165 0 0 0 2.91-4.876L2 6V4h6V2h2zm7.5 10.885L16.253 16h2.492L17.5 12.885z"/></svg></el-icon>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="(v, k) in appStore.setting.langs" @click="appStore.changeLang(k)" :key="k">{{ v.name }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-switch
          v-model="isDark"
          class="top-bar-item"
          style="--el-switch-on-color:#18222c"
      >
        <template #active-action>
          <el-icon><Moon/></el-icon>
        </template>
        <template #inactive-action>
          <el-icon><Sunny color="#000"/></el-icon>
        </template>
      </el-switch>
    </div>

    <div class="login-card">
      <div class="brand">
        <img src="@/assets/logo.png" alt="logo" class="login-logo"/>
        <span class="brand-name">RustDesk</span>
      </div>
      <div class="brand-subtitle">{{ appStore.setting.title }}</div>

      <el-form v-if="!disablePwd" label-position="top" class="login-form">
        <el-form-item>
          <el-input v-model="form.username" :placeholder="T('Username')" class="login-input">
            <template #prefix>
              <el-icon><User/></el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item>
          <el-input v-model="form.password" type="password" :placeholder="T('Password')" @keyup.enter.native="login"
                    show-password class="login-input">
            <template #prefix>
              <el-icon><Lock/></el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="captchaCode">
          <el-input v-model="form.captcha" :placeholder="T('Captcha')" @keyup.enter.native="login" class="login-input captcha-input">
            <template #append>
              <img :src="captchaCode.b64" @click="loadCaptcha" class="captcha" alt="captcha"/>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-button @click="login" type="primary" class="login-button">{{ T('Login') }}</el-button>
          <el-button v-if="allowRegister" @click="register" class="login-button">{{ T('Register') }}</el-button>
        </el-form-item>
      </el-form>

      <div class="divider" v-if="options.length > 0 && !disablePwd">
        <span>{{ T('or login in with') }}</span>
      </div>

      <div class="oidc-options">
        <div v-for="(option, index) in options" :key="index" class="oidc-option">
          <el-button @click="handleOIDCLogin(option.name)" class="oidc-btn">
            <img :src="getProviderImage(option.name)" alt="provider" class="oidc-icon"/>
            <span>{{ T(option.name) }}</span>
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { reactive, onMounted, ref } from 'vue'
  import { useUserStore } from '@/store/user'
  import { useAppStore } from '@/store/app'
  import { ElMessage } from 'element-plus'
  import { T } from '@/utils/i18n'
  import { useRoute, useRouter } from 'vue-router'
  import { loginOptions, captcha } from '@/api/login'
  import { getCode, removeCode } from '@/utils/auth'
  import { useDark } from '@vueuse/core'
  import { Sunny, Moon, User, Lock } from '@element-plus/icons'

  const oauthInfo = ref({})
  const userStore = useUserStore()
  const appStore = useAppStore()
  const route = useRoute()
  const router = useRouter()
  const options = reactive([]) // 存储 OIDC 登录选项
  const isDark = useDark()

  let platform = window.navigator.platform
  if (navigator.platform.indexOf('Mac') === 0) {
    platform = 'mac'
  } else if (navigator.platform.indexOf('Win') === 0) {
    platform = 'windows'
  } else if (navigator.platform.indexOf('Linux armv') === 0) {
    platform = 'android'
  } else if (navigator.platform.indexOf('Linux') === 0) {
    platform = 'linux'
  }
  const userAgent = navigator.userAgent
  let browser = 'Unknown Browser'
  if (/chrome|crios/i.test(userAgent)) browser = 'Chrome'
  else if (/firefox|fxios/i.test(userAgent)) browser = 'Firefox'
  else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) browser = 'Safari'
  else if (/edg/i.test(userAgent)) browser = 'Edge'

  const form = reactive({
    username: '',
    password: '',
    platform: platform,
    captcha: '',
    captcha_id: ''
  })

  const captchaCode = ref('')
  const redirect = route.query?.redirect
  const login = async () => {
    const res = await userStore.login(form).catch(e => e)
    if (!res.code) {
      ElMessage.success(T('LoginSuccess'))
      router.push({ path: redirect || '/', replace: true })
      return
    }
    if (res.code === 110) {
      // need captcha
      loadCaptcha()
    }
  }

  const loadCaptcha = async () => {
    const captchaRes = await captcha().catch(_ => false)
    console.log(captchaRes)
    captchaCode.value = captchaRes.data.captcha
    form.captcha_id = captchaRes.data.captcha.id
  }

  const handleOIDCLogin = (provider) => {
    userStore.oidc(provider, platform, browser)
  }

  import googleImage from '@/assets/google.png'
  import githubImage from '@/assets/github.png'
  import oidcImage from '@/assets/oidc.png'
  import webauthImage from '@/assets/webauth.png'
  import defaultImage from '@/assets/oidc.png'

  const providerImageMap = {
    google: googleImage,
    github: githubImage,
    oidc: oidcImage,
    // WebAuth: webauthImage,
    default: defaultImage,
  }

  const getProviderImage = (provider) => {
    return providerImageMap[provider.toLowerCase()] || providerImageMap.default
  }

  const allowRegister = ref(false)
  const disablePwd = ref(false)
  const loadLoginOptions = async () => {
    try {
      const res = await loginOptions().catch(_ => false)
      if (!res || !res.data) return console.error('No valid response received')
      res.data.ops.map(option => (options.push({ name: option }))) // 创建新的对象数组
      if (res.data.auto_oidc) {
        // 如果有自动OIDC登录选项，直接调用第一个
        handleOIDCLogin(res.data.ops[0])
      }
      disablePwd.value = res.data.disable_pwd
      allowRegister.value = res.data.register
      if (res.data.need_captcha) {
        loadCaptcha()
      }
    } catch (error) {
      console.error('Error loading login options:', error.message)
    }
  }

  onMounted(async () => {
    appStore.getAdminConfig()
    const code = getCode()
    if (code) {
      // 如果code存在，进行query获取user info
      const res = await userStore.query(code)
      if (res) {
        // 删除code，确保跳转之前对code进行清楚
        removeCode()
        ElMessage.success(T('LoginSuccess'))
        router.push({ path: redirect || '/', replace: true })
      }
    } else {
      // 如果code不存在, 现实登陆页面
      loadLoginOptions() // 组件挂载后调用登录选项加载函数
    }
  })

  const register = () => {
    router.push('/register')
  }
</script>

<style scoped lang="scss">
.login-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background-color: var(--el-bg-color-page);
  padding: 20px;
  box-sizing: border-box;
}

.top-bar {
  position: absolute;
  top: 20px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 16px;

  .top-bar-item {
    cursor: pointer;
  }

  .top-bar-icon {
    font-size: 20px;
    color: var(--el-text-color-regular);
  }
}

.login-card {
  width: 360px;
  text-align: center;
}

.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 6px;
}

.brand-name {
  font-size: 28px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.brand-subtitle {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin-bottom: 28px;
}

.login-form {
  margin-bottom: 20px;
}

.login-input {
  width: 100%;
}
.captcha {
  cursor: pointer;
  width: 150px;
}
.captcha-input {
  :deep(.el-input-group__append) {
    border-radius: 5px;
    padding: 0;
    overflow: hidden;
  }
}

.login-button {
  width: 100%;
  height: 40px;
  margin-bottom: 20px;
  margin-left: 0;
}

.divider {
  display: flex;
  align-items: center;
  margin: 20px 0;
  font-size: 14px;
  color: var(--el-text-color-secondary);

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background-color: var(--el-border-color);
  }

  &::before {
    margin-right: 10px;
  }

  &::after {
    margin-left: 10px;
  }
}

.oidc-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.oidc-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 50px;
  font-size: 14px;
}

.oidc-icon {
  width: 24px;
  height: 24px;
  margin-right: 10px;
}

.login-logo {
  width: 48px;
  height: 48px;
  display: block;
}
</style>
