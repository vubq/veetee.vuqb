/**
 * The preview controls are useful only when the mock gateway is active. Keep
 * the mode decision at the application boundary so feature components do not
 * infer it from the concrete gateway implementation.
 */
export const isApiMode = Boolean(import.meta.env.VITE_MANAGER_API_URL)
export const isPreviewMode = !isApiMode
