<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { PublicSocialProofPost, SocialPlatform } from "../../../packages/shared-types";
import { requestPublicSocialProof } from "../services/public-marketing-service";
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

const platformLabels: Record<string, string> = {
  linkedin: "in",
  facebook: "f",
  instagram: "ig",
};

const testimonials = [
  {
    name: "Aarav Mehta",
    role: "Founder, Product OS",
    quote:
      "This transformed my content game. Ideas to scheduled posts in 10 minutes max, without the daily scramble.",
    detail:
      "Founder Content made social media effortless. We consistently post now without overthinking it.",
    rating: 5,
    initials: "AM",
    avatarTone: "sunset",
    platforms: ["linkedin", "facebook", "instagram"],
    layout: "left",
  },
  {
    name: "Abhishek Jha",
    role: "Founder, Product OS",
    quote:
      "This transformed my content game. Ideas to scheduled posts in 10 minutes max, without the daily scramble.",
    detail:
      "Founder Content made social media effortless. We consistently post now without overthinking it.",
    rating: 5,
    initials: "AJ",
    avatarTone: "apricot",
    platforms: ["linkedin", "facebook", "instagram"],
    layout: "featured",
  },
  {
    name: "Michael Chen",
    role: "Growth Marketer",
    quote:
      "Going from sporadic to strategic with Founder Content was like getting a superpower. Absolutely game-changing.",
    detail:
      "We finally have a system that keeps our publishing calendar moving without the usual bottlenecks.",
    rating: 5,
    initials: "MC",
    avatarTone: "sky",
    platforms: ["linkedin", "facebook", "instagram"],
    layout: "right",
  },
];

const socialChannels = [
  {
    platform: "facebook",
    label: "Facebook",
    handle: "@Founder Content AI",
    href: "https://www.facebook.com/profile.php?id=61573634724875",
    accent: "Built in public",
  },
  {
    platform: "instagram",
    label: "Instagram",
    handle: "@foundercontentai",
    href: "https://www.instagram.com/foundercontentai/",
    accent: "Visual updates",
  },
  {
    platform: "linkedin",
    label: "LinkedIn",
    handle: "Founder Content AI",
    href: "https://www.linkedin.com/company/founder-content-ai/about/?viewAsMember=true",
    accent: "Founder-first insights",
  },
] as const;

const publishSignals = [
  {
    title: "Real inputs first",
    description: "Start from screenshots, rough notes, and founder thoughts instead of a blank page.",
  },
  {
    title: "Multi-platform ready",
    description: "Shape one idea into content built for LinkedIn, Instagram, and Facebook.",
  },
  {
    title: "Consistency by design",
    description: "Move the finished draft straight into the queue before momentum disappears.",
  },
];

const demoSignals = [
  "Raw founder thought in",
  "Clear hook and structure out",
  "Ready to publish or schedule",
];

const workflowReasons = [
  "Capture from the formats founders already use",
  "Generate founder-native copy without losing tone",
  "Keep the publishing queue moving week after week",
];

const pricingSignals = [
  "Start free",
  "Upgrade when the habit sticks",
  "Publish across three core channels",
];

const finalTrustPills = [
  "Real-input workflow",
  "Multi-platform publishing",
  "Built for founder consistency",
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

const socialProofPosts = ref<PublicSocialProofPost[]>([]);

function buildSocialProofRail(posts: PublicSocialProofPost[]): PublicSocialProofPost[] {
  if (posts.length === 0) {
    return [];
  }

  const baseRow: PublicSocialProofPost[] = [];

  while (baseRow.length < Math.max(posts.length, 6)) {
    baseRow.push(...posts);
  }

  const normalizedBaseRow = baseRow.slice(0, Math.max(posts.length, 6));
  return [...normalizedBaseRow, ...normalizedBaseRow];
}

const socialProofPrimaryRow = computed(() => {
  const midpoint = Math.ceil(socialProofPosts.value.length / 2);
  const primaryPosts = socialProofPosts.value.slice(0, midpoint);
  return buildSocialProofRail(primaryPosts.length > 0 ? primaryPosts : socialProofPosts.value);
});

const socialProofSecondaryRow = computed(() => {
  const midpoint = Math.ceil(socialProofPosts.value.length / 2);
  const secondaryPosts = socialProofPosts.value.slice(midpoint);
  const fallbackPosts = secondaryPosts.length > 0 ? secondaryPosts : [...socialProofPosts.value].reverse();
  return buildSocialProofRail(fallbackPosts);
});

function formatPlatformLabel(platform: SocialPlatform): string {
  if (platform === "linkedin") {
    return "LinkedIn";
  }

  if (platform === "facebook") {
    return "Facebook";
  }

  return "Instagram";
}

function formatPublishedAt(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function buildAvatarInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "FC";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function readWebsiteLabel(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/i, "");
  }
}

function formatMediaType(type: PublicSocialProofPost["mediaType"]): string {
  if (type === "carousel") {
    return "Carousel";
  }

  if (type === "image") {
    return "Image";
  }

  if (type === "video") {
    return "Video";
  }

  return "Post";
}

async function loadSocialProof(): Promise<void> {
  try {
    const response = await requestPublicSocialProof(12);
    socialProofPosts.value = response.posts;
  } catch (error) {
    console.warn("Unable to load public social proof.", error);
  }
}

onMounted(() => {
  void loadSocialProof();
});
</script>

