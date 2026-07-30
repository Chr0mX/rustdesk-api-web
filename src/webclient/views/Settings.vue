<template>
  <div class="settings-page">
    <header class="topbar">
      <span class="brand">RustDesk</span>
      <div class="spacer"/>
      <el-button text @click="router.push({ name: 'WebclientDashboard' })">Back</el-button>
    </header>

    <main class="content">
      <el-card shadow="hover">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="Account" name="account">
            <el-descriptions v-loading="loading" :column="1" border>
              <el-descriptions-item label="Username">{{ user.name }}</el-descriptions-item>
              <el-descriptions-item label="Email">{{ user.email || '-' }}</el-descriptions-item>
              <el-descriptions-item label="Role">{{ user.is_admin ? 'Admin' : 'User' }}</el-descriptions-item>
            </el-descriptions>
            <el-button type="danger" plain style="margin-top: 16px" @click="handleLogout">Logout</el-button>
          </el-tab-pane>
          <el-tab-pane label="General" name="general" disabled>
            <el-empty description="Coming soon - depends on the connection engine's option storage (Phase 4/5)"/>
          </el-tab-pane>
          <el-tab-pane label="Network" name="network" disabled>
            <el-empty description="Coming soon - depends on the connection engine's option storage (Phase 4/5)"/>
          </el-tab-pane>
          <el-tab-pane label="Display" name="display" disabled>
            <el-empty description="Coming soon - depends on the connection engine's option storage (Phase 4/5)"/>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </main>
  </div>
</template>

<script setup>
  import { onMounted, reactive, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { currentUser, logout } from '@/webclient/api/user'
  import { useWebclientUserStore } from '@/webclient/store/user'

  const router = useRouter()
  const userStore = useWebclientUserStore()

  const activeTab = ref('account')
  const loading = ref(true)
  const user = reactive({
    name: '',
    email: '',
    is_admin: false,
  })

  onMounted(async () => {
    const res = await currentUser().catch(() => false)
    if (res) {
      user.name = res.name
      user.email = res.email
      user.is_admin = !!res.is_admin
    }
    loading.value = false
  })

  const handleLogout = async () => {
    await logout().catch(() => {})
    userStore.clearLocal()
    await router.push({ name: 'WebclientLogin' })
  }
</script>

<style scoped>
.settings-page {
  min-height: 100vh;
  background: var(--el-bg-color-page);
}
.topbar {
  display: flex;
  align-items: center;
  padding: 0 24px;
  height: 56px;
  background: var(--el-bg-color);
  box-shadow: 0 1px 4px rgba(0, 0, 0, .08);
}
.brand {
  font-weight: 700;
  font-size: 18px;
}
.spacer {
  flex: 1;
}
.content {
  padding: 24px;
  max-width: 640px;
  margin: 0 auto;
}
</style>
