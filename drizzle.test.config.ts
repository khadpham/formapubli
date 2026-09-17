import { defineConfig } from 'drizzle-kit';

// Config RIÊNG cho DB kiểm thử cách ly — không bao giờ đụng production.
// Dùng: npx drizzle-kit migrate --config drizzle.test.config.ts
// File DB test lấy từ TEST_DATABASE_FILE (mặc định formapubli_test.db).
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: `file:${process.env.TEST_DATABASE_FILE || 'formapubli_test.db'}`,
  },
});
