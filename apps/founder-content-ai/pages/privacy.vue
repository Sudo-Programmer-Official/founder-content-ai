<script setup lang="ts">
const sections = [
  {
    title: "What we collect",
    points: [
      "Account details such as your name, email address, authentication identifiers, and workspace membership.",
      "Content inputs and outputs, including prompts, drafts, generated posts, uploaded media, scheduled posts, and saved sources.",
      "Connected platform metadata needed to publish on your behalf, such as LinkedIn or Meta account identifiers and encrypted access tokens.",
      "Operational data such as usage events, billing state, delivery outcomes, and security logs.",
    ],
  },
  {
    title: "How we use information",
    points: [
      "To provide content generation, scheduling, publishing, workspace collaboration, billing, and support.",
      "To improve reliability, prevent abuse, investigate failures, and maintain account security.",
      "To process platform actions you explicitly request, such as connecting a page, publishing a post, or disconnecting an account.",
    ],
  },
  {
    title: "Third-party services",
    points: [
      "Founder Content relies on third-party providers for infrastructure and product functionality, including authentication, storage, billing, AI generation, and social platform publishing.",
      "When you connect LinkedIn, Facebook, or Instagram, we store only the metadata and tokens needed to maintain that connection and perform the actions you approve.",
      "Third-party providers process data under their own terms and privacy policies.",
    ],
  },
  {
    title: "Retention and deletion",
    points: [
      "We retain data for as long as it is needed to operate your workspace, comply with legal obligations, resolve disputes, and maintain security records.",
      "You can request deletion of platform connections, workspace content, or your full account by following the instructions on the data deletion page.",
      "Some information may be retained where required for billing, fraud prevention, legal compliance, or audit purposes.",
    ],
  },
  {
    title: "Contact",
    points: [
      "For privacy questions or requests, contact hello@foundercontent.ai.",
    ],
  },
] as const;
</script>

<template>
  <main class="page-shell legal-shell">
    <section class="legal-hero">
      <p class="legal-eyebrow">Privacy Policy</p>
      <h1>How Founder Content handles workspace, publishing, and account data.</h1>
      <p class="legal-summary">
        This policy explains what Founder Content collects, why it is used, and how deletion requests are handled.
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
  max-width: 14ch;
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
