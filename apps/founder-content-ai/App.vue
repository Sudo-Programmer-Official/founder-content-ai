<template>
  <div class="app-shell">
    <header class="site-header">
      <router-link class="brand" to="/">FounderContent AI</router-link>

      <nav class="site-nav">
        <router-link to="/founder-content-ideas">Ideas</router-link>
        <router-link to="/linkedin-hook-generator">Hooks</router-link>
        <router-link to="/linkedin-post-generator">Posts</router-link>
        <router-link to="/linkedin-post-ideas-for-founders">SEO Page</router-link>
      </nav>
    </header>

    <router-view />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 24px;
  border-bottom: 1px solid #e7e5e4;
  background: rgba(250, 250, 249, 0.92);
  backdrop-filter: blur(12px);
}

.brand {
  color: #1c1917;
  font-size: 1.1rem;
  font-weight: 700;
  text-decoration: none;
}

.site-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.site-nav a {
  color: #57534e;
  text-decoration: none;
}

.site-nav a.router-link-active {
  color: #1c1917;
  font-weight: 600;
}
</style>
