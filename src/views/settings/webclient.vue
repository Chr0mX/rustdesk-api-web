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
        <el-form-item :label="T('ApiServer')">
          <el-input v-model="cardForm.api_server" disabled/>
        </el-form-item>

        <el-divider/>

        <el-form-item :label="T('WebclientIdServer')">
          <el-input
              v-model="form.webclient_id_server"
              :placeholder="T('WebclientServerPlaceholderExample')"
          />
          <div class="effective-value-hint">
            {{ T('WebclientServerCurrentlyEffective') }}:
            <strong>{{ form.webclient_id_server || cardForm.id_server }}</strong>
            <el-tag v-if="form.webclient_id_server" size="small" type="success">{{ T('WebclientServerOverrideActive') }}</el-tag>
            <el-tag v-else size="small">{{ T('WebclientServerNoOverride') }}</el-tag>
          </div>
        </el-form-item>
        <el-form-item :label="T('WebclientApiServer')">
          <el-input
              v-model="form.webclient_api_server"
              :placeholder="T('WebclientServerPlaceholderExample')"
          />
          <div class="effective-value-hint">
            {{ T('WebclientServerCurrentlyEffective') }}:
            <strong>{{ form.webclient_api_server || cardForm.api_server }}</strong>
            <el-tag v-if="form.webclient_api_server" size="small" type="success">{{ T('WebclientServerOverrideActive') }}</el-tag>
            <el-tag v-else size="small">{{ T('WebclientServerNoOverride') }}</el-tag>
          </div>
        </el-form-item>
        <el-form-item :label="T('WebclientRelayServer')">
          <el-input
              v-model="form.webclient_relay_server"
              :placeholder="T('WebclientServerPlaceholderExample')"
              :disabled="form.webclient_relay_from_api_server"
          />
          <div class="effective-value-hint">
            {{ T('WebclientServerCurrentlyEffective') }}:
            <strong>{{ effectiveRelayServer }}</strong>
            <el-tag v-if="form.webclient_relay_server" size="small" type="success">{{ T('WebclientServerOverrideActive') }}</el-tag>
            <el-tag v-else-if="form.webclient_relay_from_api_server" size="small" type="warning">{{ T('WebclientServerDerivedFromApi') }}</el-tag>
            <el-tag v-else size="small">{{ T('WebclientServerNoOverride') }}</el-tag>
          </div>
          <el-checkbox
              v-model="form.webclient_relay_from_api_server"
              :disabled="!!form.webclient_relay_server"
              style="margin-top: 8px;"
          >
            {{ T('WebclientServerRelayFromApiToggle') }}
          </el-checkbox>
          <div class="effective-value-hint">{{ T('WebclientServerRelayFromApiTip') }}</div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleSubmit">{{ T('Save') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
  import { computed, onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import { T } from '@/utils/i18n'
  import { server as getServerConfig, updateWebclientConfig } from '@/api/config'

  const isLoading = ref(true)

  const cardForm = reactive({
    id_server: '',
    relay_server: '',
    api_server: '',
  })
  const form = reactive({
    webclient_id_server: '',
    webclient_relay_server: '',
    webclient_api_server: '',
    webclient_relay_from_api_server: false,
  })

  // Best-effort client-side preview of what EffectiveWebclientRelayServer
  // (rustdesk-api's config/rustdesk.go) will actually compute - falls back
  // to the plain relay-server display if the effective api-server isn't a
  // parseable URL, same as the server-side logic does. Derives from the
  // *effective* webclient api-server (override if set, else the plain
  // one), matching EffectiveWebclientRelayServer using
  // EffectiveWebclientApiServer rather than the raw ApiServer.
  const effectiveRelayServer = computed(() => {
    if (form.webclient_relay_server) {
      return form.webclient_relay_server
    }
    if (form.webclient_relay_from_api_server) {
      try {
        const effectiveApiServer = form.webclient_api_server || cardForm.api_server
        const apiHost = new URL(effectiveApiServer).hostname
        const relayPort = (cardForm.relay_server.split(':')[1]) || '21117'
        if (apiHost) {
          return `${apiHost}:${relayPort}`
        }
      } catch (_) {
        // not a parseable URL - fall through to plain relay_server below
      }
    }
    return cardForm.relay_server
  })

  const fetchConfig = async () => {
    const res = await getServerConfig().catch(_ => false)
    if (res) {
      cardForm.id_server = res.data.id_server
      cardForm.relay_server = res.data.relay_server
      cardForm.api_server = res.data.api_server
      form.webclient_id_server = res.data.webclient_id_server
      form.webclient_relay_server = res.data.webclient_relay_server
      form.webclient_api_server = res.data.webclient_api_server
      form.webclient_relay_from_api_server = res.data.webclient_relay_from_api_server
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

<style scoped>
.effective-value-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.effective-value-hint strong {
  color: var(--el-text-color-primary);
  margin-right: 6px;
}
.effective-value-hint .el-tag {
  margin-left: 6px;
}
</style>
