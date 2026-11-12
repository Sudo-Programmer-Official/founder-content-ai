import { ensureBundle } from "./bundle-cache.ts";

const bundleDir = await ensureBundle({ force: true });
console.log(`Reel renderer bundled to ${bundleDir}`);
