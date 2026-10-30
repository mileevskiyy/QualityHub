import { defineConfig } from '@playwright/test';
export default defineConfig({
 retries:2,
 reporter:[['list'],['./integrations/playwright-reporter.ts']],
});
