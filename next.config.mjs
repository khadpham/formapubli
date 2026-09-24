/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // OpenNext Cloudflare: copy FULL @libsql/* (kèm lib-esm/web.js cho
  // workerd condition) vào worker bundle thay vì để esbuild trace thiếu file.
  // Key experimental.* vì Next 14 (adapter đọc đúng key này).
  // Mục '\' kép defensiveness cho Windows: adapter so khớp chuỗi tuyệt đối,
  // trên Windows pkg capture ra '@libsql\...' (backslash) nên mục gạch
  // chéo xuôi không khớp và bản copy workerd bị bỏ qua trong im lặng.
  experimental: {
    serverComponentsExternalPackages: [
      '@libsql/client',
      '@libsql\\client',
      '@libsql/core',
      '@libsql\\core',
      '@libsql/hrana-client',
      '@libsql\\hrana-client',
      '@libsql/isomorphic-ws',
      '@libsql\\isomorphic-ws',
      '@libsql/isomorphic-fetch',
      '@libsql\\isomorphic-fetch',
    ],
  },
};

export default nextConfig;

// OpenNext Cloudflare: tích hợp bindings khi dev local (không ảnh hưởng build).
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();
