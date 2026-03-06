import { chromium } from 'playwright';
import jwt from 'jsonwebtoken';

const token = jwt.sign({ userId: 'debug-user', role: 'admin', platform: 'web' }, '8f4b2c9e7a1d5f3b6e8c0a2d4f7b9e1c3a5d6f8e0b2c4a7d9e1f3b5c6a8d0e2f', { expiresIn: '24h' });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', msg => console.log('[console]', msg.type(), msg.text()));
page.on('pageerror', err => console.log('[pageerror]', err.message));
await page.goto('http://127.0.0.1:3000/login');
await page.evaluate((t) => localStorage.setItem('token', t), token);
await page.goto('http://127.0.0.1:3000/tasks', { waitUntil: 'networkidle' });
await page.fill('input[placeholder="添加新任务..."]', '测试任务-手动添加');
await page.click('button:has-text("添加")');
await page.waitForTimeout(800);
const visible = await page.locator('text=测试任务-手动添加').count();
console.log('visible_count', visible);
await page.screenshot({ path: '/www/wwwroot/ClawdAgent/tmp-tasks-after-add.png', fullPage: true });
await browser.close();