<template>
  <main class="landing-shell">
    <section class="hero-section">
      <div class="hero-copy">
        <h1>Turn your ideas into content that grows your brand.</h1>
        <p class="hero-description">
          Capture topics, generate engaging posts, and schedule across LinkedIn, Instagram, and
          Facebook, all in one streamlined platform.
        </p>

        <div class="cta-row">
          <router-link class="primary-cta" :to="appRoutes.signup">Get started, it's free</router-link>
          <a class="secondary-cta" href="/#how-it-works">See how it works</a>
        </div>
      </div>
    </section>

    <section v-if="socialProofPosts.length > 0" class="content-section social-proof-section">
      <div class="section-header social-proof-header">
        <p class="eyebrow">Recently published</p>
        <h2>See real posts already live across LinkedIn, Facebook, and Instagram.</h2>
        <p class="section-description">
          Public posts from approved showcase workspaces, mirrored into a safe marketing feed and refreshed automatically.
        </p>
      </div>

      <div class="social-proof-stage">
        <div class="social-proof-fade social-proof-fade-left" aria-hidden="true"></div>
        <div class="social-proof-fade social-proof-fade-right" aria-hidden="true"></div>

        <div class="social-proof-rail">
          <div class="social-proof-track">
            <a
              v-for="(post, index) in socialProofPrimaryRow"
              :key="`${post.id}-primary-${index}`"
              class="social-proof-card"
              :class="`platform-${post.platform}`"
              :href="post.externalPostUrl"
              target="_blank"
              rel="noreferrer noopener"
            >
              <div class="social-proof-card-header">
                <span class="social-platform-pill">{{ formatPlatformLabel(post.platform) }}</span>
                <span class="social-proof-date">{{ formatPublishedAt(post.publishedAt) }}</span>
              </div>

              <div class="social-proof-profile">
                <img
                  v-if="post.authorAvatarUrl"
                  class="social-proof-avatar"
                  :src="post.authorAvatarUrl"
                  :alt="post.authorDisplayName"
                  loading="lazy"
                />
                <div v-else class="social-proof-avatar-fallback">
                  {{ buildAvatarInitials(post.authorDisplayName) }}
                </div>

                <div class="social-proof-meta">
                  <strong>{{ post.authorDisplayName }}</strong>
                  <span>
                    {{ post.workspaceBrandName }}
                    <template v-if="readWebsiteLabel(post.workspaceWebsiteUrl)">
                      · {{ readWebsiteLabel(post.workspaceWebsiteUrl) }}
                    </template>
                  </span>
                </div>
              </div>

              <div v-if="post.thumbnailUrl" class="social-proof-media">
                <img
                  :src="post.thumbnailUrl"
                  :alt="`Preview from ${post.workspaceBrandName}`"
                  loading="lazy"
                />
                <span class="social-proof-media-tag">{{ formatMediaType(post.mediaType) }}</span>
              </div>

              <p class="social-proof-caption">{{ post.captionPreview }}</p>

              <div class="social-proof-footer">
                <span>Live on {{ formatPlatformLabel(post.platform) }}</span>
                <span class="social-proof-link">View post ↗</span>
              </div>
            </a>
          </div>
        </div>

        <div class="social-proof-rail">
          <div class="social-proof-track reverse">
            <a
              v-for="(post, index) in socialProofSecondaryRow"
              :key="`${post.id}-secondary-${index}`"
              class="social-proof-card"
              :class="`platform-${post.platform}`"
              :href="post.externalPostUrl"
              target="_blank"
              rel="noreferrer noopener"
            >
              <div class="social-proof-card-header">
                <span class="social-platform-pill">{{ formatPlatformLabel(post.platform) }}</span>
                <span class="social-proof-date">{{ formatPublishedAt(post.publishedAt) }}</span>
              </div>

              <div class="social-proof-profile">
                <img
                  v-if="post.authorAvatarUrl"
                  class="social-proof-avatar"
                  :src="post.authorAvatarUrl"
                  :alt="post.authorDisplayName"
                  loading="lazy"
                />
                <div v-else class="social-proof-avatar-fallback">
                  {{ buildAvatarInitials(post.authorDisplayName) }}
                </div>

                <div class="social-proof-meta">
                  <strong>{{ post.authorDisplayName }}</strong>
                  <span>
                    {{ post.workspaceBrandName }}
                    <template v-if="readWebsiteLabel(post.workspaceWebsiteUrl)">
                      · {{ readWebsiteLabel(post.workspaceWebsiteUrl) }}
                    </template>
                  </span>
                </div>
              </div>

              <div v-if="post.thumbnailUrl" class="social-proof-media">
                <img
                  :src="post.thumbnailUrl"
                  :alt="`Preview from ${post.workspaceBrandName}`"
                  loading="lazy"
                />
                <span class="social-proof-media-tag">{{ formatMediaType(post.mediaType) }}</span>
              </div>

              <p class="social-proof-caption">{{ post.captionPreview }}</p>

              <div class="social-proof-footer">
                <span>Live on {{ formatPlatformLabel(post.platform) }}</span>
                <span class="social-proof-link">View post ↗</span>
              </div>
            </a>
          </div>
        </div>
      </div>
    </section>

    <section class="content-section social-links-section">
      <div class="social-links-copy">
        <p class="eyebrow">Official Channels</p>
        <h2>Follow Founder Content where founders already discover us.</h2>
        <p class="section-description">
          Explore the official product presence across LinkedIn, Instagram, and Facebook.
        </p>
      </div>

      <div class="social-links-grid">
        <a
          v-for="channel in socialChannels"
          :key="channel.platform"
          class="social-channel-card"
          :class="`social-channel-card-${channel.platform}`"
          :href="channel.href"
          target="_blank"
          rel="noreferrer noopener"
        >
          <span class="social-channel-icon-shell" aria-hidden="true">
            <svg v-if="channel.platform === 'linkedin'" class="social-channel-icon" viewBox="0 0 24 24" role="presentation">
              <path
                d="M6.78 8.7H3.56V19h3.22V8.7Zm-1.61-1.4c1.03 0 1.68-.73 1.68-1.64-.02-.93-.65-1.64-1.66-1.64s-1.7.71-1.7 1.64c0 .91.67 1.64 1.66 1.64h.02Zm3.4 11.7h3.22v-5.75c0-.3.02-.6.11-.82.24-.6.79-1.23 1.71-1.23 1.21 0 1.69.94 1.69 2.31V19h3.22v-5.88c0-3.15-1.68-4.62-3.93-4.62-1.82 0-2.62 1.01-3.06 1.72h.02V8.7H8.57c.04.97 0 10.3 0 10.3Z"
                fill="currentColor"
              />
            </svg>
            <svg v-else-if="channel.platform === 'instagram'" class="social-channel-icon" viewBox="0 0 24 24" role="presentation">
              <path
                d="M7.75 3h8.5A4.75 4.75 0 0 1 21 7.75v8.5A4.75 4.75 0 0 1 16.25 21h-8.5A4.75 4.75 0 0 1 3 16.25v-8.5A4.75 4.75 0 0 1 7.75 3Zm0 1.5A3.25 3.25 0 0 0 4.5 7.75v8.5a3.25 3.25 0 0 0 3.25 3.25h8.5a3.25 3.25 0 0 0 3.25-3.25v-8.5A3.25 3.25 0 0 0 16.25 4.5h-8.5Zm8.88 1.12a.88.88 0 1 1 0 1.76.88.88 0 0 1 0-1.76ZM12 7.1A4.9 4.9 0 1 1 7.1 12 4.9 4.9 0 0 1 12 7.1Zm0 1.5A3.4 3.4 0 1 0 15.4 12 3.4 3.4 0 0 0 12 8.6Z"
                fill="currentColor"
              />
            </svg>
            <svg v-else class="social-channel-icon" viewBox="0 0 24 24" role="presentation">
              <path
                d="M13.5 20v-7.1h2.43l.37-2.95H13.5V8.06c0-.86.23-1.45 1.46-1.45h1.56V3.97c-.27-.03-1.2-.1-2.28-.1-2.26 0-3.8 1.38-3.8 3.92v2.15H7.9v2.95h2.54V20h3.06Z"
                fill="currentColor"
              />
            </svg>
          </span>

          <div class="social-channel-copy">
            <span class="social-channel-label">{{ channel.label }}</span>
            <strong>{{ channel.handle }}</strong>
            <small>{{ channel.accent }}</small>
          </div>

          <span class="social-channel-arrow" aria-hidden="true">↗</span>
        </a>
      </div>
    </section>

    <section class="content-section testimonials-section">
      <div class="testimonials-header">
        <h2>Real results from real founders</h2>
        <p>
          Founders love how effortless consistent content becomes when capture, generation, and
          scheduling live in one workflow.
        </p>
      </div>

      <div class="testimonials-stage">
        <span class="floating-signal floating-signal-left" aria-hidden="true">✓</span>
        <span class="floating-signal floating-signal-top" aria-hidden="true">f</span>
        <span class="floating-signal floating-signal-right" aria-hidden="true">★</span>

        <div class="testimonials-lane">
          <article
            v-for="testimonial in testimonials"
            :key="testimonial.name"
            class="testimonial-card"
            :class="[
              `testimonial-card-${testimonial.layout}`,
              testimonial.layout === 'featured' ? 'testimonial-card-featured' : 'testimonial-card-side',
            ]"
          >
            <div class="testimonial-platforms">
              <span
                v-for="platform in testimonial.platforms"
                :key="`${testimonial.name}-${platform}`"
                class="platform-pill"
                :class="`platform-pill-${platform}`"
              >
                {{ platformLabels[platform] }}
              </span>
            </div>

            <div class="testimonial-card-header">
              <span class="testimonial-avatar" :class="`testimonial-avatar-${testimonial.avatarTone}`">
                {{ testimonial.initials }}
              </span>

              <div class="testimonial-identity">
                <strong>{{ testimonial.name }}</strong>
                <span>{{ testimonial.role }}</span>
              </div>
            </div>

            <p class="testimonial-quote">{{ testimonial.quote }}</p>
            <p class="testimonial-detail">{{ testimonial.detail }}</p>

            <div class="testimonial-rating" aria-label="5 out of 5 stars">
              <span v-for="star in testimonial.rating" :key="`${testimonial.name}-${star}`">&#9733;</span>
            </div>
          </article>
        </div>

        <div class="testimonial-dots" aria-hidden="true">
          <span class="active"></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </section>

    <section class="content-section publish-bridge-section">
      <div class="publish-bridge-top">
        <div class="section-header publish-bridge-copy">
          <p class="eyebrow">From idea to published post in minutes</p>
          <h2>Go from raw thought to scheduled multi-platform content without breaking the flow.</h2>
          <p class="section-description">
            Founder Content wins when the idea becomes something real fast: captured, shaped,
            published, and queued for the next slot.
          </p>
        </div>

        <aside class="publish-bridge-visual">
          <p class="panel-label">Why this feels fast</p>
          <div class="publish-signal-stack">
            <article v-for="signal in publishSignals" :key="signal.title" class="publish-signal-card">
              <strong>{{ signal.title }}</strong>
              <p>{{ signal.description }}</p>
            </article>
          </div>

          <div class="publish-platform-row" aria-label="Supported platforms">
            <span>LinkedIn</span>
            <span>Instagram</span>
            <span>Facebook</span>
          </div>
        </aside>
      </div>

      <div class="publish-flow-grid">
        <article v-for="(step, index) in publishFlow" :key="step.title" class="publish-flow-card">
          <span class="publish-flow-index">0{{ index + 1 }}</span>
          <strong>{{ step.title }}</strong>
          <p>{{ step.description }}</p>
        </article>
      </div>
    </section>

    <section id="demo" class="content-section demo-section">
      <p class="conversion-line">
        Most people do not fail at content because they lack ideas. They fail because they do not publish consistently.
      </p>
      <div class="demo-section-top">
        <div class="section-header">
          <p class="eyebrow">Demo</p>
          <h2>Show the transformation instantly.</h2>
          <p class="section-description">
            People usually do not struggle to write. They struggle to start and to stay consistent.
            The landing page should prove that one input can become a publishable post fast, then feed a workflow worth repeating.
          </p>
        </div>

        <aside class="demo-summary-card">
          <p class="panel-label">What users should feel</p>
          <div class="demo-summary-list">
            <span v-for="signal in demoSignals" :key="signal">{{ signal }}</span>
          </div>
        </aside>
      </div>

      <div class="demo-grid">
        <article class="demo-card demo-input-card">
          <div class="demo-card-top">
            <p class="panel-label">Input</p>
            <span class="demo-stage-badge">Raw idea</span>
          </div>
          <h3>“Nobody talks about how lonely startups are”</h3>
          <p>
            A saved line from a note, screenshot, or half-formed founder thought.
          </p>
          <div class="demo-chip-row">
            <span>Screenshot</span>
            <span>Founder note</span>
            <span>Voice memo</span>
          </div>
        </article>

        <article class="demo-card demo-output-card">
          <div class="demo-card-top">
            <p class="panel-label">Output</p>
            <span class="demo-stage-badge success">Ready to ship</span>
          </div>
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
          <div class="demo-output-platforms">
            <span>LinkedIn</span>
            <span>Instagram</span>
            <span>Facebook</span>
          </div>
        </article>
      </div>
    </section>

    <section id="how-it-works" class="content-section workflow-section">
      <div class="workflow-section-top">
        <div class="section-header">
          <p class="eyebrow">How It Works</p>
          <h2>One workflow that turns capture into consistency.</h2>
        </div>

        <aside class="workflow-proof-card">
          <p class="panel-label">Why it sticks</p>
          <ul class="workflow-proof-list">
            <li v-for="reason in workflowReasons" :key="reason">{{ reason }}</li>
          </ul>
        </aside>
      </div>

      <div class="steps-grid">
        <article v-for="(step, index) in steps" :key="step.title" class="info-card step-card">
          <p class="step-number">0{{ index + 1 }}</p>
          <h3>{{ step.title }}</h3>
          <p>{{ step.description }}</p>
        </article>
      </div>
    </section>

    <section class="content-section use-cases-section">
      <div class="section-header section-header-wide">
        <p class="eyebrow">Use Cases</p>
        <h2>Built for the people who need to show up every week.</h2>
        <p class="section-description">
          Whether the content engine sits with the founder, a lean marketing team, or a creator-led
          brand, the workflow stays grounded in real source material and repeatable publishing.
        </p>
      </div>

      <div class="info-grid use-cases-grid">
        <article
          v-for="(useCase, index) in useCases"
          :key="useCase.title"
          class="info-card use-case-card"
          :class="`use-case-card-${index + 1}`"
        >
          <span class="card-index-pill">0{{ index + 1 }}</span>
          <h3>{{ useCase.title }}</h3>
          <p>{{ useCase.description }}</p>
        </article>
      </div>
    </section>

    <section class="content-section features-section">
      <div class="features-top">
        <div class="section-header">
          <p class="eyebrow">Features</p>
          <h2>Generate once. Publish everywhere.</h2>
          <p class="section-description">
            This product wins by helping people start faster, shape stronger messages, and keep a
            publishing rhythm they can actually maintain.
          </p>
        </div>

        <aside class="feature-focus-card">
          <p class="panel-label">Designed for momentum</p>
          <strong>Less blank-page friction. More finished posts in the queue.</strong>
          <div class="feature-focus-pills">
            <span>Capture first</span>
            <span>Founder-native tone</span>
            <span>Schedule next</span>
          </div>
        </aside>
      </div>

      <div class="info-grid feature-grid">
        <article
          v-for="(feature, index) in features"
          :key="feature.title"
          class="info-card feature-card"
          :class="`feature-card-${index + 1}`"
        >
          <span class="card-index-pill">0{{ index + 1 }}</span>
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.description }}</p>
        </article>
      </div>
    </section>

    <section id="pricing" class="content-section pricing-section">
      <div class="pricing-header-row">
        <div class="section-header">
          <p class="eyebrow">Pricing</p>
          <h2>Pricing built around consistency, not feature bloat.</h2>
          <p class="section-description">
            Start by validating the workflow, then unlock the weekly planning system as your
            posting habit takes hold. The goal is not more posts. It is consistent,
            high-performing content that compounds.
          </p>
        </div>

        <div class="pricing-signal-row">
          <span v-for="signal in pricingSignals" :key="signal">{{ signal }}</span>
        </div>
      </div>

      <div class="pricing-grid">
        <article
          v-for="plan in pricingPlans"
          :key="plan.name"
          class="pricing-card"
          :class="{ featured: plan.featured }"
        >
          <div class="pricing-card-top">
            <p class="plan-badge">{{ plan.badge }}</p>
            <span v-if="plan.featured" class="pricing-featured-pill">Most popular</span>
          </div>
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
      <div class="final-cta-shell">
        <div class="final-cta-copy">
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
        </div>

        <aside class="final-cta-visual">
          <div class="final-cta-panel">
            <p class="panel-label">What happens next</p>
            <strong>Capture the idea, shape the post, queue the next slot.</strong>
            <div class="final-trust-row">
              <span v-for="pill in finalTrustPills" :key="pill">{{ pill }}</span>
            </div>
          </div>
        </aside>
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
  width: min(1520px, 100%);
  margin: 0 auto;
  padding: 28px 24px 88px;
}

