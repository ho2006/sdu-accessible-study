'use strict';
const assert = require('node:assert/strict');
const { seconds, canAdvance } = require('./reader.js');
assert.equal(seconds(' 02:10 '), 130);
assert.equal(seconds('01:00:00'), 3600);
for (const value of ['', '加载中', '02:60', undefined, '-01:00', '00:00abc']) assert.equal(seconds(value), null);
assert.equal(canAdvance(129.9, '02:10'), false);
assert.equal(canAdvance(130, '02:10'), true);
assert.equal(canAdvance(130, '05:00'), false);
assert.equal(canAdvance(300, '05:00'), true);
assert.equal(canAdvance(300, '05:00', false), false);
assert.equal(canAdvance(130, ''), false);
assert.equal(canAdvance(130, '00:00'), false);
assert.equal(canAdvance(Infinity, '02:00'), false);
console.log('PASS: time parsing, exact course duration, video completion, missing data');

// Run the real browser script with a tiny offline DOM and a controlled clock.
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('./reader.js'), 'utf8');
function fixture() {
  let now = 0, tick, onMessage, clicks = 0;
  const messages = [];
  const view = { paused: false };
  const page = { pathname: '/lab-study-front/examTask/1/2/1/5', origin: 'https://sysaq.sdu.edu.cn' };
  const active = { textContent: '选学 测试课程' };
  const article = { innerText: '这是用于离线验证导航的模拟课程内容，不连接学校平台或产生学时。', getClientRects: () => [1] };
  const elapsed = { textContent: '02:10' };
  const required = { textContent: '02:10' };
  const timer = { querySelector: q => q === '.alredyTime' ? elapsed : required };
  const back = { textContent: '返回', disabled: false, getClientRects: () => [1], click: () => { clicks++; } };
  const document = {
    hidden: false, body: { innerText: '' },
    querySelector: q => ({ '.panelItem.activeitem': active, '.positionRight': timer, '#nav': article }[q] || null),
    querySelectorAll: q => q === 'button' ? [back] : [],
  };
  const window = { chrome: { webview: { postMessage: m => messages.push(m), addEventListener: (_, fn) => { onMessage = fn; } } } };
  window.top = window;
  vm.runInNewContext(source, { window, location: page, document, performance: { now: () => now }, setInterval: fn => { tick = fn; } });
  return {
    view, document, required, elapsed, article, page, messages,
    get clicks() { return clicks; },
    run(count, sendHeartbeat = true) {
      for (let i = 0; i < count; i++) {
        now += 1000;
        if (sendHeartbeat) onMessage({ data: view });
        tick();
      }
    },
  };
}
const normal = fixture();
normal.run(130);
assert.equal(normal.clicks, 0, 'load stabilization is excluded from viewing time');
normal.run(10);
assert.equal(normal.clicks, 1, 'automatically navigates after full viewing time');
normal.run(5);
assert.equal(normal.clicks, 1, 'does not double-click during navigation');
const longer = fixture();
longer.required.textContent = '05:00';
longer.run(250);
assert.equal(longer.clicks, 0, 'does not switch before a longer course duration');
longer.run(60);
assert.equal(longer.clicks, 1, 'switches at the course duration without waiting for a delayed site counter');
for (const mode of ['paused', 'disconnected']) {
  const f = fixture();
  f.run(10);
  if (mode === 'paused') f.view.paused = true;
  if (mode === 'background') f.view.active = false;
  if (mode === 'hidden') f.document.hidden = true;
  f.run(200, mode !== 'disconnected');
  assert.equal(f.clicks, 0, mode + ' must not advance');
}
const background = fixture();
background.run(10);
background.view.active = false;
background.document.hidden = true;
background.run(150);
assert.equal(background.clicks, 1, 'timed navigation continues while the app is in the background');
const loading = fixture();
loading.article.innerText = '';
loading.run(200);
assert.equal(loading.clicks, 0, 'missing content must not advance');
console.log('PASS: event loop, delayed page load, course-specific duration, background timer, pause/disconnect');
