import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// formapubli: app full-dynamic (force-dynamic mọi API route), không dùng ISR/SSG
// nên giữ config tối giản — không R2 incremental cache (YAGNI).
export default defineCloudflareConfig({});
