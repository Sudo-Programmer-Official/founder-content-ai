# FounderContent AI

FounderContent AI is a founder-led content product that helps startup builders, operators, and marketers turn experiences, lessons, and business insights into LinkedIn-ready content.

## MVP Scope

The MVP workflow is:

**Idea -> Hook -> Post**

Planned MVP routes:

- `/founder-content-ideas`
- `/linkedin-hook-generator`
- `/linkedin-post-generator`

Early SEO entry page:

- `/linkedin-post-ideas-for-founders`

## Positioning

The homepage and core messaging stay founder-first, but the product workflow also works for:

- operators
- marketers
- consultants
- agencies
- small business owners

## Development Structure

```text
apps/founder-content-ai/
  pages/
  components/
  services/
  styles/
  utils/
```

This app is the frontend only.

The backend lives separately in:

- `../founder-content-api`

Current phase status:

- page scaffolding only
- frontend API client scaffolding only
- prompt scaffolding only
- shared package scaffolding only
- no backend or AI workflow implementation yet

## Source Docs

Use the canonical docs in `../../docs/` as the source of truth:

- `../../docs/product-spec.md`
- `../../docs/architecture.md`
- `../../docs/seo-strategy.md`
- `../../docs/feature-spec.md`
- `../../docs/roadmap.md`
- `../../docs/task-priority.md`
