<script setup lang="ts">
import PlaceholderSeoPage from "../components/PlaceholderSeoPage.vue";

const examples = [
  "The mistake that almost killed my startup",
  "What our first 100 users taught us",
  "The hardest part of building a product no one talks about",
  "What changed after we finally spoke to customers",
  "Why building in public forced us to improve faster",
];

const templates = [
  "Three years ago I thought the hardest part would be building the product. I was wrong.",
  "We hit a milestone this week, but the real lesson was what broke before we got there.",
  "Most founders talk about growth. Here is the uncomfortable part that came first.",
];
</script>

<template>
  <PlaceholderSeoPage
    route="/linkedin-post-ideas-for-founders"
    title="LinkedIn Post Ideas for Founders"
    description="Static scaffold for the first launch SEO page. It mirrors the structure defined in seo-strategy.md."
    :examples="examples"
    :templates="templates"
    primary-cta="/founder-content-ideas"
    secondary-cta="/linkedin-post-generator"
  />
</template>
