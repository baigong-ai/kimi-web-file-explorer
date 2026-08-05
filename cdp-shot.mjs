#!/usr/bin/env node
// cdp-shot.mjs — drive headless Chrome via CDP: open the patched kimi web
// portal, click the Files (folder) header button, expand a directory, open a
// file, and screenshot each step.
// Usage: node cdp-shot.mjs <url> <outPrefix> [clickDirName] [clickFileName]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, outPrefix, dirName, fileName] = process.argv.slice(2);
if (!url || !outPrefix) {
  console.error('usage: node cdp-shot.mjs <url> <outPrefix> [dir] [file]');
  process.exit(1);
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9222;
const userDir = mkdtempSync(join(tmpdir(), 'kshot-'));

// Re-create the same-origin seed page in the newest dist-web cache (apply.sh
// / server restarts wipe it). It sets localStorage flags then redirects,
// carrying the #token fragment.
{
  const { execSync } = await import('node:child_process');
  const cacheRoot = `${process.env.HOME}/Library/Caches/kimi-code/web`;
  const target = execSync(
    `find "${cacheRoot}" -type d -name dist-web -exec stat -f '%m %N' {} \\; | sort -rn | head -1 | cut -d' ' -f2-`,
  ).toString().trim();
  if (target) {
    writeFileSync(
      join(target, 'seed.html'),
      `<script>try{localStorage.setItem('kimi-web.onboarded','1');localStorage.setItem('kimi-web.color-scheme','dark');}catch(e){}location.replace('/'+location.hash);</script>`,
    );
  }
}

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`,
  '--window-size=1680,1050',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('chrome devtools not reachable');
}

let msgId = 0;
const pending = new Map();
const ws = new WebSocket(await getWsUrl());
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
await new Promise((r) => { ws.onopen = r; });

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
}

async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outPrefix}-${name}.png`, Buffer.from(res.result.data, 'base64'));
  console.log(`saved ${outPrefix}-${name}.png`);
}

await send('Page.enable');
await send('Runtime.enable');

// 1. Seed onboarding/dark-mode flags via the same-origin seed page, carrying
//    the #token fragment through the redirect.
const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
const base = new URL(url);
await send('Page.navigate', { url: `${base.origin}/seed.html${hash}` });
await sleep(4000);

// 2. Open the real page.
await send('Page.navigate', { url });
await sleep(9000);
await shot('1-session');

// 3. Click the Files header button.
const clicked = await evalJs(`(() => {
  const btn = document.querySelector('.ch-files');
  if (!btn) return 'no-button';
  btn.click();
  return 'ok';
})()`);
console.log('files button:', clicked);
await sleep(2500);
await shot('2-files-panel');

// 4. Optionally expand a directory and open a file inside the tree.
if (dirName) {
  const r1 = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('.ft-row')];
    const row = rows.find((r) => r.querySelector('.ft-name')?.textContent === ${JSON.stringify(dirName)});
    if (!row) return 'no-dir:' + rows.map((r) => r.textContent.trim()).join(',');
    row.click();
    return 'ok';
  })()`);
  console.log('expand dir:', r1);
  await sleep(2000);
  await shot('3-dir-expanded');
}
if (fileName) {
  const r2 = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('.ft-row')];
    const row = rows.find((r) => r.querySelector('.ft-name')?.textContent === ${JSON.stringify(fileName)});
    if (!row) return 'no-file';
    row.click();
    return 'ok';
  })()`);
  console.log('open file:', r2);
  await sleep(3000);
  await shot('4-file-preview');
}

ws.close();
chrome.kill('SIGKILL');
process.exit(0);
