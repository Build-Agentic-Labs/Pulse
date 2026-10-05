import base from '../../../playwright.config';
import { defineConfig } from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
 ...base,testDir:'.',testMatch:'reorder.browser.spec.ts',
 use:{...base.use,baseURL:'http://127.0.0.1:3214'},
 webServer:{command:'npm run start -- --hostname 127.0.0.1 --port 3214',url:'http://127.0.0.1:3214/awi',
 cwd:resolve(__dirname,'../../..'),reuseExistingServer:false,timeout:60000},
});
