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
- DNS verification is completed
- SES identity is attached
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
