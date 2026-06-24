/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing FlagDeck's compiled output from outside this app directory
  // (../../dist) so the demo reuses the real buildPanel/resolveUserAction/store.
  experimental: { externalDir: true },
};

export default nextConfig;
