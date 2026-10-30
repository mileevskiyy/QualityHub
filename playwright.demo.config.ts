import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/demo-browser',use:{baseURL:process.env.DEMO_URL||'http://127.0.0.1:3100'},webServer:process.env.DEMO_URL?undefined:{command:'PUBLIC_DEMO=true PORT=3100 npm start',url:'http://127.0.0.1:3100/api/health',reuseExistingServer:false},reporter:'list'});
