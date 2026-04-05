import type { InjectionKey, Ref } from "vue";
import { computed, inject } from "vue";
import type { MeResponse } from "../../../packages/shared-types";
import type { StoredAuthSession } from "../services/auth-session-store";

export interface AuthContextValue {
  authSession: Ref<StoredAuthSession | null>;
  appSession: Ref<MeResponse | null>;
  mode: Ref<"firebase" | "stub" | "anonymous">;
  isReady: Ref<boolean>;
  isLoading: Ref<boolean>;
  errorMessage: Ref<string>;
  sessionVersion: Ref<number>;
  refreshSession: () => Promise<MeResponse | null>;
  login: (input: {
    email: string;
    password: string;
    rememberBrowser?: boolean;
  }) => Promise<MeResponse | null>;
  signup: (input: {
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<MeResponse | null>;
  updateDisplayName: (displayName: string) => Promise<MeResponse | null>;
  requestPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContextKey = Symbol("AuthContext") as InjectionKey<AuthContextValue>;

export function useAuthContext(): AuthContextValue & {
  isAuthenticated: Readonly<Ref<boolean>>;
  currentUser: Readonly<Ref<MeResponse["user"] | null>>;
  activeBusinessId: Readonly<Ref<string | null>>;
  isUsingStub: Readonly<Ref<boolean>>;
} {
  const context = inject(AuthContextKey);

  if (!context) {
    throw new Error("Auth context is not available.");
  }

  const isAuthenticated = computed(() => context.mode.value !== "anonymous");
  const currentUser = computed(() => context.appSession.value?.user ?? null);
  const activeBusinessId = computed(() => context.appSession.value?.activeBusinessId ?? null);
  const isUsingStub = computed(() => context.mode.value === "stub");

  return {
    ...context,
    isAuthenticated,
    currentUser,
    activeBusinessId,
    isUsingStub,
  };
}
