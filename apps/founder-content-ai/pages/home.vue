<script setup lang="ts">
import { appRoutes } from "../utils/routes";

const steps = [
  {
    title: "Capture real inputs",
    description:
      "Drop in a screenshot, rough note, pasted text, or saved idea instead of staring at a blank page.",
  },
  {
    title: "Shape the message",
    description:
      "Turn raw input into attention-grabbing hooks and platform-ready posts that still sound like you.",
  },
  {
    title: "Build consistency",
    description:
      "Use scheduling and multi-platform publishing to keep showing up without burning time or relying on last-minute inspiration.",
  },
];

const useCases = [
  {
    title: "For founders",
    description: "Build a personal brand from real lessons, startup pain, wins, and operator insight.",
  },
  {
    title: "For businesses",
    description: "Stay visible across LinkedIn, Instagram, and Facebook without building a full internal content team.",
  },
  {
    title: "For marketers",
    description: "Scale content production from founder notes, customer language, and saved references, then distribute it without extra handoff.",
  },
  {
    title: "For creators",
    description: "Never run out of starting points when you already have screenshots, tweets, and ideas saved.",
  },
];

const features = [
  {
    title: "Capture",
    description: "Start with text or screenshot-based raw input and skip the blank page completely.",
  },
  {
    title: "Remix",
    description: "Take inspiration from saved references and turn them into original founder-style content built for multiple channels.",
  },
  {
    title: "Idea Vault",
    description: "Turn scattered notes and unfinished thoughts into a repeatable content workflow.",
  },
  {
    title: "Publish anywhere",
    description: "Post instantly or schedule across LinkedIn, Instagram, and Facebook from one place.",
  },
  {
    title: "Planning cues",
    description: "See the next best post, timing suggestions, and queue prompts that help you stay consistent instead of reactive.",
  },
];

const publishFlow = [
  {
    title: "Capture",
    description: "Note, screenshot, or raw idea.",
  },
  {
    title: "Generate",
    description: "Hooks, post copy, and media-ready direction.",
  },
  {
    title: "Publish",
    description: "Send it to LinkedIn, Instagram, and Facebook.",
  },
  {
    title: "Schedule",
    description: "Lock the next slot and keep momentum going.",
  },
];

const pricingPlans = [
  {
    name: "Free",
    price: "$0",
    cadence: "/month",
    badge: "Try the system",
    description: "Validate your content workflow before you pay for momentum.",
    points: ["2 posts per day", "1 scheduled post at a time", "Try the full content system"],
    ctaLabel: "Create your first post",
    ctaTo: appRoutes.signup,
    featured: false,
  },
  {
    name: "Starter",
    price: "$9",
    cadence: "/month",
    badge: "Build momentum",
    description: "Post consistently without burning out or rebuilding the workflow every day.",
    points: ["5 posts per day", "Unlimited scheduling queue", "Plan your week ahead"],
    ctaLabel: "Choose Starter",
    ctaTo: appRoutes.signup,
    featured: true,
  },
  {
    name: "Pro",
    price: "$19",
    cadence: "/month",
    badge: "Scale the engine",
    description: "Run content like a system with more leverage, more headroom, and priority execution.",
    points: ["Unlimited posting rhythm", "Advanced scheduling windows", "Priority execution and growth workflow"],
    ctaLabel: "Go Pro",
    ctaTo: appRoutes.signup,
    featured: false,
  },
];
</script>

