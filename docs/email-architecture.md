# Email Architecture

## Goal

Use SES in two stages:

### Phase 1

System email only:

- verification
- invitations
- notifications

### Phase 2

Business-branded sending:

- business adds domain
- backend creates or reuses an SES domain identity
- frontend shows SES DKIM records plus SPF guidance
- backend refreshes verification state from SES before branded sends
- business sends from its own brand email

## Data Model

Business email state belongs in:

- `business_email_settings`

Important fields:

- `from_name`
- `from_email`
- `reply_to_email`
- `provider`
- `ses_identity`
- `domain_status`
- `dkim_status`
- `spf_status`

## Verification Flow

- `POST /api/businesses/:businessId/email/domains` provisions the SES identity and stores the DNS records
- `POST /api/businesses/:businessId/email/domains/:domainId/verify` refreshes verification state from SES
- branded sends are blocked until the business domain is verified for sending

## SPF Note

- the app stores an SPF record suggestion for DNS setup
- if a customer already has SPF, they must merge `include:amazonses.com` into the existing record instead of overwriting it

## Implementation Rule

Do not build a generic SMTP layer first.

The safer path is:

- SES for system mail
- SES identities for branded tenant sending
- configuration stored per business

## Admin Visibility

The admin layer should eventually track:

- send volume
- delivery failures
- domain verification state
- high-volume anomalies
