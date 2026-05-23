/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.1.12", "192.168.0.0/16", "10.0.0.0/8"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "fal.media" },
      { protocol: "https", hostname: "v2.fal.media" },
      { protocol: "https", hostname: "v3.fal.media" },
      { protocol: "https", hostname: "*.fal.media" },
      { protocol: "https", hostname: "**.shopify.com" },
      { protocol: "https", hostname: "**.shopifycdn.com" },
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
    ],
  },
  async headers() {
    return [
      {
        // Allow embedding /embed in iframes from any origin (Shopify, etc.)
        source: "/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
      {
        source: "/embed/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
      {
        // Embed loader script — public, cached briefly, CORS open
        source: "/embed.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