.hero-section {
  position: relative;
  display: flex;
  align-items: center;
  min-height: clamp(620px, 52vw, 780px);
  padding: clamp(44px, 5vw, 78px);
  margin-bottom: 36px;
  border: 1px solid rgba(112, 84, 62, 0.12);
  border-radius: 40px;
  background:
    radial-gradient(circle at 12% 18%, rgba(223, 126, 69, 0.14) 0%, rgba(223, 126, 69, 0) 28%),
    linear-gradient(180deg, rgba(255, 250, 246, 0.94) 0%, rgba(255, 247, 242, 0.9) 100%);
  box-shadow: 0 28px 70px rgba(68, 44, 20, 0.08);
  overflow: hidden;
  isolation: isolate;
}

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
  position: relative;
  z-index: 2;
  width: min(100%, 560px);
}

.site-footer {
  width: min(1180px, 100%);
  margin: 28px auto 0;
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

.hero-section::before {
  content: "";
  position: absolute;
  inset: 0 -2% 0 auto;
  width: min(74%, 1080px);
  background: url("/images/landing-page/founder-content-hero-background.png") right center / contain no-repeat;
  z-index: 0;
}

.hero-section::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      90deg,
      rgba(255, 249, 244, 0.98) 0%,
      rgba(255, 249, 244, 0.96) 26%,
      rgba(255, 249, 244, 0.88) 38%,
      rgba(255, 249, 244, 0.56) 50%,
      rgba(255, 249, 244, 0.14) 63%,
      rgba(255, 249, 244, 0) 74%
    ),
    radial-gradient(circle at 84% 82%, rgba(231, 158, 103, 0.18) 0%, rgba(231, 158, 103, 0) 24%);
  z-index: 1;
  pointer-events: none;
}

