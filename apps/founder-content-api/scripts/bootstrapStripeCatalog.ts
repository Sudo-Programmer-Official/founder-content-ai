import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stripeApiRequest } from "../src/services/billing/stripe.ts";

type CatalogScope = "workspace" | "email" | "all";

type StripeProduct = {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean;
  metadata?: Record<string, string>;
};

type StripePrice = {
  id: string;
  active?: boolean;
  product?: string | { id?: string | null } | null;
  currency?: string | null;
  unit_amount?: number | null;
  recurring?: {
    interval?: string | null;
    interval_count?: number | null;
  } | null;
  lookup_key?: string | null;
  metadata?: Record<string, string>;
};

type StripeListResponse<TItem> = {
  data?: TItem[];
  has_more?: boolean;
};

type CatalogItem = {
  scope: Exclude<CatalogScope, "all">;
  envKey:
    | "STRIPE_STARTER_PRICE_ID"
    | "STRIPE_PRO_PRICE_ID"
    | "STRIPE_EMAIL_STARTER_PRICE_ID"
    | "STRIPE_EMAIL_GROWTH_PRICE_ID"
    | "STRIPE_EMAIL_SCALE_PRICE_ID";
  catalogKey: string;
  productName: string;
  productDescription: string;
  priceLookupKey: string;
  amountCents: number;
};

const ENV_FILE_URL = new URL("../.env", import.meta.url);

const CATALOG_ITEMS: CatalogItem[] = [
  {
    scope: "workspace",
    envKey: "STRIPE_STARTER_PRICE_ID",
    catalogKey: "workspace_starter_monthly",
    productName: "FounderContent Starter",
    productDescription: "Starter workspace plan for FounderContent AI.",
    priceLookupKey: "foundercontent_workspace_starter_monthly",
    amountCents: 900,
  },
  {
    scope: "workspace",
    envKey: "STRIPE_PRO_PRICE_ID",
    catalogKey: "workspace_pro_monthly",
    productName: "FounderContent Pro",
    productDescription: "Pro workspace plan for FounderContent AI.",
    priceLookupKey: "foundercontent_workspace_pro_monthly",
    amountCents: 1900,
  },
  {
    scope: "email",
    envKey: "STRIPE_EMAIL_STARTER_PRICE_ID",
    catalogKey: "email_starter_monthly",
    productName: "FounderContent Email Starter",
    productDescription: "Starter email add-on for FounderContent AI.",
    priceLookupKey: "foundercontent_email_starter_monthly",
    amountCents: 3900,
  },
  {
    scope: "email",
    envKey: "STRIPE_EMAIL_GROWTH_PRICE_ID",
    catalogKey: "email_growth_monthly",
    productName: "FounderContent Email Growth",
    productDescription: "Growth email add-on for FounderContent AI.",
    priceLookupKey: "foundercontent_email_growth_monthly",
    amountCents: 6900,
  },
  {
    scope: "email",
    envKey: "STRIPE_EMAIL_SCALE_PRICE_ID",
    catalogKey: "email_scale_monthly",
    productName: "FounderContent Email Scale",
    productDescription: "Scale email add-on for FounderContent AI.",
    priceLookupKey: "foundercontent_email_scale_monthly",
    amountCents: 9900,
  },
];

function loadEnvFromFile(): void {
  if (!existsSync(ENV_FILE_URL)) {
    return;
  }

  const raw = readFileSync(ENV_FILE_URL, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseScopeFromArgs(argv: string[]): CatalogScope {
  const scopeArgument = argv.find((argument) => argument.startsWith("--scope="));
  const rawScope = scopeArgument?.split("=", 2)[1]?.trim();

  if (!rawScope) {
    return "all";
  }

  if (rawScope === "workspace" || rawScope === "email" || rawScope === "all") {
    return rawScope;
  }

  throw new Error(`Unsupported scope "${rawScope}". Use --scope=workspace, --scope=email, or --scope=all.`);
}

function shouldWriteEnv(argv: string[]): boolean {
  return argv.includes("--write-env");
}

function resolveCatalogItems(scope: CatalogScope): CatalogItem[] {
  if (scope === "all") {
    return CATALOG_ITEMS;
  }

  return CATALOG_ITEMS.filter((item) => item.scope === scope);
}

function resolvePriceProductId(value: StripePrice["product"]): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.id?.trim() || undefined;
}

function assertStripeSecretKey(): void {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is required. Set it in apps/founder-content-api/.env or the shell before running this script.");
  }
}

async function listStripeProducts(): Promise<StripeProduct[]> {
  const response = await stripeApiRequest<StripeListResponse<StripeProduct>>("/products", {
    method: "GET",
    query: {
      active: true,
      limit: 100,
    },
  });

  return response.data ?? [];
}

