(() => {
  'use strict';
  function seconds(value) {
    const text = String(value).trim();
    if (!/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(text)) return null;
    return text.split(':').reduce((n, part) => n * 60 + Number(part), 0);
  }
  function canAdvance(viewed, required, mediaFinished = true) {
    const goal = seconds(required);
    return Number.isFinite(viewed) && goal !== null && goal > 0 && viewed >= goal && mediaFinished;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { seconds, canAdvance };
    return;
  }
  if (window.top !== window || location.origin !== 'https://sysaq.sdu.edu.cn' ||
      !location.pathname.startsWith('/lab-study-front/') || !window.chrome?.webview) return;

  let config = { paused: true };
  let heartbeatAt = 0;
  let path = '';
  let viewed = 0;
  let lastTick = performance.now();
  let stableSince = 0;
  let fingerprint = '';
  let pendingAt = 0;
  let pendingPath = '';
  let lastStatus = '';
  let pauseReason = '';
  let played = null;
  const visited = new Set(); // Session navigation history only, never a school completion record.
  const attemptedPages = new Set();
  const visible = el => Boolean(el && el.getClientRects().length);
  const buttons = text => [...document.querySelectorAll('button')]
    .filter(el => visible(el) && !el.disabled && el.textContent.trim() === text);
  function tell(text) {
    if (text === lastStatus) return;
    lastStatus = text;
    window.chrome.webview.postMessage('STATUS:' + text);
  }
  function stop(text) {
    config.paused = true;
    pauseReason = text;
    tell(text);
    window.chrome.webview.postMessage('PAUSE');
  }
  window.chrome.webview.addEventListener('message', event => {
    if (typeof event.data?.paused !== 'boolean') return;
    config = event.data;
    if (!config.paused) pauseReason = '';
    heartbeatAt = performance.now();
  });

  function navigate(button) {
    pendingPath = location.pathname;
    pendingAt = performance.now();
    button.click();
  }
  function goalsMet(text) {
    const re = /(\d+:\d{2}:\d{2})\s*\/\s*(\d+:\d{2}:\d{2})\s*(必学时长|选学时长)/g;
    const goals = [...text.matchAll(re)];
    return goals.length === 2 && goals.some(m => seconds(m[2]) > 0) &&
      goals.every(m => seconds(m[1]) !== null && seconds(m[2]) !== null && seconds(m[1]) >= seconds(m[2]));
  }

  // ponytail: Poll the rendered DOM once a second; update selectors if the school redesigns the site.
  setInterval(() => {
    try {
      const now = performance.now();
      const delta = Math.max(0, (now - lastTick) / 1000);
      lastTick = now;
      if (path !== location.pathname) {
        path = location.pathname;
        viewed = 0;
        stableSince = now;
        fingerprint = '';
        pendingAt = 0;
        played = null;
      }
      if (config.paused) { tell(pauseReason || '自动导航已暂停。按 F8 继续；网页本身的学习计时仍由学校控制。'); return; }
      if (now - heartbeatAt > 2000) {
        tell('应用连接中断，自动切课已暂停。连接恢复后继续。');
        return;
      }
      if (pendingAt) {
        if (now - pendingAt > 20000 && path === pendingPath) {
          pendingAt = 0;
          stop('页面未按预期跳转，已暂停。请检查原站提示后按 F8 重试。');
        }
        return;
      }
      if (now - stableSince < 4000) { tell('等待网站内容加载…'); return; }

      if (path === '/lab-study-front/person') {
        const choices = buttons('去学习');
        if (choices.length === 1) { navigate(choices[0]); tell('正在打开学习任务…'); }
        else tell(choices.length ? '发现多个学习任务，请使用键盘在原站选择目标任务。' : '等待登录或课程加载。请完成学校登录后继续。');
        return;
      }
      const task = path.match(/^\/lab-study-front\/examTask\/(\d+)\/?$/);
      const detail = path.match(/^\/lab-study-front\/examTask\/(\d+)\/\d+\/\d+\/\d+\/?$/);
      if (!task && !detail) { tell('当前页面不在已适配的课程范围，等待返回个人中心。'); return; }
      if (goalsMet(document.body.innerText)) { stop('网站显示必学/选学时长要求已满足。自动导航已停止，请本人核对并参加考试。'); return; }

      if (task) {
        const choices = buttons('去学习');
        for (const button of choices) {
          const row = button.closest('tr');
          if (!row) continue;
          const name = row.querySelector('td')?.textContent.trim();
          const timing = row.innerText.match(/已学习[：:]?\s*(\d+:\d{2}:\d{2})\s*\/\s*(\d+:\d{2}:\d{2})/);
          if (!name || !timing || visited.has(task[1] + ':' + name)) continue;
          if (seconds(timing[1]) === null || seconds(timing[2]) === null) continue;
          if (seconds(timing[1]) >= seconds(timing[2])) continue;
          navigate(button);
          tell('正在打开：' + name);
          return;
        }
        const pageKey = task[1] + ':' + choices.map(b => b.closest('tr')?.innerText).join('|');
        const nextPage = document.querySelector('.ivu-page-next');
        if (visible(nextPage) && !nextPage.classList.contains('ivu-page-disabled') && !attemptedPages.has(pageKey)) {
          attemptedPages.add(pageKey);
          nextPage.click();
          stableSince = now;
          tell('正在查看下一页课程…');
          return;
        }
        if (!document.body.innerText.includes('暂无数据') && now - stableSince < 30000) {
          tell('正在等待未学课程列表加载…');
          return;
        }
        stop('未找到新的未学课程。列表可能仍在加载，或学时尚未同步；请在原站核对。');
        return;
      }

      const active = document.querySelector('.panelItem.activeitem');
      const timer = document.querySelector('.positionRight');
      const elapsed = timer?.querySelector('.alredyTime')?.textContent.trim();
      const required = timer?.querySelector('.allTime')?.textContent.trim();
      const article = document.querySelector('#nav');
      const video = [...document.querySelectorAll('video')].find(visible);
      const content = article?.innerText.trim() || '';
      if (!active || seconds(elapsed) === null || seconds(required) === null || (!visible(video) && (!visible(article) || content.length < 20))) {
        tell('等待可识别的正文/视频和原站计时器；未知页面不会自动跳过。');
        return;
      }
      const currentFingerprint = active.textContent.trim() + ':' + content.length + ':' + (video?.currentSrc || '');
      if (fingerprint !== currentFingerprint) {
        fingerprint = currentFingerprint;
        viewed = 0;
        stableSince = now;
        return;
      }
      if (video) {
        if (video.playbackRate !== 1) { stop('请恢复视频原速播放后按 F8 继续。'); return; }
        if (played !== video) {
          played = video;
          video.play().catch(() => stop('浏览器未允许视频自动播放。请用键盘启动原站播放器，再按 F8 继续。'));
        }
        if (!video.ended && (video.paused || video.seeking || video.readyState < 3)) {
          tell('等待视频正常播放。暂停或缓冲时不切换课程。');
          return;
        }
      }
      viewed += delta;
      const remaining = Math.max(0, Math.ceil(seconds(required) - viewed));
      tell('当前课要求 ' + required + '；自动切换剩余约 ' + remaining + ' 秒。请自行阅读，F8 可暂停切换。');
      if (!canAdvance(viewed, required, !video || video.ended)) return;
      const name = active.textContent.trim().replace(/^(必学|选学)\s*/, '').trim();
      const back = [...document.querySelectorAll('button')].find(b => visible(b) && !b.disabled && /返回/.test(b.textContent));
      if (!back) { stop('未找到原站返回按钮，已暂停。'); return; }
      visited.add(detail[1] + ':' + name);
      navigate(back);
      tell('本页展示时间及原站时长已达到要求，正在选择下一项。');
    } catch (error) {
      stop('页面结构发生变化，自动导航已暂停：' + error.name);
    }
  }, 1000);
})();
