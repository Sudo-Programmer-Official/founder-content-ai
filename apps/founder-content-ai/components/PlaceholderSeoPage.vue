<script setup lang="ts">
defineProps<{
  route: string;
  title: string;
  description: string;
  examples: string[];
  templates: string[];
  primaryCta: string;
  secondaryCta: string;
}>();
</script>

<template>
  <main class="page-shell">
    <header class="hero card">
      <p class="eyebrow">{{ route }}</p>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
      <div class="cta-row">
        <span class="cta-pill">Primary CTA: {{ primaryCta }}</span>
        <span class="cta-pill subtle">Secondary CTA: {{ secondaryCta }}</span>
      </div>
    </header>

    <section class="card">
      <h2>Quick Examples</h2>
      <ol>
        <li v-for="example in examples" :key="example">{{ example }}</li>
      </ol>
    </section>

    <section class="card">
      <h2>Templates</h2>
      <ul>
        <li v-for="template in templates" :key="template">{{ template }}</li>
      </ul>
    </section>

    <section class="card">
      <h2>Placeholder Notes</h2>
      <p>
        This SEO page is a static scaffold. Copy, metadata, FAQs, and conversion instrumentation will
        be implemented in a later phase.
      </p>
    </section>
  </main>
</template>

<style scoped>
.page-shell {
  margin: 0 auto;
  max-width: 960px;
  padding: 48px 24px 72px;
  color: #1c1917;
  font-family: Georgia, "Times New Roman", serif;
}

.card {
  margin-bottom: 20px;
  padding: 24px;
  border: 1px solid #e7e5e4;
  border-radius: 20px;
  background: linear-gradient(180deg, #fffdf8 0%, #fafaf9 100%);
}

.eyebrow {
  margin: 0 0 12px;
  color: #78716c;
  font-size: 0.875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1,
h2 {
  margin: 0;
}

h1 {
  font-size: 2.5rem;
  line-height: 1.1;
}

p,
li {
  color: #44403c;
  line-height: 1.6;
}

.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}

.cta-pill {
  padding: 10px 14px;
  border-radius: 999px;
  background: #1c1917;
  color: #fafaf9;
  font-size: 0.9rem;
}

.cta-pill.subtle {
  background: #e7e5e4;
  color: #292524;
}

ol,
ul {
  margin: 16px 0 0;
  padding-left: 22px;
}

li + li {
  margin-top: 10px;
}
</style>
