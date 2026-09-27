(() => {
  'use strict';
  const MIN_VIEW_SECONDS = 130;

  function seconds(value) {
    const text = String(value).trim();
    if (!/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(text)) return null;
    return text.split(':').reduce((n, part) => n * 60 + Number(part), 0);
  }
  function canAdvance(viewed, elapsed, required, mediaFinished = true) {
    const done = seconds(elapsed), goal = seconds(required);
    return Number.isFinite(viewed) && viewed >= MIN_VIEW_SECONDS &&
      done !== null && goal !== null && goal > 0 && done >= goal && mediaFinished;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { seconds, canAdvance };
    return;
  }
  if (window.top !== window || location.origin !== 'https://sysaq.sdu.edu.cn' ||
      !location.pathname.startsWith('/lab-study-front/') || !window.chrome?.webview) return;

  let config = { paused: true, active: false };
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
    if (typeof event.data?.paused !== 'boolean' || typeof event.data?.active !== 'boolean') return;
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
    const re = /(\d+:\d{2}:\d{2})\s*\/\s*(\d+:\d{2}:\d{2})\s*(��ѧʱ��|ѡѧʱ��)/g;
    const goals = [...text.matchAll(re)];
    return goals.length === 2 && goals.some(m => seconds(m[2]) > 0) &&
      goals.every(m => seconds(m[1]) !== null && seconds(m[2]) !== null && seconds(m[1]) >= seconds(m[2]));
  }

  // ponytail: Poll the rendered DOM once a second; update selectors if the school redesigns the site.
  setInterval(() => {
    try {
      const now = performance.now();
      const delta = Math.min(1.5, Math.max(0, (now - lastTick) / 1000));
      lastTick = now;
      if (path !== location.pathname) {
        path = location.pathname;
        viewed = 0;
        stableSince = now;
        fingerprint = '';
        pendingAt = 0;
        played = null;
      }
      if (config.paused) { tell(pauseReason || '�Զ���������ͣ���� F8 ��������ҳ������ѧϰ��ʱ����ѧУ���ơ�'); return; }
      if (!config.active || document.hidden || now - heartbeatAt > 2000) {
        tell('�����ں�̨���Զ��пμ�����չʾ��ʱ����ͣ������Ӧ�ú������');
        return;
      }
      if (pendingAt) {
        if (now - pendingAt > 20000 && path === pendingPath) {
          pendingAt = 0;
          stop('ҳ��δ��Ԥ����ת������ͣ������ԭվ��ʾ�� F8 ���ԡ�');
        }
        return;
      }
      if (now - stableSince < 4000) { tell('�ȴ���վ���ݼ��ء�'); return; }

      if (path === '/lab-study-front/person') {
        const choices = buttons('ȥѧϰ');
        if (choices.length === 1) { navigate(choices[0]); tell('���ڴ�ѧϰ����'); }
        else tell(choices.length ? '���ֶ��ѧϰ������ʹ�ü�����ԭվѡ��Ŀ������' : '�ȴ���¼��γ̼��ء������ѧУ��¼�������');
        return;
      }
      const task = path.match(/^\/lab-study-front\/examTask\/(\d+)\/?$/);
      const detail = path.match(/^\/lab-study-front\/examTask\/(\d+)\/\d+\/\d+\/\d+\/?$/);
      if (!task && !detail) { tell('��ǰҳ�治��������Ŀγ̷�Χ���ȴ����ظ������ġ�'); return; }
      if (goalsMet(document.body.innerText)) { stop('��վ��ʾ��ѧ/ѡѧʱ��Ҫ�������㡣�Զ�������ֹͣ���뱾�˺˶Բ��μӿ��ԡ�'); return; }

      if (task) {
        const choices = buttons('ȥѧϰ');
        for (const button of choices) {
          const row = button.closest('tr');
          if (!row) continue;
          const name = row.querySelector('td')?.textContent.trim();
          const timing = row.innerText.match(/��ѧϰ[��:]?\s*(\d+:\d{2}:\d{2})\s*\/\s*(\d+:\d{2}:\d{2})/);
          if (!name || !timing || visited.has(task[1] + ':' + name)) continue;
          if (seconds(timing[1]) === null || seconds(timing[2]) === null) continue;
          if (seconds(timing[1]) >= seconds(timing[2])) continue;
          navigate(button);
          tell('���ڴ򿪣�' + name);
          return;
        }
        const pageKey = task[1] + ':' + choices.map(b => b.closest('tr')?.innerText).join('|');
        const nextPage = document.querySelector('.ivu-page-next');
        if (choices.length && visible(nextPage) && !nextPage.classList.contains('ivu-page-disabled') && !attemptedPages.has(pageKey)) {
          attemptedPages.add(pageKey);
          nextPage.click();
          stableSince = now;
          tell('���ڲ鿴��һҳ�γ̡�');
          return;
        }
        stop('��ǰ�б�û�п�ʶ���δѧ�γ̡�ѧʱ�����ӳ� 5 ���Ӹ��£�����ԭվ�˶ԡ�');
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
        tell('�ȴ���ʶ�������/��Ƶ��ԭվ��ʱ����δ֪ҳ�治���Զ�������');
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
        if (video.playbackRate !== 1) { stop('��ָ���Ƶԭ�ٲ��ź� F8 ������'); return; }
        if (played !== video) {
          played = video;
          video.play().catch(() => stop('�����δ������Ƶ�Զ����š����ü�������ԭվ���������ٰ� F8 ������'));
        }
        if (!video.ended && (video.paused || video.seeking || video.readyState < 3)) {
          tell('�ȴ���Ƶ�������š���ͣ�򻺳�ʱ���л��γ̡�');
          return;
        }
      }
      viewed += delta;
      const remaining = Math.max(0, Math.ceil(MIN_VIEW_SECONDS - viewed));
      tell('��ǰҳչʾʣ�� ' + remaining + ' �룻��վ��ѧϰ ' + elapsed + ' / Ҫ�� ' + required + '���������Ķ���F8 ����ͣ�л���');
      if (!canAdvance(viewed, elapsed, required, !video || video.ended)) return;
      const name = active.textContent.trim().replace(/^(��ѧ|ѡѧ)\s*/, '').trim();
      const back = [...document.querySelectorAll('button')].find(b => visible(b) && !b.disabled && /����/.test(b.textContent));
      if (!back) { stop('δ�ҵ�ԭվ���ذ�ť������ͣ��'); return; }
      visited.add(detail[1] + ':' + name);
      navigate(back);
      tell('��ҳչʾʱ�估ԭվʱ���ѴﵽҪ������ѡ����һ�');
    } catch (error) {
      stop('ҳ��ṹ�����仯���Զ���������ͣ��' + error.name);
    }
  }, 1000);
})();
