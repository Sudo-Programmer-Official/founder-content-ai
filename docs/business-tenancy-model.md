# Business Tenancy Model

## Product Boundary

FounderContent AI is multi-tenant by business.

That means:

- one user can belong to multiple businesses
- each business owns its own settings, members, content, and usage scope
- roles are membership-based, not user-global

## Primary Entities

### User

- a person with one or more auth identities
- can create or join multiple businesses

### Business

- the tenant boundary
- owns brand settings, channels, members, content, email settings, and billing scope

### Business Member

- joins a user to a business
- carries role and membership status

## Roles

- `owner`
- `admin`
- `editor`
- `viewer`

## First-Time User Flow

1. user signs in through Firebase Auth
2. backend resolves or creates the internal user
3. user has no businesses yet
4. frontend prompts for first business creation
5. backend creates:
   - business
   - owner membership
   - default settings later

## Authorization Rule

Every protected business endpoint should answer three questions:

1. Is the identity valid?
2. Is the user a member of this business?
3. Does the role allow the action?

## Anti-Patterns To Avoid

- user equals business
- one business per account forever
- admin permissions mixed with tenant permissions
- business state stored only in Firebase Auth
