<script setup lang="ts">
import { onMounted, provide, ref } from "vue";
import type { MeResponse } from "../../../packages/shared-types";
import { AuthContextKey } from "./auth-context";
import {
  loginWithEmailPassword,
  logoutFrontendSession,
  restoreFrontendAuthSession,
  signupWithEmailPassword,
} from "../services/auth-service";
import type { StoredAuthSession } from "../services/auth-session-store";

const authSession = ref<StoredAuthSession | null>(null);
const appSession = ref<MeResponse | null>(null);
const mode = ref<"firebase" | "stub" | "anonymous">("anonymous");
const isReady = ref(false);
const isLoading = ref(false);
const errorMessage = ref("");
const sessionVersion = ref(0);

function setAnonymousState(): void {
  authSession.value = null;
  appSession.value = null;
  mode.value = "anonymous";
}

async function refreshSession(): Promise<MeResponse | null> {
  isLoading.value = true;

  try {
    const session = await restoreFrontendAuthSession();

    if (!session) {
      setAnonymousState();
      errorMessage.value = "";
      return null;
    }

    authSession.value = session.authSession;
    appSession.value = session.appSession;
    mode.value = session.mode;
    errorMessage.value = "";
    return session.appSession;
  } catch (error) {
    setAnonymousState();
    errorMessage.value = error instanceof Error ? error.message : "Unable to restore session.";
    return null;
  } finally {
    sessionVersion.value += 1;
    isLoading.value = false;
    isReady.value = true;
  }
}

async function login(input: {
  email: string;
  password: string;
}): Promise<MeResponse | null> {
  isLoading.value = true;

  try {
    const session = await loginWithEmailPassword(input.email, input.password);
    authSession.value = session.authSession;
    appSession.value = session.appSession;
    mode.value = session.mode;
    errorMessage.value = "";
    sessionVersion.value += 1;
    return session.appSession;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to log in.";
    throw error;
  } finally {
    isLoading.value = false;
    isReady.value = true;
  }
}

async function signup(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<MeResponse | null> {
  isLoading.value = true;

  try {
    const session = await signupWithEmailPassword(
      input.email,
      input.password,
      input.displayName,
    );
    authSession.value = session.authSession;
    appSession.value = session.appSession;
    mode.value = session.mode;
    errorMessage.value = "";
    sessionVersion.value += 1;
    return session.appSession;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to create account.";
    throw error;
  } finally {
    isLoading.value = false;
    isReady.value = true;
  }
}

async function logout(): Promise<void> {
  await logoutFrontendSession();
  setAnonymousState();
  errorMessage.value = "";
  sessionVersion.value += 1;
}

provide(AuthContextKey, {
  authSession,
  appSession,
  mode,
  isReady,
  isLoading,
  errorMessage,
  sessionVersion,
  refreshSession,
  login,
  signup,
  logout,
});

onMounted(async () => {
  await refreshSession();
});
</script>

<template>
  <slot />
</template>
