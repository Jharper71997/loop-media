import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Pin the workspace root to this project. Without it, Turbopack walks up and
// finds the stray package-lock.json in the home directory and warns.
const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  images: {
    // Serve AVIF first (≈20-30% smaller than WebP) and fall back to WebP for
    // browsers that lack AVIF. Applies to every next/image surface — the brand
    // lockups on login/signup, the /tv house ads, and the trivia phone page.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
