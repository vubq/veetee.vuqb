<script setup lang="ts">
import { RouterView } from 'vue-router'

import AppTopNav from '@/layouts/AppTopNav.vue'
import VtToastViewport from '@/ui/primitives/VtToastViewport.vue'
</script>

<template>
  <div class="app-root">
    <a
      class="skip-link"
      href="#main-content"
    >Bỏ qua đến nội dung chính</a>
    <AppTopNav />
    <RouterView />
    <VtToastViewport />
  </div>
</template>