<template>
  <main class="landing-shell">
    <section class="hero-section">
      <div class="hero-copy">
        <p class="eyebrow">Consistency engine for founders and lean teams</p>
        <h1>Turn ideas into content you can publish across LinkedIn, Instagram, and Facebook.</h1>
        <p class="hero-description">
          Capture a thought, turn it into a post, schedule it, and stay visible without burning out.
          Founder Content is built for consistency, not one-off drafts.
        </p>

        <div class="cta-row">
          <router-link class="primary-cta" :to="appRoutes.signup">
            Create your first post → publish it in minutes
          </router-link>
          <a class="secondary-cta" href="/#demo">See how it works</a>
        </div>

        <p class="hero-loop">Capture → Generate → Schedule → Publish everywhere.</p>
        <p class="hero-hook">Most people do not fail at content because they lack ideas. They fail because they do not publish consistently.</p>
      </div>

      <div class="hero-visual">
        <article class="preview-card preview-output featured-output">
          <p class="panel-label">Generated Output</p>
          <h2>Building a startup is lonelier than people admit.</h2>
          <p>
            No one warns you how quiet the hard seasons can get when your team looks to you for certainty.
          </p>
          <div class="output-stack">
            <span>3 hooks</span>
            <span>1 post</span>
            <span>LinkedIn</span>
            <span>Instagram + Facebook</span>
          </div>
        </article>

        <article class="proof-card">
          <p class="panel-label">Ready to ship</p>
          <ul class="proof-points">
            <li>Clear hook with tension</li>
            <li>Founder-native tone that still adapts across channels</li>
            <li>Ready to publish now or schedule for the next window</li>
          </ul>
          <router-link class="proof-link" :to="appRoutes.signup">Create a post and ship it</router-link>
        </article>
      </div>
    </section>

    <section class="content-section publish-bridge-section">
      <div class="section-header">
        <p class="eyebrow">From idea to published post in minutes</p>
        <h2>Go from raw thought to scheduled multi-platform content without breaking the flow.</h2>
        <p class="section-description">
          Founder Content wins when the idea becomes something real fast: captured, shaped, published, and queued for the next slot.
        </p>
      </div>

      <div class="publish-flow-grid">
        <article v-for="(step, index) in publishFlow" :key="step.title" class="publish-flow-card">
          <span class="publish-flow-index">0{{ index + 1 }}</span>
          <strong>{{ step.title }}</strong>
          <p>{{ step.description }}</p>
        </article>
      </div>
    </section>

    <section id="demo" class="content-section">
      <p class="conversion-line">
        Most people do not fail at content because they lack ideas. They fail because they do not publish consistently.
      </p>
      <div class="section-header">
        <p class="eyebrow">Demo</p>
        <h2>Show the transformation instantly.</h2>
        <p class="section-description">
          People usually do not struggle to write. They struggle to start and to stay consistent.
          The landing page should prove that one input can become a publishable post fast, then feed a workflow worth repeating.
        </p>
      </div>

      <div class="demo-grid">
        <article class="demo-card demo-input-card">
          <p class="panel-label">Input</p>
          <h3>“Nobody talks about how lonely startups are”</h3>
          <p>
            A saved line from a note, screenshot, or half-formed founder thought.
          </p>
        </article>

        <article class="demo-card demo-output-card">
          <p class="panel-label">Output</p>
          <div class="demo-block">
            <span class="demo-label">Hook</span>
            <p>Building a startup is lonelier than people admit.</p>
          </div>
          <div class="demo-block">
            <span class="demo-label">Post</span>
            <p>
              Nobody tells you how isolating this journey can be. Not because you are alone, but
              because you cannot share every fear, every risk, or every hard call in real time.
            </p>
          </div>
          <div class="demo-block">
            <span class="demo-label">Next</span>
            <p>This post is ready to publish instantly or schedule across LinkedIn, Instagram, and Facebook.</p>
          </div>
        </article>
      </div>
    </section>

    <section id="how-it-works" class="content-section">
      <div class="section-header">
        <p class="eyebrow">How It Works</p>
        <h2>One workflow that turns capture into consistency.</h2>
      </div>

      <div class="steps-grid">
        <article v-for="(step, index) in steps" :key="step.title" class="info-card step-card">
          <p class="step-number">0{{ index + 1 }}</p>
          <h3>{{ step.title }}</h3>
          <p>{{ step.description }}</p>
        </article>
      </div>
    </section>

    <section class="content-section">
      <div class="section-header">
        <p class="eyebrow">Use Cases</p>
        <h2>Built for the people who need to show up every week.</h2>
      </div>

      <div class="info-grid">
        <article v-for="useCase in useCases" :key="useCase.title" class="info-card">
          <h3>{{ useCase.title }}</h3>
          <p>{{ useCase.description }}</p>
        </article>
      </div>
    </section>

    <section class="content-section">
      <div class="section-header">
        <p class="eyebrow">Features</p>
        <h2>Generate once. Publish everywhere.</h2>
        <p class="section-description">
          This product wins by helping people start faster, shape stronger messages, and keep a publishing rhythm they can actually maintain.
        </p>
      </div>

      <div class="info-grid">
        <article v-for="feature in features" :key="feature.title" class="info-card feature-card">
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.description }}</p>
        </article>
      </div>
    </section>

    <section id="pricing" class="content-section pricing-section">
      <div class="section-header">
        <p class="eyebrow">Pricing</p>
        <h2>Pricing built around consistency, not feature bloat.</h2>
        <p class="section-description">
          Start by validating the workflow, then unlock the weekly planning system as your posting habit takes hold. The goal is not more posts. It is consistent, high-performing content that compounds.
        </p>
      </div>

      <div class="pricing-grid">
        <article
          v-for="plan in pricingPlans"
          :key="plan.name"
          class="pricing-card"
          :class="{ featured: plan.featured }"
        >
          <p class="plan-badge">{{ plan.badge }}</p>
          <h3>{{ plan.name }}</h3>
          <p class="plan-price">
            <span>{{ plan.price }}</span>{{ plan.cadence }}
          </p>
          <p class="plan-description">{{ plan.description }}</p>

          <ul class="plan-points">
            <li v-for="point in plan.points" :key="point">{{ point }}</li>
          </ul>

          <router-link class="plan-cta" :to="plan.ctaTo">
            {{ plan.ctaLabel }}
          </router-link>
        </article>
      </div>
    </section>

    <section class="final-cta">
      <p class="eyebrow">Final CTA</p>
      <h2>Build a content system you can actually keep and publish everywhere.</h2>
      <p>
        Turn ideas into posts and distribute them across platforms without losing momentum.
        Capture once, generate faster, and stay visible without rebuilding the system every day.
      </p>
      <div class="cta-row">
        <router-link class="primary-cta" :to="appRoutes.signup">
          Create your first post → publish it in minutes
        </router-link>
        <a class="secondary-cta" href="/#pricing">See pricing</a>
      </div>
    </section>

    <footer class="site-footer">
      <p>Founder Content helps teams generate, organize, and distribute content without mixing workspace data.</p>
      <div class="footer-links">
        <router-link :to="appRoutes.privacy">Privacy</router-link>
        <router-link :to="appRoutes.terms">Terms</router-link>
        <router-link :to="appRoutes.dataDeletion">Data deletion</router-link>
      </div>
    </footer>
  </main>
