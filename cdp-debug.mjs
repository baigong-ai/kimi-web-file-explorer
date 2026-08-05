#!/usr/bin/env node
// cdp-debug.mjs — load a page in headless Chrome, capture console errors and
// uncaught exceptions, dump #app innerHTML size, then screenshot.
// Usage: node cdp-debug.mjs <url> <shotPath>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, shotPath] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9223;
const userDir = mkdtempSync(join(tmpdir(), 'kdbg-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`,
  '--window-size=1680,1050',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('devtools not reachable');
}

let msgId = 0;
const pending = new Map();
const ws = new WebSocket(await getWsUrl());
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 800));
  } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(msg.params.type.toUpperCase() + ': ' +
      msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500));
  } else if (msg.method === 'Network.loadingFailed') {
    logs.push('NETFAIL: ' + JSON.stringify(msg.params).slice(0, 300));
  } else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
    logs.push(`HTTP ${msg.params.response.status}: ${msg.params.response.url}`);
  }
};
await new Promise((r) => { ws.onopen = r; });

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Page.navigate', { url });
await sleep(12000);

const res = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    appHtmlLen: document.getElementById('app')?.innerHTML.length ?? -1,
    bodyText: document.body?.innerText?.slice(0, 300) ?? '',
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
  })`,
  returnByValue: true,
});
console.log('PAGE STATE:', res.result?.result?.value);
console.log('--- console/exceptions ---');
for (const l of logs) console.log(l);
console.log(`(${logs.length} entries)`);

if (shotPath) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', shotPath);
}
ws.close();
chrome.kill('SIGKILL');
process.exit(0);
