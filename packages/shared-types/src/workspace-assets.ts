export type WorkspaceAssetType = "image" | "logo" | "document" | "screenshot";
export type WorkspaceAssetSourceType = "upload" | "post_asset" | "brand_kit" | "generated";
export type WorkspaceAssetUsageSurface = "post" | "email" | "brand_kit" | "visual_generation" | "asset_hub";

export interface WorkspaceAsset {
  id: string;
  businessId: string;
  createdByUserId?: string;
  assetType: WorkspaceAssetType;
  sourceType: WorkspaceAssetSourceType;
  sourceReferenceId?: string;
  title?: string;
  storageKey?: string;
  storageUrl: string;
  previewUrl?: string;
  mimeType: string;
  sizeBytes: number;
  tags: string[];
  metadata: Record<string, unknown>;
  usageCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceAssetUsage {
  id: string;
  businessId: string;
  assetId: string;
  usageSurface: WorkspaceAssetUsageSurface;
  referenceId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceBrandKitSummary {
  businessId: string;
  primaryColor: string;
  secondaryColor: string;
  logoAssetId?: string;
  logoUrl?: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface WorkspaceAssetsQuery {
  businessId: string;
  search?: string;
  assetType?: WorkspaceAssetType | "all";
  sourceType?: WorkspaceAssetSourceType | "all";
  includeInactive?: boolean;
}

export interface WorkspaceAssetsResponse {
  assets: WorkspaceAsset[];
  brandKit?: WorkspaceBrandKitSummary;
}

export interface CreateWorkspaceAssetUploadUrlRequest {
  businessId: string;
  fileType: string;
  fileName?: string;
  sizeBytes?: number;
  assetType?: WorkspaceAssetType;
}

export interface CreateWorkspaceAssetUploadUrlResponse {
  uploadUrl: string;
  storageKey: string;
  storageUrl: string;
  expiresAt: string;
}

export interface CreateWorkspaceAssetRequest {
  businessId: string;
  storageKey?: string;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  title?: string;
  assetType?: WorkspaceAssetType;
  sourceType?: WorkspaceAssetSourceType;
  sourceReferenceId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateWorkspaceAssetResponse {
  asset: WorkspaceAsset;
}

export interface DeleteWorkspaceAssetRequest {
  businessId: string;
}

export interface DeleteWorkspaceAssetResponse {
  deletedAssetId: string;
}

export interface RecordWorkspaceAssetUsageRequest {
  businessId: string;
  usageSurface: WorkspaceAssetUsageSurface;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordWorkspaceAssetUsageResponse {
  asset: WorkspaceAsset;
  usage: WorkspaceAssetUsage;
}
