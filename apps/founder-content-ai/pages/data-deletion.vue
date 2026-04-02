<template>
  <main class="page-shell legal-shell">
    <section class="legal-hero">
      <p class="legal-eyebrow">Data Deletion</p>
      <h1>How to request deletion of your Founder Content account, workspace data, or connected platform data.</h1>
      <p class="legal-summary">
        Founder Content handles deletion requests manually right now so we can verify scope and prevent accidental deletion of the wrong workspace or connected account.
      </p>
      <p class="legal-updated">Last updated: April 2, 2026</p>
    </section>

    <section class="legal-section">
      <h2>How to submit a deletion request</h2>
      <ol>
        <li>Email <a href="mailto:hello@foundercontent.ai">hello@foundercontent.ai</a> from the account you use in Founder Content.</li>
        <li>Use the subject line <strong>Data Deletion Request</strong>.</li>
        <li>Include your account email, workspace name, and what you want deleted.</li>
      </ol>
    </section>

    <section class="legal-section">
      <h2>Deletion scope options</h2>
      <ul>
        <li><strong>Social connection only:</strong> remove a connected LinkedIn, Facebook, or Instagram publishing account.</li>
        <li><strong>Workspace content:</strong> remove drafts, generated content, uploaded media, scheduled posts, and publishing history for a workspace.</li>
        <li><strong>Full account deletion:</strong> remove your Founder Content account and associated workspace access, subject to any legal or billing retention requirements.</li>
      </ul>
    </section>

    <section class="legal-section">
      <h2>What happens after you request deletion</h2>
      <ul>
        <li>We verify that the request came from an authorized account owner or workspace owner.</li>
        <li>We confirm the exact deletion scope before processing destructive changes.</li>
        <li>We aim to complete deletion requests within 30 days.</li>
      </ul>
    </section>

    <section class="legal-section">
      <h2>Retention exceptions</h2>
      <ul>
        <li>Some records may be retained where required for fraud prevention, legal compliance, dispute resolution, billing, or security logging.</li>
        <li>Removing a social connection in Founder Content does not remove your underlying Facebook, Instagram, or LinkedIn account from those platforms.</li>
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
ul,
ol {
  color: #5b4f47;
  line-height: 1.75;
}

.legal-summary {
  max-width: 64ch;
  margin: 16px 0 0;
}

ul,
ol {
  margin: 16px 0 0;
  padding-left: 1.2rem;
}

li + li {
  margin-top: 10px;
}

a {
  color: #b94b24;
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
