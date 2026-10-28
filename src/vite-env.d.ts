/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_NAME: string;
  /**
   * Declares which environment this build targets so the Platform Owner
   * dashboard can label it. The `environment.name` platform setting takes
   * precedence whenever it is present.
   */
  readonly VITE_ENVIRONMENT?: string;
  /** Usetally base URL for "Connect Usetally" (default https://usetally.cc). */
  readonly VITE_USETALLY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