</template>

<style scoped>
.landing-shell {
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
  padding: 40px 0 88px;
}

.hero-section {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 28px;
  align-items: stretch;
  margin-bottom: 28px;
}

.hero-copy,
.content-section,
.final-cta,
.site-footer {
  border: 1px solid rgba(112, 84, 62, 0.14);
  border-radius: 32px;
  background: rgba(255, 250, 245, 0.82);
  box-shadow: 0 24px 70px rgba(68, 44, 20, 0.08);
  backdrop-filter: blur(18px);
}

.hero-copy {
  padding: 40px;
  position: relative;
  overflow: hidden;
}

.site-footer {
  margin-top: 28px;
  padding: 24px 28px;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.site-footer p {
  margin: 0;
  max-width: 54ch;
  color: #5b4f47;
  line-height: 1.7;
}

.footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.footer-links a {
  color: #1f1814;
  text-decoration: none;
  font-weight: 700;
}

.footer-links a:hover {
  color: #b94b24;
}

.hero-copy::before {
  content: "";
  position: absolute;
  inset: auto -10% -30% auto;
  width: 240px;
  height: 240px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(222, 111, 52, 0.22) 0%, rgba(222, 111, 52, 0) 72%);
  pointer-events: none;
}

.eyebrow,
.panel-label,
.step-number,
.plan-badge,
.demo-label {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.eyebrow,
.panel-label,
.step-number,
.demo-label {
  color: #9b5d34;
}

h1,
h2,
h3 {
  margin: 0;
  color: #1f1814;
  font-family: "Fraunces", "Iowan Old Style", "Palatino Linotype", serif;
}

h1 {
  max-width: 11ch;
  font-size: clamp(3.2rem, 7vw, 5.5rem);
  line-height: 0.94;
  margin-top: 18px;
}

.hero-description,
.section-description,
.hero-hook,
.hero-loop,
.info-card p,
.demo-card p,
.final-cta p,
.plan-description {
  color: #5b4f47;
  line-height: 1.7;
}

.hero-description {
  max-width: 620px;
  margin-top: 18px;
  font-size: 1.07rem;
}

.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 28px;
}

