import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
 resolve: { alias: { '@': fileURLToPath(new URL('../../../src', import.meta.url)) } },
 test: { include: ['supabase/isolated/2026-10-04-task-reorder/reorder.integration.test.ts'], testTimeout: 30000 },
});
