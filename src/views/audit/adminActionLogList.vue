<template>
  <div>
    <el-card class="list-query" shadow="hover">
      <el-form inline label-width="80px">
        <el-form-item :label="T('Operator')">
          <el-input v-model="listQuery.operator_name" clearable></el-input>
        </el-form-item>
        <el-form-item :label="T('Module')">
          <el-input v-model="listQuery.module" clearable></el-input>
        </el-form-item>
        <el-form-item :label="T('Success')">
          <el-select v-model="listQuery.success" clearable style="width: 120px">
            <el-option :label="T('Yes')" value="1"/>
            <el-option :label="T('No')" value="0"/>
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handlerQuery">{{ T('Filter') }}</el-button>
          <el-button type="danger" @click="toBatchDelete">{{ T('BatchDelete') }}</el-button>
          <el-button type="success" @click="toExport">{{ T('Export') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    <el-card class="list-body" shadow="hover">
      <el-table :data="listRes.list" v-loading="listRes.loading" border @selection-change="handleSelectionChange">
        <el-table-column type="selection" align="center" width="50"/>
        <el-table-column prop="id" label="ID" align="center" width="80"/>
        <el-table-column :label="T('Operator')" prop="operator_name" align="center" width="120"/>
        <el-table-column :label="T('Module')" prop="module" align="center" width="120"/>
        <el-table-column :label="T('Action')" prop="action" align="center" width="120"/>
        <el-table-column :label="T('Method')" prop="method" align="center" width="90"/>
        <el-table-column :label="T('Path')" prop="path" align="center" show-overflow-tooltip/>
        <el-table-column :label="T('Ip')" prop="ip" align="center" width="120"/>
        <el-table-column :label="T('Success')" align="center" width="90">
          <template #default="{row}">
            <el-tag v-if="row.success" type="success">{{ T('Yes') }}</el-tag>
            <el-tag v-else type="danger">{{ T('No') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" :label="T('CreatedAt')" align="center" width="170"/>
        <el-table-column :label="T('Actions')" align="center" width="150">
          <template #default="{row}">
            <el-button type="danger" @click="del(row)">{{ T('Delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-card class="list-page" shadow="hover">
      <el-pagination background
                     layout="prev, pager, next, sizes, jumper"
                     :page-sizes="[10,20,50,100]"
                     v-model:page-size="listQuery.page_size"
                     v-model:current-page="listQuery.page"
                     :total="listRes.total">
      </el-pagination>
    </el-card>
  </div>
</template>

<script setup>
  import { onActivated, onMounted, ref, watch } from 'vue'
  import { useAdminActionLogRepositories } from '@/views/audit/adminActionLogRepositories'
  import { T } from '@/utils/i18n'

  const {
    listRes,
    listQuery,
    getList,
    handlerQuery,
    del,
    batchdel,
    toExport,
  } = useAdminActionLogRepositories()

  onMounted(getList)
  onActivated(getList)

  watch(() => listQuery.page, getList)
  watch(() => listQuery.page_size, handlerQuery)

  const multipleSelection = ref([])
  const handleSelectionChange = (val) => {
    multipleSelection.value = val
  }
  const toBatchDelete = () => {
    if (multipleSelection.value.length === 0) {
      return
    }
    batchdel(multipleSelection.value)
  }
</script>

<style scoped lang="scss">

</style>