.primary-cta,
.secondary-cta,
.plan-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  padding: 0 20px;
  border-radius: 999px;
  font-weight: 700;
  text-decoration: none;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    border-color 180ms ease,
    background 180ms ease;
}

.primary-cta,
.plan-cta {
  background: linear-gradient(135deg, #d76634 0%, #b94b24 100%);
  color: #fff8f3;
  box-shadow: 0 18px 38px rgba(185, 75, 36, 0.26);
}

.secondary-cta {
  border: 1px solid rgba(116, 86, 64, 0.22);
  color: #2d2521;
  background: rgba(255, 255, 255, 0.66);
}

.primary-cta:hover,
.secondary-cta:hover,
.plan-cta:hover {
  transform: translateY(-2px);
}

.hero-loop {
  margin-top: 22px;
  font-weight: 700;
  color: #24474d;
}

.hero-hook {
  margin-top: 10px;
  font-size: 0.98rem;
}

.hero-visual {
  display: grid;
  gap: 18px;
  align-content: center;
}

.preview-card,
.demo-card,
.info-card,
.pricing-card {
  border: 1px solid rgba(112, 84, 62, 0.14);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 251, 247, 0.96) 0%, rgba(250, 242, 236, 0.88) 100%);
  box-shadow: 0 20px 55px rgba(76, 49, 26, 0.1);
}

.preview-card {
  padding: 26px;
  animation: float-card 6.6s ease-in-out infinite;
}

.preview-output {
  animation-delay: 0.45s;
}

.featured-output {
  min-height: 320px;
}

.preview-card h2 {
  margin-top: 12px;
  font-size: 1.75rem;
  line-height: 1.05;
}

.preview-card p {
  margin: 12px 0 0;
  color: #5d5047;
  line-height: 1.7;
}

.chip-row,
.output-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.chip-row span,
.output-stack span {
  padding: 9px 12px;
  border-radius: 999px;
  background: rgba(36, 71, 77, 0.09);
  color: #24474d;
  font-size: 0.9rem;
  font-weight: 700;
}

.proof-card {
  border: 1px solid rgba(36, 71, 77, 0.12);
  border-radius: 28px;
  background: rgba(240, 251, 247, 0.84);
  box-shadow: 0 18px 44px rgba(28, 63, 59, 0.08);
  padding: 24px;
}

.proof-points {
  margin: 14px 0 0;
  padding-left: 18px;
  color: #355559;
  line-height: 1.9;
}

.proof-link {
  display: inline-flex;
  margin-top: 16px;
  color: #1d5357;
  font-weight: 700;
  text-decoration: none;
}

.content-section,
.final-cta {
  padding: 34px;
  margin-top: 24px;
}

.publish-bridge-section {
  background:
    linear-gradient(180deg, rgba(255, 245, 236, 0.94) 0%, rgba(255, 250, 245, 0.88) 100%);
}

.section-header {
  max-width: 760px;
}

.section-header h2,
.final-cta h2 {
  margin-top: 12px;
  font-size: clamp(2.1rem, 4vw, 3.4rem);
  line-height: 1;
}

.section-description {
  margin-top: 14px;
}

.demo-grid,
.steps-grid,
.info-grid,
.pricing-grid {
  display: grid;
  gap: 18px;
  margin-top: 24px;
}

