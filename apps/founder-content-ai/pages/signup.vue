<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthContext } from "../auth/auth-context";
import { isEmailAlreadyInUseError } from "../services/firebase-auth-client";
import { appRoutes } from "../utils/routes";

const router = useRouter();
const auth = useAuthContext();

const displayName = ref("");
const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const pageError = ref("");
const showLoginInstead = ref(false);

async function handleSignup(): Promise<void> {
  pageError.value = "";
  showLoginInstead.value = false;

  if (!email.value.trim() || !password.value) {
    pageError.value = "Enter your email and password.";
    return;
  }

  if (password.value.length < 6) {
    pageError.value = "Password must be at least 6 characters.";
    return;
  }

  if (password.value !== confirmPassword.value) {
    pageError.value = "Passwords do not match.";
    return;
  }

  try {
    await auth.signup({
      email: email.value.trim(),
      password: password.value,
      displayName: displayName.value.trim() || undefined,
    });
    await router.replace(appRoutes.onboardingWorkspace);
  } catch (error) {
    showLoginInstead.value = isEmailAlreadyInUseError(error);
    pageError.value = error instanceof Error ? error.message : "Unable to create account.";
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card">
      <p class="auth-eyebrow">/signup</p>
      <h1>Create an account and land on value first.</h1>
      <p class="auth-copy">
        This flow signs you in, creates your first workspace, and only then opens the rest of the
        app.
      </p>

      <form class="auth-form" @submit.prevent="handleSignup">
        <label class="auth-field">
          <span>Name</span>
          <input
            v-model="displayName"
            type="text"
            autocomplete="name"
            placeholder="Your name"
          />
        </label>

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
            autocomplete="new-password"
            placeholder="At least 6 characters"
          />
        </label>

        <label class="auth-field">
          <span>Confirm password</span>
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            placeholder="Repeat your password"
          />
        </label>

        <p v-if="pageError || auth.errorMessage.value" class="auth-error">
          {{ pageError || auth.errorMessage.value }}
        </p>

        <p v-if="showLoginInstead" class="auth-helper">
          Already have an account?
          <router-link
            :to="{ path: appRoutes.login, query: email.trim() ? { email: email.trim() } : {} }"
          >
            Log in instead
          </router-link>
        </p>

        <button class="auth-primary" type="submit" :disabled="auth.isLoading.value">
          {{ auth.isLoading.value ? "Creating account..." : "Create account" }}
        </button>
      </form>

      <p class="auth-footer">
        Already have access?
        <router-link :to="appRoutes.login">Log in</router-link>
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
  width: min(100%, 560px);
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

.auth-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.auth-primary:disabled {
  cursor: wait;
  opacity: 0.7;
}

.auth-error {
  margin: 0;
  color: var(--fc-danger-text, #a33f2f);
  font-size: 0.92rem;
  font-weight: 600;
}

.auth-helper {
  margin: -4px 0 0;
  color: var(--fc-text-muted);
  font-size: 0.92rem;
}

.auth-helper a {
  color: var(--fc-text);
  font-weight: 700;
  text-decoration: none;
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
