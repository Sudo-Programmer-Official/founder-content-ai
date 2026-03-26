# Admin Architecture

## Goal

Platform administration should be separate from tenant dashboards.

Admin is for platform oversight.
Business dashboards are for tenant operations.

## Planned Admin Views

- all users
- all businesses
- memberships
- usage volume
- subscription status
- email send health
- failure rates
- anomaly detection

## Data Sources

- `users`
- `businesses`
- `business_members`
- `subscriptions`
- `usage_events`
- `admin_audit_logs`
- future email delivery metrics

## Route Direction

Planned admin surface:

- `GET /api/admin/users`
- `GET /api/admin/businesses`
- `GET /api/admin/usage`
- `GET /api/admin/subscriptions`

## Control Rule

Admin access should not reuse business-member roles.

Platform admin needs its own authorization path and audit logging.
