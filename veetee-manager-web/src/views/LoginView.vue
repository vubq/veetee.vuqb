<script setup lang="ts">
import { Mail, LockKeyhole } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { authSession } from '@/auth/auth-session'
import VtBrandMark from '@/components/brand/VtBrandMark.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const email = ref('')
const password = ref('')
const submitting = ref(false)
const errorCode = ref('')

const errorMessage = computed(() => {
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: t('auth.errors.invalidCredentials'),
    LOGIN_THROTTLED: t('auth.errors.throttled'),
    NETWORK_UNAVAILABLE: t('auth.errors.network'),
    PREVIEW_MODE: t('auth.errors.preview'),
  }
  return messages[errorCode.value] ?? (errorCode.value ? t('auth.errors.generic') : '')
})

function safeRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/assistants'
}

async function submit() {
  errorCode.value = ''
  const normalizedEmail = email.value.trim()
  if (!normalizedEmail || !password.value) {
    errorCode.value = 'INVALID_CREDENTIALS'
    return
  }
  submitting.value = true
  const result = await authSession.login(normalizedEmail, password.value)
  submitting.value = false
  if (!result.ok) {
    errorCode.value = result.failure.code
    return
  }
  await router.replace(safeRedirect(route.query.redirect))
}
</script>

<template>
  <main
    id="main-content"
    class="login-page"
  >
    <section class="login-shell">
      <div class="login-brand">
        <VtBrandMark size="md" />
        <div><strong>Veetee</strong><span>Manager</span></div>
      </div>
      <VtCard class="login-card">
        <header class="login-heading">
          <p class="eyebrow">
            {{ t('auth.eyebrow') }}
          </p>
          <h1>{{ t('auth.title') }}</h1>
          <p>
            {{ t('auth.description') }}
          </p>
        </header>

        <div
          v-if="errorMessage"
          class="login-alert"
          role="alert"
        >
          {{ errorMessage }}
        </div>

        <form
          class="login-form"
          @submit.prevent="submit"
        >
          <VtFormField
            :label="t('auth.email')"
            for-id="login-email"
            :error="errorCode === 'INVALID_CREDENTIALS' ? errorMessage : undefined"
          >
            <template #default="{ describedby }">
              <VtInput
                id="login-email"
                v-model="email"
                name="email"
                :icon="Mail"
                type="email"
                autocomplete="username"
                spellcheck="false"
                :placeholder="t('auth.emailPlaceholder')"
                :aria-describedby="describedby"
                :invalid="errorCode === 'INVALID_CREDENTIALS'"
                required
              />
            </template>
          </VtFormField>
          <VtFormField
            :label="t('auth.password')"
            for-id="login-password"
          >
            <template #default="{ describedby }">
              <VtInput
                id="login-password"
                v-model="password"
                name="password"
                :icon="LockKeyhole"
                type="password"
                autocomplete="current-password"
                :placeholder="t('auth.passwordPlaceholder')"
                :aria-describedby="describedby"
                required
              />
            </template>
          </VtFormField>
          <VtButton
            type="submit"
            variant="primary"
            block
            :loading="submitting"
          >
            {{ t('auth.submit') }}
          </VtButton>
        </form>
        <p
          v-if="authSession.status.value === 'preview'"
          class="preview-note"
        >
          {{ t('auth.previewNote') }}
        </p>
      </VtCard>
    </section>
  </main>
</template>

<style scoped>
.login-page { display: grid; min-height: calc(100vh - 20px); place-items: center; background: var(--vt-page); padding: 24px; }
.login-shell { width: min(100%, 390px); }
.login-brand { display: flex; align-items: center; justify-content: center; gap: 9px; margin-bottom: 16px; color: var(--vt-text); }
.login-brand > div { display: flex; align-items: baseline; gap: 5px; }
.login-brand strong { font-size: 15px; }
.login-brand span:not(.brand-mark) { color: var(--vt-text-muted); font-size: 10px; }
.login-card { padding: 24px; }
.login-heading h1 { margin: 0; font-size: 22px; letter-spacing: -0.02em; }
.login-heading p:not(.eyebrow) { margin: 6px 0 0; color: var(--vt-text-muted); font-size: 12px; line-height: 1.55; }
.eyebrow { margin: 0 0 6px; color: var(--vt-primary); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.login-alert { margin-top: 17px; border: 1px solid rgba(214, 69, 80, 0.28); border-radius: var(--vt-radius-control); background: rgba(214, 69, 80, 0.06); color: var(--vt-danger); padding: 10px 11px; font-size: 11px; line-height: 1.45; }
.login-form { display: grid; gap: 16px; margin-top: 20px; }
.preview-note { margin: 15px 0 0; color: var(--vt-text-faint); font-size: 10px; text-align: center; }
@media (max-width: 440px) { .login-page { padding: 14px; } .login-card { padding: 19px 16px; } }
</style>
