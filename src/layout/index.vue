<template>
  <el-config-provider :locale="appStore.setting.locale.value">
    <el-container :style="{'--sideBarWidth': sideBarWidth}">
      <el-aside :width="leftWidth" class="app-left">
        <g-aside></g-aside>
      </el-aside>
      <el-container class="app-container ">
        <el-header class="app-header">
          <g-header></g-header>
        </el-header>
        <div class="header-tags">
          <tags></tags>
        </div>

        <el-main class="app-main">
          <router-view v-slot="{ Component }">
            <transition mode="out-in" name="el-fade-in-linear">
              <keep-alive :include="cachedTags">
                <component :is="Component"/>
              </keep-alive>
            </transition>
          </router-view>
        </el-main>
      </el-container>
    </el-container>
  </el-config-provider>
</template>

<script setup>
  import { useAppStore } from '@/store/app'
  import { useTagsStore } from '@/store/tags'
  import { ref, computed, onMounted, onUnmounted } from 'vue'
  import Tags from '@/layout/components/tags/index.vue'
  import GAside from '@/layout/components/aside.vue'
  import GHeader from '@/layout/components/header.vue'

  const appStore = useAppStore()
  const tagStore = useTagsStore()
  const sideBarWidth = computed(() => appStore.setting.locale.sideBarWidth)
  const leftWidth = computed(() => appStore.setting.sideIsCollapse ? '64px' : 'var(--sideBarWidth)')

  const cachedTags = ref([])

  cachedTags.value = tagStore.cached

  // Nothing in this layout ever reacted to viewport size before - the
  // sidebar only ever collapsed via the header's manual toggle, so a
  // narrow/resized window just overflowed instead of reflowing (this is
  // the actual cause of the "UI scaling issues when resizing" report,
  // together with the fixed-width table columns fixed elsewhere).
  //
  // This only auto-drives the same manual sideIsCollapse flag the header
  // toggle already uses, and only on the two edges of crossing the
  // breakpoint - not on every resize event - so it doesn't fight a user
  // who manually re-expands the sidebar while narrow (that stays expanded
  // until they resize back across the breakpoint again). 768px matches
  // the common tablet/mobile breakpoint convention (same value Element
  // Plus's own docs use for its grid system).
  const MOBILE_BREAKPOINT = 768
  let isMobile = window.innerWidth < MOBILE_BREAKPOINT
  let collapseBeforeMobile = null
  const handleResize = () => {
    const nowMobile = window.innerWidth < MOBILE_BREAKPOINT
    if (nowMobile && !isMobile) {
      collapseBeforeMobile = appStore.setting.sideIsCollapse
      if (!appStore.setting.sideIsCollapse) appStore.sideCollapse()
    } else if (!nowMobile && isMobile) {
      if (collapseBeforeMobile !== null && appStore.setting.sideIsCollapse !== collapseBeforeMobile) {
        appStore.sideCollapse()
      }
      collapseBeforeMobile = null
    }
    isMobile = nowMobile
  }
  onMounted(() => {
    handleResize()
    window.addEventListener('resize', handleResize)
  })
  onUnmounted(() => window.removeEventListener('resize', handleResize))
</script>

<style lang="scss" scoped>
.app-header {
  background-color: var(--el-bg-color);
  color: var(--el-text-color-primary);
  display: flex;
  align-items: center;
  height: 50px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.header-tags {
  height: auto;
  border-bottom: 1px solid #eee;
  display: flex;
  padding: 0;
}

.app-left {
  transition: width 0.5s;
  flex-shrink: 0;
}

// A wide child (a table with many fixed-width columns, before the
// per-page min-width fixes) forces a flex item to grow past its
// available space by default (flex items are min-width: auto, i.e.
// content-sized, unless told otherwise) - that widened the whole
// app-container, not just the table, so the browser showed one
// page-level horizontal scrollbar dragging the header/sidebar along
// with it instead of a scrollbar scoped to the offending table. These
// two rules make app-container the actual scroll boundary: min-width: 0
// lets it shrink below its content's natural width again, and
// overflow-x: auto puts the horizontal scrollbar here if a page's
// content still doesn't fit, instead of on <body>.
.app-container {
  min-height: 100vh;
  min-width: 0;
  overflow-x: auto;
}

.app-main {
  min-width: 0;
}
</style>


