# Tenant Flow

## First Business Creation

1. user authenticates
2. frontend calls `GET /api/me`
3. if `businesses` is empty, prompt for first business
4. frontend calls `POST /api/businesses`
5. backend creates:
   - business
   - owner membership
6. frontend refreshes `/api/me/businesses`

## Ongoing Tenant Rules

- every business-owned entity must carry `business_id`
- every member action should be checked against membership and role
- business switching should be explicit in the frontend
- admin views must stay separate from business dashboards
