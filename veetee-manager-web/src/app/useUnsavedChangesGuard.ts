import { inject, onBeforeUnmount, ref, type ComputedRef } from 'vue'
import { matchedRouteKey, onBeforeRouteLeave } from 'vue-router'

/**
 * Keeps route changes explicit when a form contains a local draft.
 * The promise is resolved by the shared dialog instead of relying on the
 * browser's native confirmation UI.
 */
export function useUnsavedChangesGuard(dirty: ComputedRef<boolean>) {
  const open = ref(false)
  let resolvePending: ((allow: boolean) => void) | undefined

  if (inject(matchedRouteKey)) {
    onBeforeRouteLeave(() => {
      if (!dirty.value) return true
      open.value = true
      return new Promise<boolean>((resolve) => {
        resolvePending = resolve
      })
    })
  }

  function stay() {
    resolvePending?.(false)
    resolvePending = undefined
    open.value = false
  }

  function leave() {
    resolvePending?.(true)
    resolvePending = undefined
    open.value = false
  }

  onBeforeUnmount(() => {
    resolvePending?.(false)
    resolvePending = undefined
  })

  return { open, stay, leave }
}
