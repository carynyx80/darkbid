/** @type {import('next').NextConfig} */
const api = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  // The launch feed is served from the site's own address, so feed readers never contact the API directly.
  async rewrites() {
    return api ? [{ source: "/feed.xml", destination: `${api}/projects/feed.xml` }] : [];
  },
};

export default nextConfig;
