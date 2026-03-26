export type AppUserStatus = "active" | "invited" | "suspended";
export type BusinessStatus = "active" | "disabled" | "archived";
export type MembershipStatus = "active" | "invited" | "suspended";
export type BusinessMemberRole = "owner" | "admin" | "editor" | "viewer";
export type AuthIdentityProvider =
  | "firebase"
  | "firebase_password"
  | "google"
  | "otp_email"
  | "stub";

export interface AppUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  status: AppUserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Business {
  id: string;
  ownerUserId: string;
  name: string;
  slug: string;
  brandName: string;
  websiteUrl?: string;
  niche?: string;
  timezone: string;
  status: BusinessStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessMembership {
  id: string;
  businessId: string;
  userId: string;
  role: BusinessMemberRole;
  status: MembershipStatus;
  invitedBy?: string;
  createdAt: string;
  business: Business;
}

export interface MeResponse {
  user: AppUser;
  businesses: BusinessMembership[];
  activeBusinessId: string | null;
  authProviders: AuthIdentityProvider[];
}

export interface MyBusinessesResponse {
  businesses: BusinessMembership[];
}

export interface CreateBusinessRequest {
  name: string;
  slug?: string;
  brandName?: string;
  websiteUrl?: string;
  niche?: string;
  timezone?: string;
}

export interface CreateBusinessResponse {
  business: Business;
  membership: BusinessMembership;
}