.demo-grid {
  grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr);
}

.publish-flow-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-top: 26px;
}

.publish-flow-card {
  display: grid;
  gap: 10px;
  padding: 22px;
  border: 1px solid rgba(112, 84, 62, 0.14);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 16px 38px rgba(76, 49, 26, 0.06);
}

.publish-flow-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: rgba(215, 102, 52, 0.12);
  color: #9b5d34;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.publish-flow-card strong {
  font-size: 1.2rem;
  line-height: 1.1;
  color: #1f1814;
}

.publish-flow-card p {
  margin: 0;
  color: #5b4f47;
  line-height: 1.6;
}

.demo-card {
  padding: 28px;
}

.demo-card h3 {
  margin-top: 10px;
  font-size: 1.8rem;
  line-height: 1.08;
}

.demo-block + .demo-block {
  margin-top: 18px;
}

.demo-label {
  display: inline-block;
  margin-bottom: 8px;
}

.demo-input-card {
  background: linear-gradient(180deg, rgba(255, 236, 221, 0.96) 0%, rgba(252, 244, 237, 0.92) 100%);
}

.demo-output-card {
  background: linear-gradient(180deg, rgba(240, 251, 247, 0.96) 0%, rgba(248, 252, 250, 0.94) 100%);
}

.conversion-line {
  margin: 0 0 18px;
  color: #24474d;
  font-size: 1rem;
  font-weight: 800;
  line-height: 1.5;
}

.steps-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.info-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.info-card {
  padding: 26px;
}

.info-card h3 {
  margin-top: 10px;
  font-size: 1.5rem;
  line-height: 1.1;
}

.step-card {
  position: relative;
  overflow: hidden;
}

.step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: rgba(215, 102, 52, 0.12);
}

.pricing-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;
}

.pricing-card {
  display: flex;
  flex-direction: column;
  padding: 28px;
}

.pricing-card.featured {
  border-color: rgba(215, 102, 52, 0.4);
  background: linear-gradient(180deg, rgba(255, 243, 236, 0.98) 0%, rgba(255, 250, 245, 0.96) 100%);
  transform: translateY(-8px);
}

.plan-badge {
  color: #24474d;
}

.plan-price {
  margin: 18px 0 0;
  color: #5b4f47;
}

.plan-price span {
  color: #1f1814;
  font-size: 3rem;
  font-weight: 800;
}

.plan-description {
  margin-top: 12px;
}

.plan-points {
  padding-left: 20px;
  margin: 18px 0 0;
  color: #463c36;
  line-height: 1.8;
}

.plan-cta {
  margin-top: auto;
  align-self: flex-start;
}

.final-cta {
  text-align: center;
}

.final-cta p {
  max-width: 720px;
  margin: 14px auto 0;
}

.final-cta .cta-row {
  justify-content: center;
}

@keyframes float-card {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-8px);
  }
}

@media (max-width: 1080px) {
  .hero-section,
  .demo-grid,
  .pricing-grid {
    grid-template-columns: 1fr;
  }

  .publish-flow-grid,
  .steps-grid,
  .info-grid {
    grid-template-columns: 1fr 1fr;
  }

  .pricing-card.featured {
    transform: none;
  }
}

@media (max-width: 720px) {
  .landing-shell {
    width: min(100% - 24px, 1180px);
    padding-top: 20px;
    padding-bottom: 64px;
  }

  .hero-copy,
  .content-section,
  .final-cta,
  .preview-card,
  .demo-card,
  .info-card,
  .pricing-card,
  .publish-flow-card {
    padding: 22px;
  }

  .publish-flow-grid,
  .steps-grid,
  .info-grid {
    grid-template-columns: 1fr;
  }

  h1 {
    max-width: none;
    font-size: clamp(2.7rem, 13vw, 4rem);
  }

  .section-header h2,
  .final-cta h2 {
    font-size: clamp(2rem, 10vw, 2.8rem);
  }

  .plan-price span {
    font-size: 2.5rem;
  }
}
</style>
