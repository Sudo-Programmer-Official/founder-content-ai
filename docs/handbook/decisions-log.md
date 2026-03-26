# Decisions Log

## March 22, 2026

- Identity provider direction: Firebase Auth
- Product database direction: Postgres
- Email provider direction: SES
- Tenant boundary: business, not user
- Team access model: role-based memberships
- Usage tracking must exist before billing enforcement
- Auth implementation order: docs -> schema -> scaffolded routes -> Firebase + Postgres wiring
