<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { AudioWaveform, BrainCircuit, Database, Lightbulb, Mic, Volume2 } from '@lucide/vue'

import { requireInjection } from '@/app/requireInjection'
import { useUnsavedChangesGuard } from '@/app/useUnsavedChangesGuard'
import type { ProviderConfigRecord, ProviderInstallationView, ProviderKind, ProviderProbeResult, SecretReference } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import FormSection from '@/ui/patterns/FormSection.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtCheckbox from '@/ui/primitives/VtCheckbox.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import { notify } from '@/ui/primitives/notifications'

import SchemaConfigForm from './SchemaConfigForm.vue'
import SecretReferencePanel from './SecretReferencePanel.vue'
import ProviderConfigList from './ProviderConfigList.vue'
import VoiceCatalogPanel from './VoiceCatalogPanel.vue'
import UnsavedChangesDialog from '@/ui/patterns/UnsavedChangesDialog.vue'
import { cloneConfig } from './schema-config'

const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const installations = ref<ProviderInstallationView[]>([])
const configs = ref<ProviderConfigRecord[]>([])
const secretReferences = ref<SecretReference[]>([])
const selectedSecretRefs = ref<string[]>([])
const probeResults = ref<Record<string, ProviderProbeResult | undefined>>({})
const providerQuery = ref('')
const activeKind = ref<ProviderKind>('vad')
const probingId = ref('')
const removeId = ref('')
const removing = ref(false)
const selectedId = ref('')
const selectedConfigId = ref('')
const name = ref('')
const configDraft = ref<Record<string, unknown>>({})
const configValid = ref(true)
const loading = ref(true)
const saving = ref(false)
const loadState = ref<'loading' | 'ready' | 'empty' | 'error' | 'offline'>('loading')
const loadError = ref('')
const saveError = ref('')
const stateHeading = ref<HTMLElement | null>(null)
const saveErrorHeading = ref<HTMLElement | null>(null)
let loadGeneration = 0

const kindLabels: Record<ProviderKind, string> = {
  vad: 'Lọc tiếng ồn',
  asr: 'Nhận dạng lời nói',
  llm: 'Bộ não trả lời',
  tts: 'Giọng nói',
  intent: 'Hiểu ý định',
  memory: 'Ghi nhớ',
}
const kindDescriptions: Record<ProviderKind, string> = {
  vad: 'Giảm tiếng ồn và tìm lúc bạn bắt đầu nói',
  asr: 'Chuyển lời nói thành văn bản',
  llm: 'Suy luận, streaming và gọi tool',
  tts: 'Chọn model và quản lý giọng nói',
  intent: 'Nhận diện thao tác nhanh theo cấu hình',
  memory: 'Giữ ngữ cảnh cho các lượt trò chuyện',
}
const kindIcons = { vad: AudioWaveform, asr: Mic, llm: BrainCircuit, tts: Volume2, intent: Lightbulb, memory: Database } as const
const kindItems = (Object.keys(kindLabels) as ProviderKind[]).map((id) => ({ id, label: kindLabels[id], description: kindDescriptions[id], icon: kindIcons[id] }))
const installationsForKind = computed(() => installations.value.filter((item) => item.kind === activeKind.value))
const configsForKind = computed(() => configs.value.filter((config) => installations.value.some((item) => item.id === config.installationId && item.kind === activeKind.value)))
const kindCounts = computed(() => Object.fromEntries((Object.keys(kindLabels) as ProviderKind[]).map((kind) => [kind, configs.value.filter((config) => installations.value.some((item) => item.id === config.installationId && item.kind === kind)).length])))
const options = computed<VtSelectOption[]>(() => installationsForKind.value.map((item) => ({ value: item.id, label: item.displayName ?? item.displayNameKey, description: `${kindLabels[item.kind]} · ${item.version}` })))
const selected = computed(() => installations.value.find((item) => item.id === selectedId.value))
const removeTarget = computed(() => configs.value.find((item) => item.id === removeId.value))
const selectedProbe = computed(() => selectedConfigId.value ? probeResults.value[selectedConfigId.value] : undefined)
const emptyHeading = computed(() => loadState.value === 'ready' ? `Chưa có nhà cung cấp cho nhóm ${kindLabels[activeKind.value].toLowerCase()}` : 'Chưa có dịch vụ nào')
const emptyDescription = computed(() => loadState.value === 'ready'
  ? 'Nhóm này chưa có installation khả dụng trong catalog. Hãy nạp provider tương ứng trước khi tạo cấu hình.'
  : 'Danh sách dịch vụ chưa sẵn sàng. Hãy tải lại để thử lại.')

