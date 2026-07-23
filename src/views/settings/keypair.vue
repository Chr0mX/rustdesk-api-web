<template>
  <div class="keypair-page" v-loading="isLoading">
    <el-card shadow="hover">
      <el-form label-width="140px" label-position="left">
        <el-form-item :label="T('PrivateKey')">
          <el-input
              readonly
              type="password"
              show-password
              v-model="cardForm.pri_key"
          >
            <template #suffix>
              <el-icon class="key-action-icon" @click="handleClipboard(cardForm.pri_key, $event)">
                <CopyDocument/>
              </el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item :label="T('PublicKey')">
          <el-input readonly v-model="cardForm.pub_key">
            <template #suffix>
              <el-icon class="key-action-icon" @click="handleClipboard(cardForm.pub_key, $event)">
                <CopyDocument/>
              </el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item>
          <el-button type="danger" @click="editModalVisible = true">{{ T('Edit') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-dialog v-model="editModalVisible" :title="T('EditKey')" width="500px">
      <el-radio-group v-model="modalOption">
        <el-radio label="reset" value="reset">{{ T('Reset') }}</el-radio>
        <el-radio label="custom" value="custom">{{ T('Custom') }}</el-radio>
      </el-radio-group>

      <template v-if="modalOption === 'custom'">
        <el-divider/>
        <el-form label-width="140px" label-position="left">
          <el-form-item :label="T('PrivateKey')" required>
            <el-input v-model="modalPriKey" :placeholder="T('PleaseInputPrivateKey')"/>
          </el-form-item>
        </el-form>
      </template>

      <template #footer>
        <el-button @click="editModalVisible = false">{{ T('Cancel') }}</el-button>
        <el-button type="primary" @click="handleModalSubmit">{{ T('Confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
  import { onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import { CopyDocument } from '@element-plus/icons'
  import { T } from '@/utils/i18n'
  import { handleClipboard } from '@/utils/clipboard'
  import { getSkKey, resetSkKey, updateSkKey } from '@/api/keypair'

  const isLoading = ref(true)

  const cardForm = reactive({
    pri_key: '',
    pub_key: '',
  })

  const fetchKey = async () => {
    const res = await getSkKey().catch(_ => false)
    if (res) {
      cardForm.pri_key = res.data.pri_key
      cardForm.pub_key = res.data.pub_key
    }
    isLoading.value = false
  }
  onMounted(fetchKey)

  const editModalVisible = ref(false)
  const modalOption = ref('reset')
  const modalPriKey = ref('')

  const handleModalSubmit = async () => {
    if (modalOption.value === 'custom' && !modalPriKey.value.trim()) {
      ElMessage.error(T('PleaseInputPrivateKey'))
      return
    }

    if (modalOption.value === 'reset') {
      const res = await resetSkKey().catch(_ => false)
      if (res) {
        cardForm.pri_key = res.data.pri_key
        cardForm.pub_key = res.data.pub_key
        ElMessage.success(T('KeyUpdatedTip'))
        editModalVisible.value = false
      }
    } else {
      const res = await updateSkKey(modalPriKey.value).catch(_ => false)
      if (res) {
        ElMessage.success(T('KeyUpdatedTip'))
        editModalVisible.value = false
        modalPriKey.value = ''
        await fetchKey()
      }
    }
  }
</script>

<style scoped lang="scss">
.keypair-page {
  .key-action-icon {
    cursor: pointer;
    margin-left: 6px;
  }
}
</style>
