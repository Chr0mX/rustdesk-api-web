<template>
  <div class="dashboard">
    <header class="topbar">
      <span class="brand">RustDesk</span>
      <div class="spacer"/>
      <span class="username">{{ userStore.name }}</span>
      <el-button text @click="handleLogout">Logout</el-button>
    </header>

    <main class="content">
      <el-card shadow="hover" v-loading="loading">
        <template #header>Peers</template>
        <el-table :data="peerList" style="width: 100%">
          <el-table-column label="Status" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
                {{ row.status === 1 ? 'Online' : 'Offline' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="ID" prop="id" width="140"/>
          <el-table-column label="Device" >
            <template #default="{ row }">{{ row.info?.device_name || row.id }}</template>
          </el-table-column>
          <el-table-column label="OS" prop="info.os" width="140"/>
          <el-table-column label="User" prop="user_name" width="140"/>
          <el-table-column label="Group" prop="device_group_name" width="160"/>
        </el-table>
        <el-empty v-if="!loading && peerList.length === 0" description="No peers"/>
      </el-card>
    </main>
  </div>
</template>

<script setup>
  import { onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { peers } from '@/webclient/api/peer'
  import { logout } from '@/webclient/api/user'
  import { useWebclientUserStore } from '@/webclient/store/user'

  const router = useRouter()
  const userStore = useWebclientUserStore()

  const loading = ref(true)
  const peerList = ref([])

  const fetchPeers = async () => {
    loading.value = true
    const res = await peers().catch(() => false)
    if (res) {
      peerList.value = res.data || []
    }
    loading.value = false
  }
  onMounted(fetchPeers)

  const handleLogout = async () => {
    await logout().catch(() => {})
    userStore.clearLocal()
    await router.push({ name: 'WebclientLogin' })
  }
</script>

<style scoped>
.dashboard {
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
.username {
  margin-right: 12px;
  color: var(--el-text-color-secondary);
}
.content {
  padding: 24px;
}
</style>