.social-proof-section {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top right, rgba(36, 71, 77, 0.08) 0%, rgba(36, 71, 77, 0) 28%),
    linear-gradient(180deg, rgba(255, 247, 239, 0.96) 0%, rgba(255, 251, 247, 0.92) 100%);
}

.social-proof-header {
  max-width: 760px;
}

.social-proof-stage {
  position: relative;
  display: grid;
  gap: 18px;
  margin-top: 28px;
}

.social-proof-fade {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 92px;
  z-index: 2;
  pointer-events: none;
}

.social-proof-fade-left {
  left: -34px;
  background: linear-gradient(90deg, rgba(255, 249, 243, 1) 0%, rgba(255, 249, 243, 0) 100%);
}

.social-proof-fade-right {
  right: -34px;
  background: linear-gradient(270deg, rgba(255, 249, 243, 1) 0%, rgba(255, 249, 243, 0) 100%);
}

.social-proof-rail {
  overflow: hidden;
}

.social-proof-rail:hover .social-proof-track {
  animation-play-state: paused;
}

.social-proof-track {
  display: flex;
  gap: 18px;
  width: max-content;
  animation: social-proof-scroll 42s linear infinite;
}

.social-proof-track.reverse {
  animation-direction: reverse;
  animation-duration: 50s;
}

