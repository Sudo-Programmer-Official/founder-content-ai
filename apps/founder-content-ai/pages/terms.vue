<script setup lang="ts">
const sections = [
  {
    title: "Use of the service",
    points: [
      "Founder Content provides AI-assisted content generation, media handling, scheduling, and social publishing tools for authorized users and workspaces.",
      "You are responsible for the prompts, uploads, published content, connected accounts, and actions taken through your workspace.",
      "You must use the service lawfully and in a way that does not infringe third-party rights or platform rules.",
    ],
  },
  {
    title: "Accounts and workspaces",
    points: [
      "You must provide accurate account information and keep your login credentials secure.",
      "Workspace owners are responsible for who has access to the workspace and which social accounts are connected.",
      "We may suspend or revoke access where required for abuse prevention, platform compliance, payment failure, or security reasons.",
    ],
  },
  {
    title: "Connected platforms",
    points: [
      "If you connect LinkedIn, Facebook, or Instagram, you authorize Founder Content to store the tokens and metadata needed to perform the publishing actions you request.",
      "Your use of connected platforms remains subject to those platforms’ own terms, policies, and API restrictions.",
      "We are not responsible for platform outages, policy changes, permission revocations, or rejected posts by third-party services.",
    ],
  },
  {
    title: "Billing and plan limits",
    points: [
      "Paid features, usage limits, and billing rules are governed by the active plan associated with your workspace.",
      "If payment fails or a plan changes, access to paid capabilities may be limited or suspended until billing is resolved.",
    ],
  },
  {
    title: "Intellectual property and content",
    points: [
      "You retain responsibility for the content you submit, generate, edit, upload, or publish through Founder Content.",
      "Founder Content retains ownership of the software, product design, and service implementation.",
      "You may not copy, resell, reverse engineer, or misuse the service outside the scope permitted by law and your subscription.",
    ],
  },
  {
    title: "Service availability and liability",
    points: [
      "Founder Content is provided on an as-is and as-available basis.",
      "We do not guarantee uninterrupted service, error-free outputs, or platform acceptance of generated or scheduled content.",
      "To the maximum extent permitted by law, Founder Content is not liable for indirect, incidental, special, consequential, or platform-related losses.",
    ],
  },
  {
    title: "Changes and contact",
    points: [
      "We may update these terms from time to time. Continued use of the service after an update means you accept the revised terms.",
      "Questions about these terms can be sent to hello@foundercontent.ai.",
    ],
  },
] as const;
</script>

<template>
  <main class="page-shell legal-shell">
    <section class="legal-hero">
      <p class="legal-eyebrow">Terms of Service</p>
      <h1>These terms govern use of Founder Content and its connected publishing workflows.</h1>
      <p class="legal-summary">
        By using Founder Content, you agree to these terms for account access, workspace usage, billing, and connected platform publishing.
      </p>
      <p class="legal-updated">Last updated: April 2, 2026</p>
    </section>

    <section v-for="section in sections" :key="section.title" class="legal-section">
      <h2>{{ section.title }}</h2>
      <ul>
        <li v-for="point in section.points" :key="point">{{ point }}</li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.legal-shell {
  display: grid;
  gap: 20px;
  width: min(980px, calc(100% - 40px));
  padding-top: 40px;
}

.legal-hero,
.legal-section {
  border: 1px solid rgba(112, 84, 62, 0.14);
  border-radius: 28px;
  background: rgba(255, 250, 245, 0.84);
  box-shadow: 0 24px 70px rgba(68, 44, 20, 0.08);
  backdrop-filter: blur(18px);
}

.legal-hero {
  padding: 34px;
}

.legal-section {
  padding: 28px 30px;
}

.legal-eyebrow,
.legal-updated {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9b5d34;
}

.legal-updated {
  margin-top: 20px;
  letter-spacing: 0.08em;
}

h1,
h2 {
  margin: 0;
  color: #1f1814;
  font-family: "Fraunces", "Iowan Old Style", "Palatino Linotype", serif;
}

h1 {
  margin-top: 16px;
  max-width: 16ch;
  font-size: clamp(2.6rem, 5vw, 4.1rem);
  line-height: 0.98;
}

h2 {
  font-size: 1.45rem;
}

.legal-summary,
ul {
  color: #5b4f47;
  line-height: 1.75;
}

.legal-summary {
  max-width: 64ch;
  margin: 16px 0 0;
}

ul {
  margin: 16px 0 0;
  padding-left: 1.2rem;
}

li + li {
  margin-top: 10px;
}

@media (max-width: 640px) {
  .legal-shell {
    width: min(100%, calc(100% - 24px));
    padding-top: 24px;
  }

  .legal-hero,
  .legal-section {
    padding: 22px 20px;
    border-radius: 22px;
  }
}
</style>
