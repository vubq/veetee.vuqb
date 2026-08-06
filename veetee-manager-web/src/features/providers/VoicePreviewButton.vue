<script setup lang="ts">
import { Pause, Play } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'

import VtButton from '@/ui/primitives/VtButton.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'

const props = defineProps<{ src: string }>()
const audio = ref<HTMLAudioElement>()
const playing = ref(false)

function toggle() {
  if (!audio.value) return
  if (playing.value) {
    audio.value.pause()
    playing.value = false
    return
  }
  void audio.value.play().then(() => { playing.value = true }).catch(() => { playing.value = false })
}

function ended() { playing.value = false }
function stop() { audio.value?.pause(); playing.value = false }
onBeforeUnmount(stop)
</script>

<template>
  <span class="voice-preview">
    <audio
      ref="audio"
      :src="props.src"
      preload="metadata"
      @ended="ended"
      @pause="playing = false"
    />
    <VtButton
      size="sm"
      variant="ghost"
      :aria-label="playing ? 'Tạm dừng nghe thử' : 'Nghe thử giọng'"
      :title="playing ? 'Tạm dừng nghe thử' : 'Nghe thử giọng'"
      @click="toggle"
    >
      <template #leading>
        <VtIcon
          :icon="playing ? Pause : Play"
          :size="13"
        />
      </template>
      {{ playing ? 'Dừng' : 'Nghe thử' }}
    </VtButton>
  </span>
</template>

<style scoped>
.voice-preview { display: inline-flex; }
</style>
