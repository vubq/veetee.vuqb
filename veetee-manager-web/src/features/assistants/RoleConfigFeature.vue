<script setup lang="ts">
import { Play, Save } from '@lucide/vue'
import { computed, nextTick, onMounted, ref } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import type { ProviderInstallationView, RevisionConflictProblem, RoleConfig, RoleConfigDraft, Versioned, VoiceProfile } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import FormSection from '@/ui/patterns/FormSection.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'
import VtTextArea from '@/ui/primitives/VtTextArea.vue'
import { notify } from '@/ui/primitives/notifications'

import RevisionConflictDialog from './RevisionConflictDialog.vue'
import { deriveLocaleOptions } from './locale-options'

const props = defineProps<{ assistantId: string }>()
const emit = defineEmits<{ revision: [revision: number, dirty: boolean] }>()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

const resource = ref<Versioned<RoleConfig>>()
const draft = ref<RoleConfigDraft>()
const voices = ref<VoiceProfile[]>([])
const installations = ref<ProviderInstallationView[]>([])
const loading = ref(true)
const voiceLoading = ref(false)
const saving = ref(false)
const publishing = ref(false)
const customRole = ref(true)
const conflict = ref<RevisionConflictProblem<RoleConfig, RoleConfigDraft>>()
const copying = ref(false)
const loadState = ref<'loading' | 'ready' | 'error' | 'offline'>('loading')
const loadError = ref('')
const actionError = ref('')
const stateHeading = ref<HTMLElement | null>(null)
const actionErrorHeading = ref<HTMLElement | null>(null)
let loadGeneration = 0
let voiceGeneration = 0

function toDraft(config: RoleConfig): RoleConfigDraft {
  return {
    locale: config.locale,
    basePrompt: config.basePrompt,
    personalityId: config.personalityId,
    personalityName: config.personalityName,
    speech: { ...config.speech },
    admission: {
      maxActiveTurns: config.admission?.maxActiveTurns ?? 1,
      retryAfterMs: config.admission?.retryAfterMs ?? 250,
    },
    autoTurn: {
      enabled: config.autoTurn?.enabled ?? false,
      noSpeechTimeoutMs: config.autoTurn?.noSpeechTimeoutMs ?? 5000,
      noSpeechAlert: {
        status: config.autoTurn?.noSpeechAlert?.status ?? 'warning',
        message: config.autoTurn?.noSpeechAlert?.message ?? '',
        emotion: config.autoTurn?.noSpeechAlert?.emotion ?? 'neutral',
      },
    },
    ...(config.progress ? { progress: clonePolicy(config.progress) } : {}),
    ...(config.segmentation ? { segmentation: clonePolicy(config.segmentation) } : {}),
    ...(config.bargeIn ? { bargeIn: clonePolicy(config.bargeIn) } : {}),
    ...(config.toolPolicy ? { toolPolicy: clonePolicy(config.toolPolicy) } : {}),
    ...(config.tools ? { tools: clonePolicy(config.tools) } : {}),
  }
}

function clonePolicy<T>(value: T): T {
  // Role policies are JSON payloads, but Vue wraps nested values in reactive
  // proxies. JSON round-trip detaches those proxies without DataCloneError.
  return JSON.parse(JSON.stringify(value)) as T
}

function toRoleConfig(config: RoleConfig): RoleConfig {
  return { assistantId: config.assistantId, ...toDraft(config) }
}

const dirty = computed(() => {
  if (!resource.value || !draft.value) return false
  const original = toDraft(resource.value.value)
  return JSON.stringify(original) !== JSON.stringify(draft.value)
})

const maxActiveTurnsInvalid = computed(() => {
  const value = draft.value?.admission.maxActiveTurns
  return value === undefined || !Number.isInteger(value) || value < 1 || value > 8
})
const retryAfterInvalid = computed(() => {
  const value = draft.value?.admission.retryAfterMs
  return value === undefined || !Number.isInteger(value) || value < 100 || value > 10000
})
const admissionError = computed(() => maxActiveTurnsInvalid.value || retryAfterInvalid.value)
const noSpeechTimeoutInvalid = computed(() => {
  const value = draft.value?.autoTurn.noSpeechTimeoutMs
  return value === undefined || !Number.isInteger(value) || value < 1000 || value > 60000
})
const noSpeechAlertInvalid = computed(() => {
  const alert = draft.value?.autoTurn.noSpeechAlert
  return !alert?.status.trim() || alert.status.length > 32 || !alert.message.trim() || alert.message.length > 512 || !alert.emotion.trim() || alert.emotion.length > 64
})
const autoTurnError = computed(() => Boolean(draft.value?.autoTurn.enabled && (noSpeechTimeoutInvalid.value || noSpeechAlertInvalid.value)))