.social-proof-card {
  display: grid;
  gap: 16px;
  width: clamp(290px, 27vw, 360px);
  min-height: 100%;
  padding: 22px;
  border: 1px solid rgba(112, 84, 62, 0.16);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(252, 245, 239, 0.92) 100%);
  box-shadow: 0 22px 56px rgba(76, 49, 26, 0.08);
  text-decoration: none;
  color: inherit;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    border-color 180ms ease;
}

.social-proof-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 26px 64px rgba(76, 49, 26, 0.14);
}

.social-proof-card-header,
.social-proof-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.social-platform-pill,
.social-proof-media-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 0.83rem;
  font-weight: 800;
}

.social-platform-pill {
  background: rgba(36, 71, 77, 0.1);
  color: #24474d;
}

.platform-linkedin .social-platform-pill {
  background: rgba(10, 102, 194, 0.12);
  color: #0a66c2;
}

.platform-facebook .social-platform-pill {
  background: rgba(24, 119, 242, 0.12);
  color: #1877f2;
}

.platform-instagram .social-platform-pill {
  background: rgba(225, 48, 108, 0.12);
  color: #c13584;
}

.social-proof-date {
  color: #7a675d;
  font-size: 0.88rem;
  font-weight: 700;
}

.social-proof-profile {
  display: flex;
  align-items: center;
  gap: 12px;
}

.social-proof-avatar,
.social-proof-avatar-fallback {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  flex-shrink: 0;
}

.social-proof-avatar {
  display: block;
  object-fit: cover;
  border: 1px solid rgba(112, 84, 62, 0.14);
}

.social-proof-avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(215, 102, 52, 0.18) 0%, rgba(188, 75, 36, 0.1) 100%);
  color: #9b5d34;
  font-weight: 800;
}

.social-proof-meta strong {
  display: block;
  color: #1f1814;
  font-size: 1rem;
  line-height: 1.2;
}

.social-proof-meta span {
  display: block;
  margin-top: 4px;
  color: #74655b;
  font-size: 0.92rem;
  line-height: 1.5;
}

.social-proof-media {
  position: relative;
  overflow: hidden;
  aspect-ratio: 1.45 / 1;
  border-radius: 22px;
  background:
    linear-gradient(135deg, rgba(255, 236, 221, 0.92) 0%, rgba(242, 251, 247, 0.92) 100%);
  border: 1px solid rgba(112, 84, 62, 0.12);
}

.social-proof-media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.social-proof-media-tag {
  position: absolute;
  right: 12px;
  bottom: 12px;
  background: rgba(27, 22, 19, 0.78);
  color: #fff8f3;
  backdrop-filter: blur(12px);
}

.social-proof-caption {
  margin: 0;
  color: #2a221d;
  line-height: 1.75;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  overflow: hidden;
  min-height: calc(1.75em * 4);
}

.social-proof-footer {
  margin-top: auto;
  color: #74655b;
  font-size: 0.9rem;
  font-weight: 700;
}

.social-proof-link {
  color: #b94b24;
}

.social-links-section {
  width: min(1180px, 100%);
  display: grid;
  gap: 24px;
  background:
    radial-gradient(circle at 10% 18%, rgba(223, 126, 69, 0.1) 0%, rgba(223, 126, 69, 0) 24%),
    linear-gradient(180deg, rgba(255, 250, 246, 0.94) 0%, rgba(255, 247, 242, 0.9) 100%);
}

.social-links-copy {
  max-width: 760px;
}

.social-links-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.social-channel-card {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  padding: 22px;
  border: 1px solid rgba(128, 94, 69, 0.14);
  border-radius: 28px;
  background: rgba(255, 252, 248, 0.92);
  box-shadow: 0 20px 48px rgba(80, 51, 28, 0.08);
  text-decoration: none;
  overflow: hidden;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    border-color 180ms ease,
    background 180ms ease;
}

.social-channel-card::before {
  content: "";
  position: absolute;
  inset: auto auto -34px -24px;
  width: 110px;
  height: 110px;
  border-radius: 999px;
  opacity: 0.34;
  pointer-events: none;
}

.social-channel-card:hover {
  transform: translateY(-4px);
  border-color: rgba(185, 75, 36, 0.18);
  box-shadow: 0 26px 56px rgba(80, 51, 28, 0.12);
}

.social-channel-card-linkedin::before {
  background: radial-gradient(circle, rgba(10, 102, 194, 0.22) 0%, rgba(10, 102, 194, 0) 72%);
}

.social-channel-card-instagram::before {
  background: radial-gradient(circle, rgba(217, 72, 132, 0.22) 0%, rgba(217, 72, 132, 0) 72%);
}

.social-channel-card-facebook::before {
  background: radial-gradient(circle, rgba(24, 119, 242, 0.22) 0%, rgba(24, 119, 242, 0) 72%);
}

.social-channel-icon-shell {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 62px;
  border-radius: 20px;
  color: #fff;
  box-shadow: 0 18px 34px rgba(76, 49, 26, 0.14);
}

