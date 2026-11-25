import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@aws-sdk/client-ssm", "@aws-sdk/client-s3", "aws-jwt-verify"],
  transpilePackages: ["@splinetool/react-spline", "@splinetool/runtime"],
  // The console keeps Sentinel's document V&V only, and its pages stay hidden until a
  // project is picked, so /quality goes straight to V&V before anything renders.
  // Temporary: the data quality engine's own page is to live at /quality.
  redirects() {
    return [{ source: "/quality", destination: "/quality/vv", permanent: false }];
  },
  turbopack: {
    rules: {
      // YAML imports as its parsed document (src/lib/journey/journey.yaml).
      "*.yaml": { loaders: ["./loaders/yaml-loader.cjs"], as: "*.js" },
    },
  },
};

export default nextConfig;
