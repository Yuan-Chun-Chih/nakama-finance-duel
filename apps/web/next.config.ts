import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Keep Turbopack inside the frontend workspace after separating it from Nakama.
const webRoot = path.dirname(fileURLToPath(import.meta.url));
const nextConfig: NextConfig = {
  turbopack: {
    root: webRoot,
  },
};

export default nextConfig;