.social-channel-card-linkedin .social-channel-icon-shell {
  background: linear-gradient(135deg, #0a66c2 0%, #004182 100%);
}

.social-channel-card-instagram .social-channel-icon-shell {
  background: linear-gradient(135deg, #f58529 0%, #dd2a7b 50%, #8134af 100%);
}

.social-channel-card-facebook .social-channel-icon-shell {
  background: linear-gradient(135deg, #1877f2 0%, #0d5bd3 100%);
}

.social-channel-icon {
  width: 28px;
  height: 28px;
}

.social-channel-copy {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 4px;
  min-width: 0;
}

.social-channel-label {
  color: #8d6447;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.social-channel-copy strong {
  color: #1f1814;
  font-size: 1.18rem;
  line-height: 1.2;
}

.social-channel-copy small {
  color: #5b4f47;
  font-size: 0.96rem;
  line-height: 1.4;
}

.social-channel-arrow {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.76);
  color: #2d2521;
  font-size: 1.15rem;
  box-shadow: inset 0 0 0 1px rgba(128, 94, 69, 0.1);
}

.testimonials-section {
  position: relative;
  width: min(1320px, 100%);
  padding: clamp(34px, 4vw, 56px);
  text-align: center;
  overflow: hidden;
  background:
    radial-gradient(circle at 18% 18%, rgba(226, 140, 88, 0.12) 0%, rgba(226, 140, 88, 0) 24%),
    radial-gradient(circle at 82% 72%, rgba(235, 169, 123, 0.14) 0%, rgba(235, 169, 123, 0) 22%),
    linear-gradient(180deg, rgba(255, 250, 246, 0.94) 0%, rgba(255, 247, 242, 0.9) 100%);
}

.testimonials-header {
  position: relative;
  z-index: 2;
  max-width: 860px;
  margin: 0 auto;
}

.testimonials-header h2 {
  font-size: clamp(2.4rem, 4.5vw, 4.4rem);
  line-height: 0.96;
}

.testimonials-header p {
  margin: 18px auto 0;
  max-width: 34ch;
  color: #5b4f47;
  font-size: clamp(1.06rem, 1.6vw, 1.42rem);
  line-height: 1.6;
}

.testimonials-stage {
  position: relative;
  margin-top: 40px;
  padding: 14px 10px 6px;
}

.testimonials-lane {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.08fr) minmax(0, 0.9fr);
  align-items: center;
}

.testimonial-card {
  position: relative;
  text-align: left;
  border: 1px solid rgba(128, 94, 69, 0.14);
  border-radius: 34px;
  background: rgba(255, 252, 248, 0.9);
  box-shadow: 0 24px 64px rgba(80, 51, 28, 0.1);
  backdrop-filter: blur(12px);
}

.testimonial-card-side {
  min-height: 364px;
  padding: 26px 28px 24px;
}

.testimonial-card-left {
  justify-self: end;
  transform: translateX(34px) translateY(44px) scale(0.92);
  z-index: 1;
}

.testimonial-card-right {
  justify-self: start;
  transform: translateX(-34px) translateY(44px) scale(0.92);
  z-index: 1;
}

.testimonial-card-featured {
  z-index: 2;
  min-height: 448px;
  padding: 28px 38px 30px;
  box-shadow: 0 32px 80px rgba(80, 51, 28, 0.14);
}

.testimonial-platforms {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
}

.platform-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 34px;
  padding: 0 10px;
  border-radius: 12px;
  border: 1px solid rgba(116, 86, 64, 0.14);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  box-shadow: 0 10px 18px rgba(72, 46, 26, 0.08);
}

.platform-pill-linkedin {
  background: #e7f1ff;
  color: #0a66c2;
}

.platform-pill-facebook {
  background: #ebf1ff;
  color: #1877f2;
}

.platform-pill-instagram {
  background: linear-gradient(135deg, #fff0da 0%, #ffe3ee 100%);
  color: #d94884;
}

.testimonial-card-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.testimonial-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 22px;
  color: #241a16;
  font-size: 1.18rem;
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85);
}

.testimonial-avatar-sunset {
  background: linear-gradient(135deg, #ffd9c0 0%, #f2b281 100%);
}

.testimonial-avatar-apricot {
  background: linear-gradient(135deg, #ffe0cb 0%, #f3bf98 100%);
}

.testimonial-avatar-sky {
  background: linear-gradient(135deg, #f0dccf 0%, #d0d7e8 100%);
}

.testimonial-identity {
  display: grid;
  gap: 4px;
}

.testimonial-identity strong {
  font-size: clamp(1.34rem, 2vw, 1.95rem);
  line-height: 1.05;
  color: #1f1814;
}

.testimonial-identity span {
  color: #6b5a4f;
  font-size: 1rem;
  line-height: 1.4;
}

.testimonial-quote,
.testimonial-detail {
  margin: 0;
  color: #2a201b;
}

.testimonial-quote {
  margin-top: 26px;
  font-size: clamp(1.26rem, 2.1vw, 1.88rem);
  line-height: 1.45;
}

.testimonial-detail {
  margin-top: 20px;
  color: #4a3d36;
  font-size: clamp(1rem, 1.55vw, 1.3rem);
  line-height: 1.6;
}

.testimonial-card-side .testimonial-identity strong {
  font-size: 1.2rem;
}

.testimonial-card-side .testimonial-identity span {
  font-size: 0.94rem;
}

.testimonial-card-side .testimonial-avatar {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  font-size: 1rem;
}

.testimonial-card-side .testimonial-quote {
  margin-top: 20px;
  font-size: 1rem;
  line-height: 1.6;
}

.testimonial-card-side .testimonial-detail {
  margin-top: 12px;
  font-size: 0.98rem;
  line-height: 1.65;
}

.testimonial-rating {
  display: flex;
  gap: 8px;
  margin-top: 24px;
  color: #f2a539;
  font-size: 1.9rem;
  line-height: 1;
}

.testimonial-card-side .testimonial-rating {
  margin-top: 18px;
  font-size: 1.6rem;
}

.testimonial-dots {
  display: inline-flex;
  gap: 12px;
  margin-top: 28px;
}

.testimonial-dots span {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: rgba(182, 141, 110, 0.22);
}

.testimonial-dots .active {
  background: linear-gradient(135deg, #d76634 0%, #b94b24 100%);
}

.floating-signal {
  position: absolute;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: 1px solid rgba(116, 86, 64, 0.12);
  border-radius: 16px;
  background: rgba(255, 252, 248, 0.92);
  box-shadow: 0 16px 36px rgba(75, 49, 27, 0.08);
  color: #d07a3f;
  font-size: 1.2rem;
  font-weight: 800;
}

.floating-signal-left {
  top: 106px;
  left: 10px;
}

.floating-signal-top {
  top: -6px;
  left: 22%;
  background: #ebf1ff;
  color: #1877f2;
}

.floating-signal-right {
  right: 10%;
  top: 78px;
  color: #f2a539;
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
  max-width: 8.2ch;
  font-size: clamp(3.7rem, 6.4vw, 6rem);
  line-height: 0.9;
}

.hero-description,
.section-description,
.info-card p,
.demo-card p,
.final-cta p,
.plan-description {
  color: #5b4f47;
  line-height: 1.7;
}

.hero-description {
  max-width: 25ch;
  margin-top: 22px;
  font-size: clamp(1.12rem, 1.55vw, 1.38rem);
  line-height: 1.6;
}

.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 32px;
}

.primary-cta,
.secondary-cta,
.plan-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 56px;
  padding: 0 26px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 1rem;
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
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 14px 34px rgba(71, 46, 24, 0.06);
}

.primary-cta:hover,
.secondary-cta:hover,
.plan-cta:hover {
  transform: translateY(-2px);
}

.demo-card,
.info-card,
.pricing-card {
  border: 1px solid rgba(112, 84, 62, 0.14);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 251, 247, 0.96) 0%, rgba(250, 242, 236, 0.88) 100%);
  box-shadow: 0 20px 55px rgba(76, 49, 26, 0.1);
}

