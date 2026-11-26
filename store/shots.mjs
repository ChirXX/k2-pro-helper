// Рендер графики для Google Play: иконка, баннер, скриншоты телефона 1080×1920.
// Запускается в GitHub Actions (workflow store-graphics.yml).
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'store', 'out');
mkdirSync(out, { recursive: true });
const url = f => pathToFileURL(path.join(root, f)).href;
const ANDROID_FONT = `*{font-family:Roboto,"Noto Sans","Noto Color Emoji",sans-serif!important}`;

const browser = await chromium.launch();

// --- иконка и баннер ---
{
  const p = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await p.goto(url('store/icon.html'));
  await p.screenshot({ path: path.join(out, 'icon-512.png') });
  await p.setViewportSize({ width: 1024, height: 500 });
  await p.goto(url('store/feature.html'));
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, 'feature-1024x500.png') });
  await p.close();
}

// --- скриншоты приложения ---
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ru-RU', reducedMotion: 'reduce' });
// Ленты YouTube: в браузере их блокирует CORS, поэтому отдаём их через node (на телефоне это делает Capacitor HTTP)
await ctx.route('https://www.youtube.com/feeds/**', async route => {
  const r = await route.fetch();
  await route.fulfill({ response: r, headers: { ...r.headers(), 'access-control-allow-origin': '*' } });
});
const page = await ctx.newPage();
await page.goto(url('www/index.html'));
await page.addStyleTag({ content: ANDROID_FONT + ` #toast{display:none}` });
const js = s => page.evaluate(s);
const shot = async (name, wait = 500) => { await page.waitForTimeout(wait); await page.screenshot({ path: path.join(out, name) }); console.log('saved', name); };

// подготовим «живые» данные: часть ухода выполнена, одна заметка
await js(() => {
  const d = new Date().toLocaleDateString('ru-RU');
  localStorage.setItem('k2care', JSON.stringify({ each0: d, each1: d, week0: d }));
  localStorage.setItem('k2notes', JSON.stringify([{ t: 'PETG чёрный', b: 'Сопло 240 °C, стол 75 °C, обдув 40 %. Сушить 4 ч при 65 °C перед печатью.', d }]));
});
await page.reload();
await page.addStyleTag({ content: ANDROID_FONT + ` #toast{display:none}` });

await shot('1-problems.png');

await js(() => { const q = document.getElementById('q'); q.value = 'паутина'; q.dispatchEvent(new Event('input'));
  document.querySelector('#plist .card-h').click(); window.scrollTo(0, document.querySelector('#plist').offsetTop - 70); });
await shot('2-problem-open.png');

await js(() => { go('s-printers'); document.querySelector('#prlist .card-h').click(); });
await shot('3-printers.png');

await js(() => { go('s-materials'); });
await shot('4-materials.png');

await js(() => { go('s-video'); });
await page.waitForFunction(() => document.querySelectorAll('#vlist .vid').length >= 5, null, { timeout: 30000 }).catch(() => console.log('video feed not loaded'));
await page.waitForTimeout(2500); // превью
await shot('5-video.png', 0);

await js(() => { go('s-my'); });
await shot('6-care.png');

await browser.close();
