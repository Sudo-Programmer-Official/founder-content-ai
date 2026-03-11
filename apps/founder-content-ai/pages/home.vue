<template>
  <main class="page-shell">
    <section class="hero">
      <p class="eyebrow">Founder Personal Branding OS</p>
      <h1>Turn your founder journey into content.</h1>
      <p class="description">
        FounderContent AI helps startup founders move from idea to hook to LinkedIn post without
        staring at a blank page.
      </p>

      <div class="cta-row">
        <router-link class="primary-cta" to="/founder-content-ideas">
          Start With Ideas
        </router-link>
        <router-link class="secondary-cta" to="/linkedin-post-generator">
          Generate a Post
        </router-link>
      </div>
    </section>

    <section class="feature-grid">
      <router-link class="card" to="/founder-content-ideas">
        <p class="card-eyebrow">Step 1</p>
        <h2>Founder Content Ideas</h2>
        <p>Generate founder-specific posting angles based on your industry and startup stage.</p>
      </router-link>

      <router-link class="card" to="/linkedin-hook-generator">
        <p class="card-eyebrow">Step 2</p>
        <h2>LinkedIn Hook Generator</h2>
        <p>Create stronger opening lines that make founder posts easier to read.</p>
      </router-link>

      <router-link class="card" to="/linkedin-post-generator">
        <p class="card-eyebrow">Step 3</p>
        <h2>LinkedIn Post Generator</h2>
        <p>Generate story, lesson, and build-in-public post variations from one topic.</p>
      </router-link>
    </section>

    <section class="seo-card">
      <p class="card-eyebrow">SEO Entry Page</p>
      <h2>LinkedIn Post Ideas for Founders</h2>
      <p>
        The first SEO page is also available in the app and routes visitors into the MVP workflow.
      </p>
      <router-link class="text-link" to="/linkedin-post-ideas-for-founders">
        Open the SEO page
      </router-link>
    </section>
  </main>
</template>

<style scoped>
.page-shell {
  margin: 0 auto;
  max-width: 1100px;
  padding: 56px 24px 80px;
}

.hero {
  margin-bottom: 40px;
}

.eyebrow,
.card-eyebrow {
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
  max-width: 760px;
  font-size: clamp(2.5rem, 6vw, 4.5rem);
  line-height: 0.98;
}

.description {
  max-width: 720px;
  margin-top: 16px;
  color: #57534e;
  font-size: 1.05rem;
  line-height: 1.7;
}

.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 24px;
}

.primary-cta,
.secondary-cta,
.text-link {
  text-decoration: none;
}

.primary-cta {
  padding: 12px 18px;
  border-radius: 999px;
  background: #1c1917;
  color: #fafaf9;
}

.secondary-cta {
  padding: 12px 18px;
  border: 1px solid #d6d3d1;
  border-radius: 999px;
  color: #1c1917;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 18px;
  margin-bottom: 24px;
}

.card,
.seo-card {
  padding: 24px;
  border: 1px solid #e7e5e4;
  border-radius: 24px;
  background: linear-gradient(180deg, #fffdf8 0%, #fafaf9 100%);
}

.card {
  color: inherit;
  text-decoration: none;
}

.card p,
.seo-card p {
  color: #57534e;
  line-height: 1.6;
}

.text-link {
  color: #1c1917;
  font-weight: 600;
}
</style>
