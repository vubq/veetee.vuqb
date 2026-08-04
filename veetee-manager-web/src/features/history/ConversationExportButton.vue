<script setup lang="ts">
import { Download } from '@lucide/vue'

import VtButton from '@/ui/primitives/VtButton.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'

withDefaults(defineProps<{
  loading?: boolean
  disabled?: boolean
}>(), { loading: false, disabled: false })

defineEmits<{
  click: []
}>()
</script>

<template>
  <VtButton
    size="sm"
    variant="secondary"
    :loading="loading"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <template #leading>
      <VtIcon
        :icon="Download"
        :size="14"
      />
    </template>
    Tải JSON
  </VtButton>
</template>
