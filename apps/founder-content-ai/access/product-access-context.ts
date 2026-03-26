import type { InjectionKey, Ref } from "vue";
import { inject } from "vue";
import type { MyFeaturesResponse, ProductFeatureKey } from "../../../packages/shared-types";

export interface ProductAccessContextValue {
  bootstrap: Ref<MyFeaturesResponse | null>;
  activeBusinessId: Ref<string>;
  isReady: Ref<boolean>;
  isLoading: Ref<boolean>;
  errorMessage: Ref<string>;
  refreshProductAccess: (businessId?: string | null) => Promise<MyFeaturesResponse | null>;
  setActiveBusinessId: (businessId?: string | null) => Promise<MyFeaturesResponse | null>;
  isFeatureEnabled: (featureKey: ProductFeatureKey, fallback?: boolean) => boolean;
}

export const ProductAccessContextKey = Symbol(
  "ProductAccessContext",
) as InjectionKey<ProductAccessContextValue>;

export function useProductAccessContext(): ProductAccessContextValue {
  const context = inject(ProductAccessContextKey);

  if (!context) {
    throw new Error("Product access context is not available.");
  }

  return context;
}
