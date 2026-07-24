<template>
  <div class="webclient-settings-page" v-loading="isLoading">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px;">
      <template #title>{{ T('WebclientServerOverrideTip') }}</template>
    </el-alert>

    <el-card shadow="hover">
      <el-form label-width="180px" label-position="left">
        <el-form-item :label="T('IdServer')">
          <el-input v-model="cardForm.id_server" disabled/>
        </el-form-item>
        <el-form-item :label="T('RelayServer')">
          <el-input v-model="cardForm.relay_server" disabled/>
        </el-form-item>

        <el-divider/>

        <el-form-item :label="T('WebclientIdServer')">
          <el-input
              v-model="form.webclient_id_server"
              :placeholder="cardForm.id_server || T('WebclientServerNoOverride')"
          />
        </el-form-item>
        <el-form-item :label="T('WebclientRelayServer')">
          <el-input
              v-model="form.webclient_relay_server"
              :placeholder="cardForm.relay_server || T('WebclientServerNoOverride')"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleSubmit">{{ T('Save') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
  import { onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import { T } from '@/utils/i18n'
  import { server as getServerConfig, updateWebclientConfig } from '@/api/config'

  const isLoading = ref(true)

  const cardForm = reactive({
    id_server: '',
    relay_server: '',
  })
  const form = reactive({
    webclient_id_server: '',
    webclient_relay_server: '',
  })

  const fetchConfig = async () => {
    const res = await getServerConfig().catch(_ => false)
    if (res) {
      cardForm.id_server = res.data.id_server
      cardForm.relay_server = res.data.relay_server
      form.webclient_id_server = res.data.webclient_id_server
      form.webclient_relay_server = res.data.webclient_relay_server
    }
    isLoading.value = false
  }
  onMounted(fetchConfig)

  const handleSubmit = async () => {
    const res = await updateWebclientConfig({ ...form }).catch(_ => false)
    if (res) {
      ElMessage.success(T('SaveSuccess'))
      await fetchConfig()
    }
  }
</script>
