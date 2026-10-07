import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias["@"] = path.resolve(__dirname);
    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ["mongodb", "firebase-admin", "@google/generative-ai"],
  },
};

export default nextConfig;
