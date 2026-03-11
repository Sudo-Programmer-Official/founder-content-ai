<script setup lang="ts">
interface InputField {
  label: string;
  example: string;
}

interface OutputItem {
  label: string;
  description: string;
}

defineProps<{
  title: string;
  route: string;
  goal: string;
  description: string;
  inputFields: InputField[];
  outputItems: OutputItem[];
  nextStep: string;
}>();
</script>

<template>
  <main class="page-shell">
    <header class="hero">
      <p class="eyebrow">{{ route }}</p>
      <h1>{{ title }}</h1>
      <p class="description">{{ description }}</p>
      <p class="goal"><strong>Page goal:</strong> {{ goal }}</p>
    </header>

    <section class="section-grid">
      <section class="card">
        <h2>Input Structure</h2>
        <ul>
          <li v-for="field in inputFields" :key="field.label">
            <strong>{{ field.label }}</strong>
            <span>{{ field.example }}</span>
          </li>
        </ul>
      </section>

      <section class="card">
        <h2>Output Structure</h2>
        <ul>
          <li v-for="item in outputItems" :key="item.label">
            <strong>{{ item.label }}</strong>
            <span>{{ item.description }}</span>
          </li>
        </ul>
      </section>
    </section>

    <section class="card">
      <h2>Placeholder Notes</h2>
      <p>
        This page is scaffolding only. Form handling, validation, API requests, and result rendering
        will be implemented in the next phase.
      </p>
      <p><strong>Next workflow step:</strong> {{ nextStep }}</p>
    </section>
  </main>
</template>

<style scoped>
.page-shell {
  margin: 0 auto;
  max-width: 960px;
  padding: 48px 24px 72px;
  color: #1c1917;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.hero {
  margin-bottom: 24px;
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
  color: #1c1917;
}

h1 {
  font-size: 2.4rem;
  line-height: 1.1;
}

.description,
.goal {
  max-width: 720px;
  color: #44403c;
  line-height: 1.6;
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  margin: 24px 0;
}

.card {
  padding: 24px;
  border: 1px solid #e7e5e4;
  border-radius: 20px;
  background: #fafaf9;
}

ul {
  padding: 0;
  margin: 16px 0 0;
  list-style: none;
}

li + li {
  margin-top: 14px;
}

strong,
span {
  display: block;
}

span {
  margin-top: 4px;
  color: #57534e;
}
</style>
