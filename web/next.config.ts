import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    /** Use `web/` as root when multiple lockfiles exist in the monorepo. */
    root: path.join(__dirname),
  },
};

export default nextConfig;
