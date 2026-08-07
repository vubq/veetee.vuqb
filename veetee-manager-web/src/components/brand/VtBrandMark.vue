<script setup lang="ts">
withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })
</script>

<template>
  <img
    class="vt-brand-mark"
    :class="`is-${size}`"
    src="/favicon.svg"
    alt=""
    aria-hidden="true"
  >
</template>

<style scoped>
.vt-brand-mark { display: block; flex: none; object-fit: contain; }
.vt-brand-mark.is-sm { width: 26px; height: 26px; border-radius: 7px; }
.vt-brand-mark.is-md { width: 34px; height: 34px; border-radius: 9px; }
.vt-brand-mark.is-lg { width: 52px; height: 52px; border-radius: 14px; }
</style>
