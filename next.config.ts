import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Session/control state is mutated at runtime; never cache the API routes.
};

export default nextConfig;
