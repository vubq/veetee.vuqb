<script setup lang="ts">
import ModelConfigurationFeature from '@/features/providers/ModelConfigurationFeature.vue'
import AiServicesNav from '@/features/providers/AiServicesNav.vue'
</script>

<template>
  <main
    id="main-content"
    class="page-container"
  >
    <AiServicesNav />
    <ModelConfigurationFeature />
  </main>
</template>
