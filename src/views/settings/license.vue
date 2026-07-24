<template>
  <div class="license-page">
    <!-- STALE/TODO: this page has never had a real implementation - it's
         been a "ComingSoon" placeholder since it was first stubbed out.
         Needs an actual License settings UI, or should be removed from the
         settings menu until there is one. -->
    <el-alert type="warning" :closable="false" show-icon style="margin-bottom: 16px;">
      <template #title>TODO: License settings are not implemented yet - this page is a stale placeholder.</template>
    </el-alert>
    <el-card shadow="hover">
      <el-empty :description="T('ComingSoon')"/>
    </el-card>
  </div>
</template>

<script setup>
  import { T } from '@/utils/i18n'
</script>
