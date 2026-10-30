import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests/e2e',use:{baseURL:'http://127.0.0.1:3100'},webServer:{command:`SEED_DEMO=false DATA_DIR=data/e2e-${Date.now()} PORT=3100 npm start`,url:'http://127.0.0.1:3100/api/health',reuseExistingServer:false},reporter:'html' });