function checkLabel(id: string) {
  return ({ schema: 'Cấu hình', secrets: 'Khóa kết nối', manifest: 'Dịch vụ' } as Record<string, string>)[id] ?? 'Chi tiết kiểm tra'
}

function secretStatusLabel(status: SecretReference['status']) {
  return status === 'available' ? 'Sẵn sàng' : status === 'revoked' ? 'Đã thu hồi' : 'Chưa sẵn sàng'
}

function formatCheckedAt(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function chooseInstallation(value: string) {
  selectedId.value = value
  const item = configs.value.find((config) => config.installationId === value)
  selectedConfigId.value = item?.id ?? ''
  name.value = item?.name ?? ''
  configDraft.value = cloneConfig(item?.config ?? {})
  configValid.value = true
  selectedSecretRefs.value = [...(item?.secretRefs ?? [])]
}

function selectKind(kind: ProviderKind) {
  activeKind.value = kind
  const first = installations.value.find((item) => item.kind === kind)
  if (!first) {
    selectedId.value = ''
    selectedConfigId.value = ''
    startNew()
    return
  }
  if (selected.value?.kind !== kind) chooseInstallation(first.id)
}

function chooseConfig(id: string) {
  const config = configs.value.find((item) => item.id === id)
  if (!config) return
  selectedConfigId.value = config.id
  chooseInstallation(config.installationId)
  selectedConfigId.value = config.id
}

function startNew() {
  selectedConfigId.value = ''
  name.value = ''
  configDraft.value = {}
  selectedSecretRefs.value = []
  configValid.value = true
}

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  loadState.value = 'loading'
  loadError.value = ''
  try {
    const [catalog, configured, secrets] = await Promise.all([
      gateway.listProviderInstallations(),
      gateway.listProviderConfigs(),
      gateway.listSecretReferences(),
    ])
    if (generation !== loadGeneration) return

    const failures = [
      !catalog.ok ? 'catalog' : null,
      !configured.ok ? 'config' : null,
      !secrets.ok ? 'secret' : null,
    ].filter((value): value is string => value !== null)
    if (failures.length > 0) {
      const offline = catalog.meta.offline || configured.meta.offline || secrets.meta.offline
      loadState.value = offline ? 'offline' : 'error'
      loadError.value = failures.includes('catalog') && failures.includes('config') && failures.includes('secret')
        ? 'Không tải được danh sách dịch vụ và khóa kết nối.'
        : failures.includes('catalog') && failures.includes('config')
          ? 'Không tải được danh sách dịch vụ.'
          : failures.includes('catalog') && failures.includes('secret')
          ? 'Không tải được danh sách dịch vụ và khóa kết nối.'
            : failures.includes('config') && failures.includes('secret')
              ? 'Không tải được cấu hình dịch vụ và khóa kết nối.'
              : failures[0] === 'catalog'
                ? 'Không tải được danh sách dịch vụ.'
                : failures[0] === 'config'
                  ? 'Không tải được cấu hình dịch vụ.'
                  : 'Không tải được danh sách khóa kết nối.'
      await focusStateHeading()
      return
    }

    if (!catalog.ok || !configured.ok || !secrets.ok) return
    configs.value = configured.data
    installations.value = catalog.data
    secretReferences.value = secrets.data
    probeResults.value = Object.fromEntries(Object.entries(probeResults.value).filter(([id]) => configured.data.some((item) => item.id === id)))
    if (!catalog.data.some((item) => item.id === selectedId.value)) {
      selectedId.value = ''
      selectedConfigId.value = ''
    }
    if (!catalog.data.some((item) => item.kind === activeKind.value)) activeKind.value = catalog.data[0]?.kind ?? 'vad'
    if (!selectedId.value || selected.value?.kind !== activeKind.value) {
      const first = catalog.data.find((item) => item.kind === activeKind.value)
      if (first) chooseInstallation(first.id)
    }
    loadState.value = catalog.data.length > 0 ? 'ready' : 'empty'
  } catch {
    if (generation !== loadGeneration) return
    loadState.value = 'offline'
    loadError.value = 'Không kết nối được máy chủ quản trị. Kiểm tra service hoặc mạng LAN.'
    await focusStateHeading()
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

async function probe(id: string) {
  probingId.value = id
  const result = await gateway.probeProviderConfig(id)
  probingId.value = ''
  if (result.ok) {
    probeResults.value = { ...probeResults.value, [id]: result.data }
    notify(result.data.state === 'ready' ? 'Dịch vụ sẵn sàng' : 'Dịch vụ chưa sẵn sàng', { tone: result.data.state === 'ready' ? 'success' : 'error', message: result.data.checks.map((check) => check.message).join(' · '), assertive: result.data.state !== 'ready' })
  } else {
    notify('Không thể kiểm tra dịch vụ', { tone: 'error', message: result.meta.offline ? 'Máy chủ quản trị đang ngoại tuyến.' : 'Cấu hình dịch vụ không còn khả dụng.', assertive: true })
  }
}

function requestRemove(id: string) {
  removeId.value = id
}

function closeRemove() {
  removeId.value = ''
}

async function remove() {
  const target = removeTarget.value
  if (!target) return
  removing.value = true
  const result = await gateway.deleteProviderConfig(target.id, target.etag)
  removing.value = false
  if (!result.ok) {
    notify('Không thể xóa cấu hình', { tone: 'error', message: result.meta.offline ? 'Máy chủ quản trị đang ngoại tuyến.' : 'Cấu hình đang được dùng hoặc đã thay đổi; hãy tải lại.', assertive: true })
    return
  }
  configs.value = configs.value.filter((item) => item.id !== target.id)
  const nextProbeResults = { ...probeResults.value }
  delete nextProbeResults[target.id]
  probeResults.value = nextProbeResults
  removeId.value = ''
  if (selectedConfigId.value === target.id) {
    const fallback = configs.value.find((item) => item.installationId === target.installationId)
    if (fallback) chooseConfig(fallback.id)
    else startNew()
  }
  notify('Đã xóa cấu hình khỏi danh sách', { tone: 'success', message: 'Lịch sử cấu hình vẫn được giữ nguyên.' })
}

async function focusStateHeading() {
  await nextTick()
  stateHeading.value?.focus()
}

async function focusSaveError() {
  await nextTick()
  saveErrorHeading.value?.focus()
}

async function save() {
  if (!selected.value || !name.value.trim() || !configValid.value) return
  saveError.value = ''
  saving.value = true
  const payload = { name: name.value.trim(), config: cloneConfig(configDraft.value), secretRefs: [...selectedSecretRefs.value] }
  try {
    const result = selectedConfigId.value
      ? await gateway.updateProviderConfig(selectedConfigId.value, payload, configs.value.find((item) => item.id === selectedConfigId.value)?.etag ?? '"missing"')
      : await gateway.createProviderConfig({ installationId: selected.value.id, ...payload })
    if (result.ok) {
      configs.value = [...configs.value.filter((item) => item.id !== result.data.id), result.data]
      selectedConfigId.value = result.data.id
      notify('Đã lưu cấu hình dịch vụ', { tone: 'success', message: 'Cấu hình mới đã sẵn sàng; trợ lý chỉ đổi dịch vụ khi bạn chọn và áp dụng.' })
    } else {
      saveError.value = result.meta.offline
        ? 'Đang ngoại tuyến; thay đổi vẫn được giữ trên màn hình và chưa được gửi.'
        : 'Không thể lưu cấu hình dịch vụ; thay đổi vẫn được giữ để bạn sửa hoặc thử lại.'
      notify('Không thể lưu cấu hình dịch vụ', { tone: 'error', message: saveError.value, assertive: true })
      await focusSaveError()
    }
  } catch {
    saveError.value = 'Không kết nối được máy chủ quản trị; thay đổi vẫn được giữ trên màn hình.'
    notify('Không thể lưu cấu hình dịch vụ', { tone: 'error', message: saveError.value, assertive: true })
    await focusSaveError()
  } finally {
    saving.value = false
  }
}

onMounted(load)

watch(activeKind, (kind) => {
  if (loading.value) return
  const first = installations.value.find((item) => item.kind === kind)
  if (first && selected.value?.kind !== kind) chooseInstallation(first.id)
})

const unknownSecretRefs = computed(() => selectedSecretRefs.value.filter((id) => !secretReferences.value.some((item) => item.id === id)))

const editorDirty = computed(() => {
  const current = configs.value.find((item) => item.id === selectedConfigId.value)
  const draft = { name: name.value.trim(), config: cloneConfig(configDraft.value), secretRefs: [...selectedSecretRefs.value].sort() }
  const saved = { name: current?.name ?? '', config: cloneConfig(current?.config ?? {}), secretRefs: [...(current?.secretRefs ?? [])].sort() }
  return JSON.stringify(draft) !== JSON.stringify(saved)
})
const unsavedGuard = useUnsavedChangesGuard(editorDirty)

function toggleSecretReference(id: string, checked: boolean) {
  const next = new Set(selectedSecretRefs.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedSecretRefs.value = [...next]
}
</script>

<template>
  <main
    id="main-content"
    class="page-container provider-page"
    :aria-busy="loading"
  >
    <header class="provider-header">
      <div>
        <p class="eyebrow">
          Dịch vụ AI
        </p><h1>Các dịch vụ AI</h1><p class="lede">
          Chọn cách Veetee nghe, hiểu và trả lời. Bạn có thể thay đổi cấu hình mà không cần sửa code.
        </p>
      </div>
      <VtBadge tone="primary">
        Có thể tùy chỉnh
      </VtBadge>
    </header>
    <div
      v-if="loadState === 'loading'"
      class="provider-state"
      role="status"
      aria-live="polite"
    >
      Đang tải danh sách dịch vụ…
    </div>
    <VtCard
      v-else-if="loadState === 'error' || loadState === 'offline'"
      class="provider-state provider-state-error"
      role="alert"
    >
      <h2
        ref="stateHeading"
        tabindex="-1"
      >
        {{ loadState === 'offline' ? 'Máy chủ quản trị đang ngoại tuyến' : 'Không tải được danh sách dịch vụ' }}
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
    <div
      v-else-if="loadState === 'ready' && selected"
      class="provider-content"
    >
      <nav
        class="provider-kind-nav"
        aria-label="Nhóm dịch vụ AI"
      >
        <button
          v-for="item in kindItems"
          :key="item.id"
          class="provider-kind-tab"
          :class="{ active: activeKind === item.id }"
          type="button"
          :aria-current="activeKind === item.id ? 'page' : undefined"
          @click="selectKind(item.id)"
        >
          <span class="provider-kind-icon"><VtIcon
            :icon="item.icon"
            :size="17"
          /></span>
          <span class="provider-kind-copy"><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
          <span class="provider-kind-count">{{ kindCounts[item.id] ?? 0 }}</span>
        </button>
      </nav>
      <div class="provider-list-toolbar">
        <p>{{ kindLabels[activeKind] }} được quản lý riêng. Thay đổi chỉ có hiệu lực sau khi bạn áp dụng cấu hình cho trợ lý.</p>
        <VtButton
          size="sm"
          variant="primary"
          @click="startNew"
        >
          Tạo cấu hình
        </VtButton>
      </div>
      <ProviderConfigList
        v-model:query="providerQuery"
        v-model:kind="activeKind"
        :configs="configsForKind"
        :installations="installationsForKind"
        :selected-id="selectedConfigId"
        :probe-results="probeResults"
        :probing-id="probingId"
        @select="chooseConfig"
        @probe="probe"
        @remove="requestRemove"
      />
      <div class="provider-layout">
        <FormSection
          title="Nhà cung cấp"
          :description="`${kindLabels[activeKind]} có thể có nhiều cấu hình độc lập.`"
        >
          <VtFormField
            label="Dịch vụ"
            for-id="provider-installation"
          >
            <VtSelect
              id="provider-installation"
              :model-value="selectedId"
              label="Dịch vụ"
              :options="options"
              @update:model-value="chooseInstallation"
            />
          </VtFormField>
          <div class="provider-meta">
            <VtStatus
              tone="online"
              :label="kindLabels[activeKind]"
            /><span>Biểu mẫu được sinh từ schema của nhà cung cấp</span>
          </div>
        </FormSection>
        <VtCard class="config-card">
          <h2>Cấu hình dịch vụ</h2>
          <p class="muted">
            Các trường được sinh tự động. Khóa kết nối chỉ được lưu an toàn và không hiển thị lại trên trình duyệt.
          </p>
          <VtFormField
            label="Tên cấu hình"
            for-id="provider-name"
          >
            <VtInput
              id="provider-name"
              v-model="name"
              name="provider-config-name"
              autocomplete="off"
              placeholder="Tên hiển thị…"
            />
          </VtFormField>
          <SchemaConfigForm
            v-model="configDraft"
            :schema="selected.configSchema"
            :disabled="saving"
            @validity-change="configValid = $event"
          />
          <VtFormField
            label="Khóa kết nối"
            for-id="provider-secrets"
            hint="Chọn khóa đã lưu an toàn; giá trị bí mật không hiển thị trên màn hình."
          >
            <div
              id="provider-secrets"
              class="secret-selection"
            >
              <div
                v-for="item in secretReferences"
                :key="item.id"
                class="secret-option"
              >
                <VtCheckbox
                  :model-value="selectedSecretRefs.includes(item.id)"
                  :label="item.name"
                  :disabled="saving"
                  @update:model-value="toggleSecretReference(item.id, $event)"
                />
                <span class="secret-option-meta"><small>{{ secretStatusLabel(item.status) }}</small></span>
              </div>
              <p
                v-if="unknownSecretRefs.length"
                class="unknown-secret"
              >
                Một khóa kết nối cũ vẫn được giữ nguyên để không làm gián đoạn dịch vụ.
              </p>
              <p
                v-if="!secretReferences.length && !unknownSecretRefs.length"
                class="unknown-secret"
              >
                Chưa có khóa kết nối. Bạn có thể tạo khóa ở phần bên dưới rồi chọn lại.
              </p>
            </div>
          </VtFormField>
          <div class="actions">
            <p
              v-if="saveError"
              ref="saveErrorHeading"
              class="provider-save-error"
              role="alert"
              tabindex="-1"
            >
              {{ saveError }}
            </p>
            <VtButton
              variant="primary"
              :loading="saving"
              :disabled="!name.trim() || !configValid"
              @click="save"
            >
              Lưu cấu hình
            </VtButton>
          </div>
          <VtCard
            v-if="selectedProbe"
            class="probe-card"
            role="status"
          >
            <div class="probe-heading">
              <div><h3>Kết quả kiểm tra</h3><p>Lần gần nhất: {{ formatCheckedAt(selectedProbe.checkedAt) }}</p></div>
              <VtStatus
                :tone="selectedProbe.state === 'ready' ? 'online' : 'error'"
                :label="selectedProbe.state === 'ready' ? 'Sẵn sàng' : 'Không khả dụng'"
              />
            </div>
            <ul class="probe-checks">
              <li
                v-for="check in selectedProbe.checks"
                :key="check.id"
                :class="`is-${check.state}`"
              >
                <strong>{{ checkLabel(check.id) }}</strong><span>{{ check.message }}</span>
              </li>
            </ul>
          </VtCard>
        </VtCard>
        <SecretReferencePanel
          :gateway="gateway"
          :items="secretReferences"
          :selected-ids="selectedSecretRefs"
          @update:selected-ids="selectedSecretRefs = $event"
          @changed="load"
        />
        <VoiceCatalogPanel
          v-if="activeKind === 'tts'"
          :configs="configsForKind"
          :gateway="gateway"
        />
      </div>
    </div>
    <VtCard
      v-else
      class="empty-card"
    >
      <h2
        ref="stateHeading"
        tabindex="-1"
      >
        {{ emptyHeading }}
      </h2>
      <p>{{ emptyDescription }}</p>
      <VtButton
        variant="secondary"
        :loading="loading"
        @click="load"
      >
        Tải lại danh sách
      </VtButton>
    </VtCard>
    <VtDialog
      :open="Boolean(removeTarget)"
      title="Xóa cấu hình?"
      :description="removeTarget ? `${removeTarget.name} sẽ không còn xuất hiện trong danh sách chọn. Lịch sử cấu hình vẫn được giữ.` : undefined"
      width="sm"
      @update:open="!$event && closeRemove()"
    >
      <p class="dialog-warning">
        Nếu cấu hình đang được trợ lý sử dụng, thao tác sẽ bị từ chối để không làm gián đoạn cuộc trò chuyện.
      </p>
      <template #footer>
        <VtButton @click="removeId = ''">
          Hủy
        </VtButton>
        <VtButton
          variant="danger"
          :loading="removing"
          @click="remove"
        >
          Xóa cấu hình khỏi danh sách
        </VtButton>
      </template>
    </VtDialog>
    <UnsavedChangesDialog
      :open="unsavedGuard.open.value"
      @stay="unsavedGuard.stay"
      @leave="unsavedGuard.leave"
    />
  </main>
</template>

<style scoped>
.provider-page { display: grid; gap: 16px; }
.provider-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.provider-content { display: grid; gap: 14px; }
.provider-kind-nav { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
.provider-kind-tab { display: flex; min-width: 0; align-items: flex-start; gap: 8px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface); padding: 10px; color: var(--vt-text-muted); text-align: left; transition: border-color var(--vt-transition), background var(--vt-transition), color var(--vt-transition), transform var(--vt-transition); }
.provider-kind-tab:hover { border-color: var(--vt-primary); background: var(--vt-primary-soft); color: var(--vt-text); transform: translateY(-1px); }
.provider-kind-tab.active { border-color: var(--vt-primary); background: var(--vt-primary-soft); color: var(--vt-text); box-shadow: 0 0 0 2px rgba(47, 107, 255, .08); }
.provider-kind-icon { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--vt-surface-subtle); color: var(--vt-primary); }
.provider-kind-copy { display: grid; min-width: 0; gap: 3px; flex: 1; }
.provider-kind-copy strong { overflow: hidden; color: inherit; font-size: 10px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.provider-kind-copy small { display: -webkit-box; overflow: hidden; color: var(--vt-text-muted); font-size: 8px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.provider-kind-count { display: grid; flex: none; place-items: center; min-width: 18px; height: 18px; border-radius: 999px; background: var(--vt-surface-subtle); color: var(--vt-text-muted); font-size: 9px; font-variant-numeric: tabular-nums; }
.provider-list-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--vt-text-muted); font-size: 10px; }
.provider-list-toolbar p { margin: 0; }
.secret-selection { display: grid; gap: 7px; min-height: 38px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 9px 10px; }
.secret-option { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--vt-text-soft); font-size: 11px; }
.secret-option :deep(.vt-checkbox-label) { min-width: 0; flex: 1; cursor: pointer; }
.secret-option :deep(.vt-checkbox-label > span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.secret-option-meta { flex: none; color: var(--vt-text-muted); font-size: 9px; }
.secret-option small, .unknown-secret { color: var(--vt-text-muted); font-size: 9px; }
.unknown-secret { margin: 0; line-height: 1.45; }
.eyebrow { margin: 0 0 4px; color: var(--vt-primary); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1, h2 { margin: 0; color: var(--vt-text); }
h1 { font-size: 22px; letter-spacing: -.02em; }
h2 { margin-bottom: 6px; font-size: 14px; }
.lede, .muted { margin: 6px 0 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.5; }
.provider-layout { display: grid; grid-template-columns: minmax(240px, .8fr) minmax(0, 1.2fr); gap: 14px; align-items: start; }
.provider-layout > :deep(.secret-card) { grid-column: 1 / -1; min-width: 0; }
.provider-meta { display: flex; align-items: center; gap: 10px; margin-top: 12px; color: var(--vt-text-muted); font-size: 10px; }
.config-card { display: grid; gap: 12px; }
.probe-card { display: grid; gap: 9px; background: var(--vt-surface-subtle); padding: 12px; }
.probe-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.probe-heading h3 { margin: 0; color: var(--vt-text); font-size: 12px; }
.probe-heading p { margin: 2px 0 0; color: var(--vt-text-muted); font-size: 9px; }
.probe-checks { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
.probe-checks li { display: flex; gap: 8px; border: 1px solid var(--vt-border); border-radius: 4px; background: var(--vt-surface); padding: 6px 7px; color: var(--vt-text-muted); font-size: 9px; }
.probe-checks li strong { min-width: 52px; color: var(--vt-text-soft); font-weight: 600; }
.probe-checks li.is-failed { border-color: #efc2c6; background: var(--vt-danger-soft); color: var(--vt-danger); }
.actions { display: flex; justify-content: flex-end; border-top: 1px solid var(--vt-border); padding-top: 12px; }
.dialog-warning { margin: 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.5; }
.provider-state, .empty-card { color: var(--vt-text-muted); padding: 24px; text-align: center; }
.provider-state h2, .empty-card h2 { color: var(--vt-text); font-size: 14px; }
.provider-state p, .empty-card p { margin: 7px auto 13px; max-width: 460px; font-size: 11px; line-height: 1.5; }
.provider-state-error { display: grid; justify-items: center; gap: 4px; }
.provider-state-error h2:focus-visible, .empty-card h2:focus-visible, .provider-save-error:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--vt-focus); border-radius: 3px; }
.provider-save-error { flex: 1; margin: 0; color: var(--vt-danger); font-size: 11px; line-height: 1.45; }
@media (max-width: 980px) { .provider-kind-nav { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 760px) { .provider-header, .provider-layout { grid-template-columns: 1fr; display: grid; } }
@media (max-width: 600px) { .provider-kind-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .provider-list-toolbar { align-items: stretch; flex-direction: column; } .provider-list-toolbar .vt-button { width: 100%; } }
</style>
