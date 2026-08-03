<script setup lang="ts">
import { RouterView } from 'vue-router'
import { useRoute } from 'vue-router'

import AppTopNav from '@/layouts/AppTopNav.vue'
import VtToastViewport from '@/ui/primitives/VtToastViewport.vue'

const route = useRoute()
</script>

<template>
  <div class="app-root">
    <a
      class="skip-link"
      href="#main-content"
    >Bỏ qua đến nội dung chính</a>
    <AppTopNav v-if="route.name !== 'login'" />
    <RouterView />
    <VtToastViewport />
  </div>
</template>
