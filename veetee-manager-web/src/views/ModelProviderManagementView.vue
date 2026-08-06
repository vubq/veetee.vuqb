<script setup lang="ts">
import ModelProviderManagementFeature from '@/features/providers/ModelProviderManagementFeature.vue'
import AiServicesNav from '@/features/providers/AiServicesNav.vue'
</script>

<template>
  <main
    id="main-content"
    class="page-container"
  >
    <AiServicesNav />
    <ModelProviderManagementFeature />
  </main>
</template>
