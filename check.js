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
  const window = { chrome: { webview: { postMessage: m => { messages.push(m); if (m === 'PAUSE') view.paused = true; }, addEventListener: (_, fn) => { onMessage = fn; } } } };
  window.top = window;
  vm.runInNewContext(source, { window, location: page, document, performance: { now: () => now }, setInterval: fn => { tick = fn; } });
  return {
    view, document, required, elapsed, article, page, messages,
    get clicks() { return clicks; },
    jump(milliseconds) { now += milliseconds; },
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

const resume = fixture();
resume.run(50);
resume.view.paused = true;
resume.run(1);
resume.jump(300000);
resume.view.paused = false;
resume.run(1);
assert.equal(resume.clicks, 0, 'paused time is not counted when timers resume');
resume.run(100);
assert.equal(resume.clicks, 1, 'resume preserves previously accumulated viewing time');

function courseList(f) {
  const originalOne = f.document.querySelector;
  const originalAll = f.document.querySelectorAll;
  const list = { rows: [], next: 0, opened: [], page: '1' };
  const next = { getClientRects: () => [1], getAttribute: () => null, classList: { contains: () => false }, click: () => { list.next++; } };
  f.document.querySelector = q => q === '.ivu-page-next' ? next : q === '.ivu-page-item-active' ? { textContent: list.page } : originalOne(q);
  f.document.querySelectorAll = q => f.page.pathname === '/lab-study-front/examTask/1' && q === 'button' ? list.rows : originalAll(q);
  list.row = (name, time) => {
    const row = { innerText: name + ' 已学习：' + time, querySelector: () => ({ textContent: name }) };
    return { textContent: '去学习', getClientRects: () => [1], closest: () => row, click: () => { list.opened.push(name); f.page.pathname = '/lab-study-front/examTask/1/2/1/5'; } };
  };
  f.page.pathname = '/lab-study-front/examTask/1';
  return list;
}
const empty = fixture();
const emptyList = courseList(empty);
empty.run(20);
assert.equal(emptyList.next, 0, 'never skip an empty loading page');
emptyList.rows = [emptyList.row('完整课程', '02:10 / 02:10'), emptyList.row(' 新   课程 ', '00:00 / 02:10')];
empty.run(5);
assert.deepEqual(emptyList.opened, [' 新   课程 '], 'skip completed and choose unfinished course');
empty.run(145);
assert.equal(empty.clicks, 1);
empty.page.pathname = '/lab-study-front/examTask/1';
empty.run(10);
assert.equal(emptyList.opened.length, 1, 'use list identity even when sidebar title differs');
assert.equal(emptyList.next, 1, 'move to next page after successful return');
empty.run(25);
assert.equal(emptyList.next, 1, 'stalled pagination never repeatedly clicks');
assert.equal(empty.view.paused, true);
empty.view.paused = false;
empty.run(5);
assert.equal(emptyList.next, 2, 'F8 can retry failed pagination');
emptyList.page = '2';
emptyList.rows = [emptyList.row('下一页', '00:00:00 / 00:05:00')];
empty.run(8);
assert.equal(emptyList.opened.at(-1), '下一页');

const unknown = fixture();
const unknownList = courseList(unknown);
unknownList.rows = [unknownList.row('未识别', '加载中')];
unknown.run(40);
assert.equal(unknownList.next, 0, 'unrecognized durations must not be skipped by pagination');
assert.equal(unknown.view.paused, true);

const retry = fixture();
const retryList = courseList(retry);
retryList.rows = [retryList.row('待返回', '00:00 / 02:10')];
retry.run(180);
assert.equal(retry.clicks, 1);
retry.view.paused = false;
retry.run(1);
assert.equal(retry.clicks, 2, 'failed return is retryable');
console.log('PASS: pause/resume, loading lists, course identity, pagination timeout/retry, failed return');

const videoPage = fixture();
const video = { playbackRate: 1, currentSrc: 'offline-video', ended: false, paused: false, seeking: false, readyState: 4, getClientRects: () => [1], play: () => Promise.resolve() };
const videoQueries = videoPage.document.querySelectorAll;
videoPage.document.querySelectorAll = q => q === 'video' ? [video] : videoQueries(q);
videoPage.run(150);
assert.equal(videoPage.clicks, 0, 'duration alone cannot skip an unfinished video');
video.ended = true;
videoPage.run(1);
assert.equal(videoPage.clicks, 1, 'completed video can advance');
const finished = fixture();
finished.document.body.innerText = '00:05:00 / 00:05:00 必学时长 00:10:00 / 00:10:00 选学时长';
finished.run(10);
assert.equal(finished.view.paused, true, 'site goals stop navigation');
assert.equal(finished.clicks, 0);
console.log('PASS: video end and site goal stop');
