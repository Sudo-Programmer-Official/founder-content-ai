<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthContext } from "../auth/auth-context";
import { canUseDevelopmentStubAuth } from "../services/auth-service";
import { appRoutes } from "../utils/routes";

const route = useRoute();
const router = useRouter();
const auth = useAuthContext();

const email = ref(typeof route.query.email === "string" ? route.query.email.trim() : "");
const password = ref("");
const rememberBrowser = ref(true);
const pageError = ref("");
const resetNotice = ref("");

const redirectTarget = computed(() => {
  const redirect = route.query.redirect;
  return typeof redirect === "string" && redirect.trim() ? redirect : appRoutes.appGenerate;
});

const canUseStub = canUseDevelopmentStubAuth();

async function handleLogin(): Promise<void> {
  pageError.value = "";
  resetNotice.value = "";

  if (!email.value.trim() || !password.value) {
    pageError.value = "Enter your email and password.";
    return;
  }

  try {
    await auth.login({
      email: email.value.trim(),
      password: password.value,
      rememberBrowser: rememberBrowser.value,
    });
    await router.replace(redirectTarget.value);
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "Unable to log in.";
  }
}

async function continueWithStub(): Promise<void> {
  await auth.refreshSession();
  await router.replace(redirectTarget.value);
}

async function handlePasswordReset(): Promise<void> {
  pageError.value = "";
  resetNotice.value = "";

  if (!email.value.trim()) {
    pageError.value = "Enter your email first and then request a reset link.";
    return;
  }

  try {
    await auth.requestPasswordReset(email.value.trim());
    resetNotice.value =
      "If an account exists for this email, we sent a password reset link.";
  } catch (error) {
    pageError.value =
      error instanceof Error ? error.message : "Unable to send password reset email.";
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card">
      <p class="auth-eyebrow">/login</p>
      <h1>Log in and get straight back to execution.</h1>
      <p class="auth-copy">
        If this account already has a workspace, you go straight back into it. If not, we’ll make
        you create one before opening the app.
      </p>

      <form class="auth-form" @submit.prevent="handleLogin">
        <label class="auth-field">
          <span>Email</span>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            placeholder="you@company.com"
          />
        </label>

        <label class="auth-field">
          <span>Password</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="Your password"
          />
        </label>

        <label class="remember-browser-toggle">
          <input v-model="rememberBrowser" type="checkbox" />
          <span>Remember this browser</span>
        </label>

        <div class="auth-helper-row">
          <button
            class="auth-link-button"
            type="button"
            :disabled="auth.isLoading.value"
            @click="handlePasswordReset"
          >
            Forgot password?
          </button>
        </div>

        <p v-if="pageError || auth.errorMessage.value" class="auth-error">
          {{ pageError || auth.errorMessage.value }}
        </p>

        <p v-if="resetNotice" class="auth-notice">
          {{ resetNotice }}
        </p>

        <button class="auth-primary" type="submit" :disabled="auth.isLoading.value">
          {{ auth.isLoading.value ? "Logging in..." : "Log in" }}
        </button>
      </form>

      <button
        v-if="canUseStub"
        class="auth-secondary"
        type="button"
        @click="continueWithStub"
      >
        Continue with local dev auth
      </button>

      <p class="auth-footer">
        New here?
        <router-link :to="appRoutes.signup">Create an account</router-link>
      </p>
    </section>
  </main>
</template>

<style scoped>
.auth-shell {
  display: grid;
  place-items: center;
  min-height: calc(100vh - 96px);
  padding: 48px 20px 72px;
}

.auth-card {
  width: min(100%, 540px);
  padding: clamp(28px, 4vw, 40px);
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--fc-surface) 0%, var(--fc-surface-subtle) 100%);
  box-shadow: var(--fc-card-shadow);
}

.auth-eyebrow {
  margin: 0 0 12px;
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.auth-card h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 2.8rem);
  line-height: 1.02;
}

.auth-copy {
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.auth-form {
  display: grid;
  gap: 16px;
  margin-top: 28px;
}

.auth-field {
  display: grid;
  gap: 8px;
}

.auth-field span {
  font-size: 0.9rem;
  font-weight: 700;
}

.auth-field input {
  min-height: 52px;
  padding: 0 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.remember-browser-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--fc-text);
  font-size: 0.95rem;
  font-weight: 600;
}

.remember-browser-toggle input {
  width: 18px;
  height: 18px;
  accent-color: var(--fc-accent);
}

.auth-primary,
.auth-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 999px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.auth-primary {
  border: none;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
}

.auth-primary:disabled {
  cursor: wait;
  opacity: 0.7;
}

.auth-secondary {
  width: 100%;
  margin-top: 12px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
  color: var(--fc-text);
}

.auth-error {
  margin: 0;
  color: var(--fc-danger-text, #a33f2f);
  font-size: 0.92rem;
  font-weight: 600;
}

.auth-notice {
  margin: 0;
  color: #2f6d52;
  font-size: 0.92rem;
  font-weight: 600;
}

.auth-helper-row {
  display: flex;
  justify-content: flex-end;
}

.auth-link-button {
  border: none;
  padding: 0;
  background: transparent;
  color: var(--fc-text);
  font: inherit;
  font-size: 0.92rem;
  font-weight: 700;
  cursor: pointer;
}

.auth-link-button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.auth-footer {
  margin: 18px 0 0;
  color: var(--fc-text-muted);
}

.auth-footer a {
  color: var(--fc-text);
  font-weight: 700;
  text-decoration: none;
}
</style>