.content-section,
.final-cta {
  width: min(1180px, 100%);
  padding: 34px;
  margin: 24px auto 0;
}

.publish-bridge-section {
  position: relative;
  background:
    linear-gradient(180deg, rgba(255, 245, 236, 0.94) 0%, rgba(255, 250, 245, 0.88) 100%);
}

.publish-bridge-top,
.demo-section-top,
.workflow-section-top,
.features-top,
.pricing-header-row,
.final-cta-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(300px, 0.95fr);
  gap: 22px;
  align-items: start;
}

.publish-bridge-visual,
.demo-summary-card,
.workflow-proof-card,
.feature-focus-card,
.final-cta-panel {
  padding: 24px;
  border: 1px solid rgba(128, 94, 69, 0.14);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 16px 42px rgba(80, 51, 28, 0.08);
}

.publish-signal-stack {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.publish-signal-card {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(255, 249, 244, 0.84);
  border: 1px solid rgba(128, 94, 69, 0.12);
}

.publish-signal-card strong,
.feature-focus-card strong,
.final-cta-panel strong {
  color: #1f1814;
  font-size: 1.05rem;
  line-height: 1.35;
}

.publish-signal-card p,
.workflow-proof-list,
.feature-focus-pills,
.pricing-signal-row,
.final-trust-row {
  margin: 0;
}

.publish-signal-card p {
  color: #5b4f47;
  line-height: 1.55;
}

.publish-platform-row,
.feature-focus-pills,
.pricing-signal-row,
.final-trust-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.publish-platform-row {
  margin-top: 16px;
}

.publish-platform-row span,
.demo-summary-list span,
.demo-chip-row span,
.demo-output-platforms span,
.feature-focus-pills span,
.pricing-signal-row span,
.final-trust-row span,
.card-index-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(128, 94, 69, 0.12);
  background: rgba(255, 255, 255, 0.72);
  color: #3a2f29;
  font-size: 0.84rem;
  font-weight: 700;
}

.section-header {
  max-width: 760px;
}

