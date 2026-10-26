/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** `1` shows "Continue with Google" without asking the project's Auth settings (see src/online/core/providers.ts). */
  readonly VITE_GOOGLE_AUTH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