async function listStripePrices(): Promise<StripePrice[]> {
  const response = await stripeApiRequest<StripeListResponse<StripePrice>>("/prices", {
    method: "GET",
    query: {
      active: true,
      limit: 100,
      type: "recurring",
    },
  });

  return response.data ?? [];
}

function findMatchingProduct(products: StripeProduct[], item: CatalogItem): StripeProduct | undefined {
  return products.find((product) => {
    const metadataKey = product.metadata?.founderContentCatalogKey?.trim();
    const productName = product.name?.trim();

    return metadataKey === item.catalogKey || productName === item.productName;
  });
}

function findMatchingPrice(prices: StripePrice[], productId: string, item: CatalogItem): StripePrice | undefined {
  return prices.find((price) => {
    const metadataKey = price.metadata?.founderContentCatalogKey?.trim();
    const lookupKey = price.lookup_key?.trim();
    const priceProductId = resolvePriceProductId(price.product);
    const interval = price.recurring?.interval?.trim();

    if (lookupKey === item.priceLookupKey || metadataKey === item.catalogKey) {
      return true;
    }

    return (
      priceProductId === productId &&
      price.currency === "usd" &&
      price.unit_amount === item.amountCents &&
      interval === "month"
    );
  });
}

async function createProduct(item: CatalogItem): Promise<StripeProduct> {
  return stripeApiRequest<StripeProduct>("/products", {
    body: {
      name: item.productName,
      description: item.productDescription,
      active: true,
      "metadata[founderContentCatalogKey]": item.catalogKey,
      "metadata[founderContentEnvKey]": item.envKey,
    },
  });
}

async function createPrice(item: CatalogItem, productId: string): Promise<StripePrice> {
  return stripeApiRequest<StripePrice>("/prices", {
    body: {
      currency: "usd",
      unit_amount: item.amountCents,
      product: productId,
      lookup_key: item.priceLookupKey,
      "recurring[interval]": "month",
      "metadata[founderContentCatalogKey]": item.catalogKey,
      "metadata[founderContentEnvKey]": item.envKey,
    },
  });
}

function writeEnvAssignments(assignments: Array<{ envKey: string; priceId: string }>): void {
  const existingRaw = existsSync(ENV_FILE_URL) ? readFileSync(ENV_FILE_URL, "utf8") : "";
  const lines = existingRaw.length > 0 ? existingRaw.split(/\r?\n/) : [];

  for (const { envKey, priceId } of assignments) {
    const nextLine = `${envKey}=${priceId}`;
    const existingLineIndex = lines.findIndex((line) => line.startsWith(`${envKey}=`));

    if (existingLineIndex >= 0) {
      lines[existingLineIndex] = nextLine;
    } else {
      lines.push(nextLine);
    }
  }

  const normalized = lines.filter((line, index, source) => !(index === source.length - 1 && line === "")).join("\n");
  writeFileSync(ENV_FILE_URL, `${normalized}\n`, "utf8");
}

async function main(): Promise<void> {
  loadEnvFromFile();
  process.env.NODE_ENV ??= "development";
  assertStripeSecretKey();

  const scope = parseScopeFromArgs(process.argv.slice(2));
  const writeEnv = shouldWriteEnv(process.argv.slice(2));
  const items = resolveCatalogItems(scope);

  const [products, prices] = await Promise.all([
    listStripeProducts(),
    listStripePrices(),
  ]);
  const assignments: Array<{ envKey: CatalogItem["envKey"]; priceId: string }> = [];

  console.info(`Stripe catalog bootstrap scope: ${scope}`);

  for (const item of items) {
    let product = findMatchingProduct(products, item);

    if (!product) {
      product = await createProduct(item);
      products.push(product);
      console.info(`Created product ${product.name} (${product.id})`);
    } else {
      console.info(`Reusing product ${product.name} (${product.id})`);
    }

    let price = findMatchingPrice(prices, product.id, item);

    if (!price) {
      price = await createPrice(item, product.id);
      prices.push(price);
      console.info(`Created monthly price for ${item.productName} (${price.id})`);
    } else {
      console.info(`Reusing monthly price for ${item.productName} (${price.id})`);
    }

    assignments.push({
      envKey: item.envKey,
      priceId: price.id,
    });
  }

  if (writeEnv) {
    writeEnvAssignments(assignments);
    console.info(`Updated ${ENV_FILE_URL.pathname} with ${assignments.length} Stripe price ids.`);
  }

  console.info("");
  console.info("Set these backend env vars:");

  for (const assignment of assignments) {
    console.info(`${assignment.envKey}=${assignment.priceId}`);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
