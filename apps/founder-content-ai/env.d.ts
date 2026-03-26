/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_DEV_USER_ID?: string;
  readonly VITE_DEV_USER_EMAIL?: string;
  readonly VITE_DEV_USER_NAME?: string;
  readonly VITE_DEV_SUPER_ADMIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