const voiceOptions = computed<VtSelectOption[]>(() => voices.value.map((voice) => ({ value: voice.id, label: voice.name, description: `${voice.providerName} · ${voice.description}`, disabled: !voice.available })))
const localeOptions = computed(() => deriveLocaleOptions(installations.value, draft.value?.locale))
const personalityOptions: VtSelectOption[] = [{ value: '41111111-1111-4111-8111-111111111111', label: 'Người bạn đồng hành', description: 'Tự nhiên, thân thiện và biết hỏi lại' }, { value: '42222222-2222-4222-8222-222222222222', label: 'Trợ lý tập trung', description: 'Ngắn gọn, ưu tiên hành động' }, { value: 'custom', label: 'Tính cách tùy chỉnh', description: 'Prompt quyết định hành vi' }]
const styleOptions: VtSelectOption[] = [{ value: 'concise', label: 'Ngắn gọn' }, { value: 'natural', label: 'Tự nhiên' }, { value: 'detailed', label: 'Chi tiết' }]
const rateOptions: VtSelectOption[] = [{ value: '0.9', label: 'Chậm · 0,9×' }, { value: '1', label: 'Tự nhiên · 1,0×' }, { value: '1.05', label: 'Nhanh nhẹ · 1,05×' }, { value: '1.1', label: 'Nhanh · 1,1×' }]
const pitchOptions: VtSelectOption[] = [{ value: '-1', label: 'Trầm nhẹ' }, { value: '0', label: 'Tự nhiên' }, { value: '1', label: 'Cao nhẹ' }]

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  loadState.value = 'loading'
  loadError.value = ''
  try {
    const configResult = await gateway.getRoleConfig(props.assistantId)
    if (!configResult.ok) {
      if (generation !== loadGeneration) return
      loadState.value = configResult.meta.offline ? 'offline' : 'error'
      loadError.value = configResult.meta.offline
        ? 'Đang ngoại tuyến; chưa thể tải role config.'
        : 'Không tải được role config từ Manager API.'
      await focusStateHeading()
      return
    }
    const locale = configResult.data.value.locale
    const [voicesResult, installationsResult] = await Promise.all([
      gateway.listVoices(locale),
      gateway.listProviderInstallations(),
    ])
    if (generation !== loadGeneration) return
    if (!voicesResult.ok || !installationsResult.ok) {
      const offline = voicesResult.meta.offline || installationsResult.meta.offline
      loadState.value = offline ? 'offline' : 'error'
      loadError.value = !voicesResult.ok && !installationsResult.ok
        ? 'Không tải được danh sách giọng nói và provider catalog từ Manager API.'
        : !voicesResult.ok
          ? 'Không tải được danh sách giọng nói; form tạm thời bị khóa để tránh chọn voice chưa đồng bộ.'
          : 'Không tải được provider catalog; form tạm thời bị khóa để tránh chọn locale chưa đồng bộ.'
      await focusStateHeading()
      return
    }
    resource.value = configResult.data
    draft.value = toDraft(configResult.data.value)
    voices.value = voicesResult.data.items
    installations.value = installationsResult.data
    emit('revision', configResult.data.revision, false)
    loadState.value = 'ready'
  } catch {
    if (generation !== loadGeneration) return
    loadState.value = 'offline'
    loadError.value = 'Không kết nối được Manager API. Kiểm tra service hoặc mạng LAN.'
    await focusStateHeading()
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

async function loadVoices(locale: string) {
  const generation = ++voiceGeneration
  voiceLoading.value = true
  try {
    const result = await gateway.listVoices(locale)
    if (generation !== voiceGeneration) return
    if (!result.ok) {
      notify('Không thể tải giọng theo ngôn ngữ', { tone: 'error', message: result.meta.offline ? 'Manager API đang ngoại tuyến.' : 'Provider TTS chưa sẵn sàng.', assertive: true })
      return
    }
    voices.value = result.data.items
  } catch {
    if (generation === voiceGeneration) notify('Không thể tải giọng theo ngôn ngữ', { tone: 'error', message: 'Không kết nối được Manager API.', assertive: true })
  } finally {
    if (generation === voiceGeneration) voiceLoading.value = false
  }
}

function onLocaleChanged(locale: string) {
  if (!draft.value || draft.value.locale === locale) return
  draft.value.locale = locale
  markDirty()
  void loadVoices(locale)
}

async function focusStateHeading() {
  await nextTick()
  stateHeading.value?.focus()
}

async function focusActionError() {
  await nextTick()
  actionErrorHeading.value?.focus()
}

function markDirty() { if (resource.value) emit('revision', resource.value.revision, true) }

async function previewVoice() {
  if (!draft.value) return
  const result = await gateway.previewVoice(draft.value.speech.voiceId, 'Xin chào, mình là trợ lý Veetee của bạn.')
  if (result.ok) notify('Đã dựng bản nghe thử', { tone: 'success', message: `Audio mô phỏng dài ${(result.data.durationMs / 1000).toFixed(1)} giây.` })
  else notify('Không thể nghe thử giọng', { tone: 'error', message: 'TTS provider đang không khả dụng.', assertive: true })
}

async function save() {
  if (!draft.value || !resource.value) return
  actionError.value = ''
  saving.value = true
  try {
    const result = await gateway.saveRoleConfig(
      props.assistantId,
      {
        ...draft.value,
        speech: { ...draft.value.speech },
        admission: { ...draft.value.admission },
        autoTurn: { ...draft.value.autoTurn, noSpeechAlert: { ...draft.value.autoTurn.noSpeechAlert } },
        ...(draft.value.progress ? { progress: clonePolicy(draft.value.progress) } : {}),
        ...(draft.value.segmentation ? { segmentation: clonePolicy(draft.value.segmentation) } : {}),
        ...(draft.value.bargeIn ? { bargeIn: clonePolicy(draft.value.bargeIn) } : {}),
        ...(draft.value.toolPolicy ? { toolPolicy: clonePolicy(draft.value.toolPolicy) } : {}),
        ...(draft.value.tools ? { tools: clonePolicy(draft.value.tools) } : {}),
      },
      resource.value.etag,
    )
    if (result.ok) {
      resource.value = result.data
      draft.value = toDraft(result.data.value)
      emit('revision', result.data.revision, false)
      notify('Đã lưu bản nháp', { tone: 'success', message: `Revision mới là #${result.data.revision}.` })
      return
    }
    if (result.problem.type === 'revision-conflict') {
      conflict.value = result.problem
      return
    }
    actionError.value = result.meta.offline
      ? 'Đang ngoại tuyến; draft vẫn được giữ trên màn hình.'
      : 'Không thể lưu bản nháp; draft vẫn được giữ để bạn sửa hoặc thử lại.'
    notify('Không thể lưu bản nháp', { tone: 'error', message: actionError.value, assertive: true })
    await focusActionError()
  } catch {
    actionError.value = 'Không kết nối được Manager API; draft vẫn được giữ trên màn hình.'
    notify('Không thể lưu bản nháp', { tone: 'error', message: actionError.value, assertive: true })
    await focusActionError()
  }
  finally { saving.value = false }
}

async function publish() {
  if (!resource.value || dirty.value) return
  actionError.value = ''
  publishing.value = true
  try {
    const result = await gateway.publishAssistant(props.assistantId, resource.value.etag)
    if (result.ok) {
      await load()
      notify('Đã áp dụng cấu hình', { tone: 'success', message: `Revision runtime #${result.data.revision} đã được publish.` })
    } else {
      actionError.value = result.meta.offline
        ? 'Đang ngoại tuyến; chưa thể áp dụng cấu hình.'
        : 'Revision hiện tại không còn mới; hãy tải lại trước khi publish.'
      notify('Không thể áp dụng cấu hình', { tone: 'error', message: actionError.value, assertive: true })
      await focusActionError()
    }
  } catch {
    actionError.value = 'Không kết nối được Manager API; cấu hình chưa được publish.'
    notify('Không thể áp dụng cấu hình', { tone: 'error', message: actionError.value, assertive: true })
    await focusActionError()
  } finally {
    publishing.value = false
  }
}

function reloadConflict() {
  if (!conflict.value) return
  resource.value = { value: toRoleConfig(conflict.value.current), revision: conflict.value.currentRevision, etag: conflict.value.currentEtag }
  draft.value = toDraft(conflict.value.current)
  emit('revision', conflict.value.currentRevision, false)
  conflict.value = undefined
  notify('Đã tải revision mới', { tone: 'success' })
}

async function copyAndReload() {
  if (!conflict.value) return
  copying.value = true
  try {
    await navigator.clipboard.writeText(JSON.stringify(conflict.value.localDraft, null, 2))
    notify('Đã sao chép draft', { tone: 'success', message: 'Draft local đã nằm trong clipboard trước khi tải lại.' })
    reloadConflict()
  } catch {
    notify('Không thể truy cập clipboard', { tone: 'error', message: 'Draft vẫn được giữ; chưa tải revision mới.', assertive: true })
  } finally { copying.value = false }
}

onMounted(load)
</script>

<template>
  <div
    v-if="loadState === 'loading'"
    class="role-loading"
    role="status"
    aria-live="polite"
    aria-label="Đang tải role config"
  >
    <VtSkeleton height="52px" /><VtSkeleton height="180px" /><VtSkeleton height="150px" />
  </div>
  <VtCard
    v-else-if="loadState === 'error' || loadState === 'offline'"
    class="role-state role-state-error"
    role="alert"
  >
    <h2
      ref="stateHeading"
      tabindex="-1"
    >
      {{ loadState === 'offline' ? 'Manager API đang ngoại tuyến' : 'Không tải được role config' }}
    </h2>
    <p>{{ loadError }}</p>
    <VtButton
      variant="secondary"
      :loading="loading"
      @click="load"
    >
      Thử lại
    </VtButton>
  </VtCard>
  <form
    v-else-if="loadState === 'ready' && draft"
    class="role-form"
    :aria-busy="saving || publishing"
    @submit.prevent="save"
    @input="markDirty"
    @change="markDirty"
  >
    <FormSection
      title="Vai trò giọng nói"
      description="Ngôn ngữ hội thoại và giọng TTS được cấu hình riêng."
    >
      <template #trailing>
        <VtSwitch
          v-model="customRole"
          label="Tùy chỉnh"
        />
      </template>
      <div class="two-columns">
        <VtFormField
          label="Ngôn ngữ"
          for-id="role-locale"
        >
          <VtSelect
            id="role-locale"
            :model-value="draft.locale"
            label="Ngôn ngữ"
            :options="localeOptions"
            @update:model-value="onLocaleChanged"
          />
        </VtFormField>
        <VtFormField
          label="Giọng nói"
          for-id="role-voice"
        >
          <VtSelect
            id="role-voice"
            v-model="draft.speech.voiceId"
            label="Giọng nói"
            :options="voiceOptions"
            :disabled="voiceLoading"
          />
        </VtFormField>
      </div>
      <div class="voice-preview">
        <span>Nghe nhịp và dấu tiếng Việt trước khi lưu.</span><VtButton
          size="sm"
          @click="previewVoice"
        >
          <template #leading>
            <VtIcon
              :icon="Play"
              :size="14"
            />
          </template>Nghe thử giọng
        </VtButton>
      </div>
    </FormSection>

    <FormSection
      title="Tính cách"
      description="Có thể thêm profile mới mà không sửa component."
    >
      <VtFormField
        label="Profile tính cách"
        for-id="role-personality"
      >
        <VtSelect
          id="role-personality"
          v-model="draft.personalityId"
          label="Profile tính cách"
          :options="personalityOptions"
          @update:model-value="draft!.personalityName = personalityOptions.find((item) => item.value === $event)?.label ?? 'Tùy chỉnh'"
        />
      </VtFormField>
    </FormSection>

    <FormSection
      title="Base prompt"
      description="Chỉ dẫn nền được version hóa cùng Assistant config."
    >
      <template #trailing>
        <VtBadge :tone="draft.basePrompt.length > 2000 ? 'danger' : 'neutral'">
          {{ draft.basePrompt.length }} / 2.000 ký tự
        </VtBadge>
      </template>
      <VtFormField
        label="Chỉ dẫn cho trợ lý"
        for-id="role-prompt"
        :error="draft.basePrompt.length > 2000 ? 'Prompt vượt quá 2.000 ký tự trong bản preview.' : undefined"
        hint="Không hardcode tính cách trong pipeline; prompt này là dữ liệu cấu hình."
      >
        <template #default="{ describedby }">
          <VtTextArea
            id="role-prompt"
            v-model="draft.basePrompt"
            name="base-prompt"
            autocomplete="off"
            :rows="8"
            :invalid="draft.basePrompt.length > 2000"
            :aria-describedby="describedby"
          />
        </template>
      </VtFormField>
    </FormSection>

    <FormSection
      title="Cách nói"
      description="Nhịp nói áp dụng cho TTS streaming."
    >
      <div class="three-columns">
        <VtFormField
          label="Mức chi tiết"
          for-id="speech-style"
        >
          <VtSelect
            id="speech-style"
            v-model="draft.speech.style"
            label="Mức chi tiết"
            :options="styleOptions"
          />
        </VtFormField>
        <VtFormField
          label="Tốc độ"
          for-id="speech-rate"
        >
          <VtSelect
            id="speech-rate"
            :model-value="String(draft.speech.rate)"
            label="Tốc độ"
            :options="rateOptions"
            @update:model-value="draft!.speech.rate = Number($event)"
          />
        </VtFormField>
        <VtFormField
          label="Cao độ"
          for-id="speech-pitch"
        >
          <VtSelect
            id="speech-pitch"
            :model-value="String(draft.speech.pitch)"
            label="Cao độ"
            :options="pitchOptions"
            @update:model-value="draft!.speech.pitch = Number($event)"
          />
        </VtFormField>
      </div>
    </FormSection>

    <FormSection
      title="Giới hạn tài nguyên"
      description="Admission policy bảo vệ VRAM và giữ phiên còn lại ổn định."
    >
      <div class="two-columns">
        <VtFormField
          label="Lượt hội thoại đồng thời"
          for-id="role-max-active-turns"
          :error="maxActiveTurnsInvalid ? 'Chọn từ 1 đến 8 lượt.' : undefined"
          hint="Mặc định 1 trên máy local hiện tại."
        >
          <VtInput
            id="role-max-active-turns"
            type="number"
            autocomplete="off"
            min="1"
            max="8"
            step="1"
            inputmode="numeric"
            :model-value="String(draft.admission.maxActiveTurns)"
            name="max-active-turns"
            :invalid="maxActiveTurnsInvalid"
            aria-label="Lượt hội thoại đồng thời"
            @update:model-value="draft.admission.maxActiveTurns = Number($event)"
          />
        </VtFormField>
        <VtFormField
          label="Thời gian thử lại khi bận"
          for-id="role-retry-after-ms"
          :error="retryAfterInvalid ? 'Chọn từ 100 đến 10.000 ms.' : undefined"
          hint="Khoảng chờ gửi trong alert SERVER_BUSY."
        >
          <VtInput
            id="role-retry-after-ms"
            type="number"
            autocomplete="off"
            min="100"
            max="10000"
            step="50"
            inputmode="numeric"
            :model-value="String(draft.admission.retryAfterMs)"
            name="retry-after-ms"
            :invalid="retryAfterInvalid"
            aria-label="Thời gian thử lại khi bận"
            @update:model-value="draft.admission.retryAfterMs = Number($event)"
          />
        </VtFormField>
      </div>
    </FormSection>

    <FormSection
      title="Wake không có lời nói"
      description="Tự giải phóng lượt auto sau khi wake word nhưng chưa có speech xác nhận. Không giới hạn các cuộc hội thoại đã bắt đầu."
    >
      <template #trailing>
        <VtSwitch
          v-model="draft.autoTurn.enabled"
          label="Bật timeout"
        />
      </template>
      <div class="two-columns">
        <VtFormField
          label="Chờ speech tối đa (ms)"
          for-id="role-no-speech-timeout"
          :error="draft.autoTurn.enabled && noSpeechTimeoutInvalid ? 'Chọn từ 1.000 đến 60.000 ms.' : undefined"
          hint="Chỉ áp dụng trước speech đầu tiên của auto turn."
        >
          <VtInput
            id="role-no-speech-timeout"
            type="number"
            autocomplete="off"
            min="1000"
            max="60000"
            step="100"
            inputmode="numeric"
            :model-value="String(draft.autoTurn.noSpeechTimeoutMs)"
            name="no-speech-timeout-ms"
            :invalid="draft.autoTurn.enabled && noSpeechTimeoutInvalid"
            :disabled="!draft.autoTurn.enabled"
            aria-label="Chờ speech tối đa"
            @update:model-value="draft.autoTurn.noSpeechTimeoutMs = Number($event)"
          />
        </VtFormField>
        <VtFormField
          label="Thông báo khi chưa nghe thấy"
          for-id="role-no-speech-message"
          :error="draft.autoTurn.enabled && noSpeechAlertInvalid ? 'Nhập thông báo và metadata alert hợp lệ.' : undefined"
          hint="Nội dung đi từ i18n/config, không nằm trong server core."
        >
          <VtInput
            id="role-no-speech-message"
            :model-value="draft.autoTurn.noSpeechAlert.message"
            name="no-speech-message"
            autocomplete="off"
            :invalid="draft.autoTurn.enabled && noSpeechAlertInvalid"
            :disabled="!draft.autoTurn.enabled"
            aria-label="Thông báo khi chưa nghe thấy"
            @update:model-value="draft.autoTurn.noSpeechAlert.message = $event"
          />
        </VtFormField>
      </div>
      <div class="two-columns">
        <VtFormField
          label="Alert status"
          for-id="role-no-speech-status"
          optional
        >
          <VtInput
            id="role-no-speech-status"
            v-model="draft.autoTurn.noSpeechAlert.status"
            name="no-speech-status"
            autocomplete="off"
            :disabled="!draft.autoTurn.enabled"
            aria-label="Alert status"
          />
        </VtFormField>
        <VtFormField
          label="Emotion"
          for-id="role-no-speech-emotion"
          optional
        >
          <VtInput
            id="role-no-speech-emotion"
            v-model="draft.autoTurn.noSpeechAlert.emotion"
            name="no-speech-emotion"
            autocomplete="off"
            :disabled="!draft.autoTurn.enabled"
            aria-label="Emotion"
          />
        </VtFormField>
      </div>
    </FormSection>

    <footer class="form-actions">
      <p
        v-if="actionError"
        ref="actionErrorHeading"
        class="action-error"
        role="alert"
        tabindex="-1"
      >
        {{ actionError }}
      </p>
      <span
        class="dirty-status"
        :class="{ dirty }"
      >{{ dirty ? 'Có thay đổi chưa lưu' : 'Bản nháp đã đồng bộ' }}</span>
      <VtButton
        type="button"
        :disabled="!dirty || saving"
        @click="load"
      >
        Hủy thay đổi
      </VtButton>
      <VtButton
        type="submit"
        variant="primary"
        :disabled="!dirty || draft.basePrompt.length > 2000 || Boolean(admissionError) || autoTurnError"
        :loading="saving"
      >
        <template #leading>
          <VtIcon
            :icon="Save"
            :size="14"
          />
        </template>Lưu bản nháp
      </VtButton>
      <VtButton
        type="button"
        variant="secondary"
        :disabled="dirty || saving || publishing"
        :loading="publishing"
        @click="publish"
      >
        Áp dụng runtime
      </VtButton>
    </footer>
  </form>
  <RevisionConflictDialog
    v-if="conflict"
    :open="true"
    :current-revision="conflict.currentRevision"
    :copying="copying"
    @update:open="!$event && (conflict = undefined)"
    @reload="reloadConflict"
    @copy="copyAndReload"
    @cancel="conflict = undefined"
  />
</template>

<style scoped>
.role-loading, .role-form { display: grid; gap: 14px; }
.role-state { display: grid; justify-items: center; gap: 4px; color: var(--vt-text-muted); padding: 24px; text-align: center; }
.role-state h2 { margin: 0; color: var(--vt-text); font-size: 14px; }
.role-state p { max-width: 460px; margin: 3px auto 10px; font-size: 11px; line-height: 1.5; }
.role-state h2:focus-visible, .action-error:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--vt-focus); border-radius: 3px; }
.two-columns { display: grid; grid-template-columns: minmax(0, .75fr) minmax(0, 1.25fr); gap: 10px; }
.three-columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.voice-preview { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 11px; border-top: 1px solid var(--vt-border); padding-top: 11px; }
.voice-preview span { color: var(--vt-text-muted); font-size: 10px; }
.form-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--vt-border); padding-top: 14px; }
.dirty-status { margin-right: auto; color: var(--vt-success); font-size: 10px; }
.dirty-status.dirty { color: var(--vt-warning); }
.action-error { flex: 1; margin: 0; color: var(--vt-danger); font-size: 10px; line-height: 1.45; }
@media (max-width: 660px) { .two-columns, .three-columns { grid-template-columns: 1fr; } .form-actions { flex-wrap: wrap; } .dirty-status { width: 100%; } }
</style>
