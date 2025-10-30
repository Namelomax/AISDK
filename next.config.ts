import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  
};
module.exports = {
  env: {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  },
};
module.exports = {
  env: {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  },
};

export default nextConfig;
