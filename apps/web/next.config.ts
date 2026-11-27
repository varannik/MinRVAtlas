import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@aws-sdk/client-ssm", "@aws-sdk/client-s3", "aws-jwt-verify"],
  transpilePackages: ["@splinetool/react-spline", "@splinetool/runtime"],
  turbopack: {
    rules: {
      // YAML imports as its parsed document (src/lib/journey/journey.yaml).
      "*.yaml": { loaders: ["./loaders/yaml-loader.cjs"], as: "*.js" },
    },
  },
};

export default nextConfig;
