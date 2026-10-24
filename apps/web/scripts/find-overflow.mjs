import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844 });
await p.goto('http://localhost:3000' + (process.argv[2] ?? '/register'), { waitUntil: 'networkidle0' });
const out = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).slice(0, 8).map((e) => `${e.tagName}.${(e.className?.baseVal ?? e.className).toString().slice(0, 90)} right=${Math.round(e.getBoundingClientRect().right)}`));
console.log(out.join('\n') || 'none');
await b.close();