.section-header-wide {
  max-width: 860px;
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

.demo-section {
  background:
    radial-gradient(circle at 12% 18%, rgba(215, 102, 52, 0.08) 0%, rgba(215, 102, 52, 0) 24%),
    linear-gradient(180deg, rgba(255, 250, 246, 0.96) 0%, rgba(255, 251, 247, 0.94) 100%);
}

.demo-summary-card {
  display: grid;
  gap: 14px;
}

.demo-summary-list {
  display: grid;
  gap: 10px;
}

.demo-summary-list span {
  justify-content: flex-start;
  min-height: 40px;
  padding: 0 14px;
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
  align-items: stretch;
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
  position: relative;
  display: grid;
  gap: 14px;
  padding: 28px;
}

.demo-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.demo-stage-badge {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: #8e5834;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.demo-stage-badge.success {
  background: rgba(36, 71, 77, 0.12);
  color: #24474d;
}

.demo-card h3 {
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

.demo-chip-row,
.demo-output-platforms {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.demo-output-platforms {
  margin-top: auto;
}

.conversion-line {
  margin: 0 0 18px;
  color: #24474d;
  font-size: 1rem;
  font-weight: 800;
  line-height: 1.5;
}

.workflow-section {
  background:
    linear-gradient(180deg, rgba(255, 249, 243, 0.98) 0%, rgba(255, 252, 248, 0.94) 100%);
}

.workflow-proof-list {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  padding-left: 18px;
  color: #5b4f47;
  line-height: 1.7;
}

.steps-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.info-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.info-card {
  position: relative;
  padding: 26px;
}

.info-card h3 {
  margin-top: 10px;
  font-size: 1.5rem;
  line-height: 1.1;
}

.use-cases-section,
.features-section {
  background:
    linear-gradient(180deg, rgba(255, 250, 246, 0.96) 0%, rgba(255, 248, 242, 0.92) 100%);
}

.use-cases-grid,
.feature-grid {
  margin-top: 26px;
}

.use-case-card,
.feature-card {
  overflow: hidden;
}

.use-case-card::before,
.feature-card::before {
  content: "";
  position: absolute;
  inset: auto -14px -28px auto;
  width: 118px;
  height: 118px;
  border-radius: 999px;
  opacity: 0.32;
  pointer-events: none;
}

.use-case-card-1::before,
.feature-card-1::before {
  background: radial-gradient(circle, rgba(215, 102, 52, 0.2) 0%, rgba(215, 102, 52, 0) 72%);
}

.use-case-card-2::before,
.feature-card-2::before {
  background: radial-gradient(circle, rgba(36, 71, 77, 0.18) 0%, rgba(36, 71, 77, 0) 72%);
}

.use-case-card-3::before,
.feature-card-3::before {
  background: radial-gradient(circle, rgba(245, 165, 57, 0.2) 0%, rgba(245, 165, 57, 0) 72%);
}

.use-case-card-4::before,
.feature-card-4::before,
.feature-card-5::before {
  background: radial-gradient(circle, rgba(169, 125, 91, 0.18) 0%, rgba(169, 125, 91, 0) 72%);
}

.card-index-pill {
  width: fit-content;
  margin-bottom: 8px;
  color: #9b5d34;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.features-top {
  margin-bottom: 4px;
}

.feature-focus-card {
  display: grid;
  gap: 14px;
  background:
    linear-gradient(180deg, rgba(252, 244, 237, 0.98) 0%, rgba(255, 251, 247, 0.94) 100%);
}

.feature-focus-pills span {
  color: #8a5d43;
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

.pricing-header-row {
  margin-bottom: 6px;
}

.pricing-signal-row {
  align-content: start;
}

.pricing-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pricing-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
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

.pricing-featured-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(215, 102, 52, 0.14);
  color: #a04d27;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
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

.plan-points li::marker {
  color: #d76634;
}

.plan-cta {
  margin-top: auto;
  align-self: flex-start;
}

.final-cta {
  overflow: hidden;
  background:
    radial-gradient(circle at 12% 22%, rgba(223, 126, 69, 0.14) 0%, rgba(223, 126, 69, 0) 28%),
    linear-gradient(180deg, rgba(255, 248, 242, 0.98) 0%, rgba(255, 244, 236, 0.94) 100%);
}

.final-cta-copy {
  text-align: left;
}

.final-cta-copy > p:not(.eyebrow) {
  max-width: 720px;
  margin: 14px 0 0;
}

.final-cta-visual {
  display: flex;
  justify-content: flex-end;
}

.final-cta-panel {
  width: min(100%, 420px);
  display: grid;
  gap: 14px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.76) 0%, rgba(252, 245, 239, 0.9) 100%);
}

.final-cta .cta-row {
  justify-content: flex-start;
}

@keyframes social-proof-scroll {
  from {
    transform: translateX(0);
  }

  to {
    transform: translateX(calc(-50% - 9px));
  }
}

@media (max-width: 1080px) {
  .demo-grid,
  .pricing-grid {
    grid-template-columns: 1fr;
  }

  .publish-bridge-top,
  .demo-section-top,
  .workflow-section-top,
  .features-top,
  .pricing-header-row,
  .final-cta-shell {
    grid-template-columns: 1fr;
  }

  .social-links-grid {
    grid-template-columns: 1fr;
  }

  .testimonials-lane {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .testimonial-card-left,
  .testimonial-card-right {
    justify-self: stretch;
    transform: none;
  }

  .testimonial-card-featured {
    order: -1;
    min-height: 0;
  }

  .floating-signal-left {
    left: auto;
    right: 12%;
    top: 22px;
  }

  .floating-signal-top {
    left: 10%;
    top: auto;
    bottom: 18px;
  }

  .floating-signal-right {
    right: 8%;
    top: auto;
    bottom: 74px;
  }

  .hero-section {
    align-items: flex-start;
    min-height: 760px;
    padding: 40px 34px;
  }

  .hero-section::before {
    inset: auto 0 -4% 0;
    width: auto;
    background-position: center bottom;
    background-size: min(920px, 120%) auto;
  }

  .hero-section::after {
    background:
      linear-gradient(
        180deg,
        rgba(255, 249, 244, 0.96) 0%,
        rgba(255, 249, 244, 0.92) 24%,
        rgba(255, 249, 244, 0.7) 44%,
        rgba(255, 249, 244, 0.24) 64%,
        rgba(255, 249, 244, 0) 100%
      );
  }

  .publish-flow-grid,
  .steps-grid,
  .info-grid {
    grid-template-columns: 1fr 1fr;
  }

  .final-cta-visual {
    justify-content: flex-start;
  }

  .social-proof-fade {
    display: none;
  }

  .pricing-card.featured {
    transform: none;
  }
}

@media (max-width: 720px) {
  .landing-shell {
    padding: 18px 12px 64px;
  }

  .publish-bridge-visual,
  .demo-summary-card,
  .workflow-proof-card,
  .feature-focus-card,
  .final-cta-panel {
    padding: 20px;
    border-radius: 24px;
  }

  .social-channel-card {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 14px;
    padding: 18px;
  }

  .social-channel-arrow {
    display: none;
  }

  .social-channel-icon-shell {
    width: 54px;
    height: 54px;
    border-radius: 18px;
  }

  .social-channel-icon {
    width: 24px;
    height: 24px;
  }

  .social-channel-copy strong {
    font-size: 1.06rem;
  }

  .social-channel-copy small {
    font-size: 0.9rem;
  }

  .testimonials-section {
    padding: 26px 20px 28px;
  }

  .testimonials-header h2 {
    font-size: clamp(2.1rem, 10vw, 3.1rem);
  }

  .testimonials-header p {
    font-size: 1rem;
  }

  .testimonials-stage {
    margin-top: 28px;
    padding: 0 0 6px;
  }

  .demo-card-top {
    align-items: flex-start;
    flex-direction: column;
  }

  .demo-summary-list span,
  .publish-platform-row span,
  .demo-chip-row span,
  .demo-output-platforms span,
  .pricing-signal-row span,
  .final-trust-row span {
    width: 100%;
    justify-content: flex-start;
  }

  .testimonial-card-side,
  .testimonial-card-featured {
    padding: 22px;
    border-radius: 26px;
  }

  .testimonial-card-header {
    gap: 12px;
  }

  .testimonial-identity strong {
    font-size: 1.2rem;
  }

  .testimonial-identity span,
  .testimonial-detail,
  .testimonial-card-side .testimonial-detail {
    font-size: 0.95rem;
  }

  .testimonial-quote {
    font-size: 1.08rem;
    line-height: 1.6;
  }

  .testimonial-rating,
  .testimonial-card-side .testimonial-rating {
    gap: 6px;
    font-size: 1.45rem;
  }

  .floating-signal {
    display: none;
  }

  .hero-section {
    min-height: 640px;
    padding: 26px 22px 300px;
    border-radius: 28px;
  }

  .hero-section::before {
    inset: auto 0 -2% 0;
    background-size: min(720px, 138%) auto;
  }

  .content-section,
  .final-cta,
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

  .social-proof-card {
    width: min(82vw, 320px);
  }

  h1 {
    max-width: none;
    font-size: clamp(2.9rem, 13vw, 4.2rem);
  }

  .hero-description {
    max-width: 22ch;
    font-size: 1rem;
  }

  .final-cta-copy {
    text-align: center;
  }

  .final-cta .cta-row {
    justify-content: center;
  }

  .primary-cta,
  .secondary-cta {
    width: 100%;
  }

  .section-header h2,
  .final-cta h2 {
    font-size: clamp(2rem, 10vw, 2.8rem);
  }

  .plan-price span {
    font-size: 2.5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .social-proof-track {
    animation: none;
  }
}
</style>
