(function classicPublicResultsModule() {
  'use strict';

  const MAX_VISIBLE = 200;

  function node(tagName, options, children) {
    const element = document.createElement(tagName);
    const settings = options || {};
    if (settings.className) element.className = settings.className;
    if (settings.id) element.id = settings.id;
    if (settings.text !== undefined) element.textContent = String(settings.text);
    if (settings.attrs) {
      Object.keys(settings.attrs).forEach(function setAttribute(name) {
        const value = settings.attrs[name];
        if (value !== null && value !== undefined && value !== false) {
          element.setAttribute(name, value === true ? '' : String(value));
        }
      });
    }
    (children || []).forEach(function append(child) {
      if (child !== null && child !== undefined) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return element;
  }

  function config() {
    return window.HANA_BACKEND_CONFIG || window.HANA_BACKEND || {};
  }

  function backendUrl() {
    return String(config().webAppUrl || config().url || '').trim();
  }

  function backendTimeout() {
    const value = Number(config().requestTimeoutMs);
    return Math.min(60000, Math.max(5000, Number.isFinite(value) ? value : 30000));
  }

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function safeParse(value) {
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function callBackend(action, payload) {
    const url = backendUrl();
    if (!url) return Promise.reject(Object.assign(new Error('Chưa kết nối Google Apps Script.'), { code: 'BACKEND_NOT_CONFIGURED' }));
    if (!/^https:\/\//i.test(url)) return Promise.reject(Object.assign(new Error('Đường dẫn Google Apps Script không hợp lệ.'), { code: 'BACKEND_URL_INVALID' }));
    const requestId = randomId();
    const frameName = 'hana-classic-' + requestId.replace(/[^a-zA-Z0-9_-]/g, '');

    return new Promise(function postThroughIframe(resolve, reject) {
      const frame = node('iframe', { attrs: { name: frameName, title: 'Kết nối bảng kết quả', 'aria-hidden': 'true' } });
      const form = node('form', { attrs: { method: 'post', action: url, target: frameName, enctype: 'application/x-www-form-urlencoded' } });
      frame.hidden = true;
      form.hidden = true;
      function hidden(name, value) {
        form.append(node('input', { attrs: { type: 'hidden', name: name, value: value } }));
      }
      hidden('action', action);
      hidden('payload', JSON.stringify(payload || {}));
      hidden('requestId', requestId);
      hidden('replyOrigin', window.location.origin);

      let settled = false;
      function cleanup() {
        window.removeEventListener('message', onMessage);
        window.clearTimeout(timeout);
        form.remove();
        frame.remove();
      }
      function finish(callback, value) {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      }
      function onMessage(event) {
        if (event.source !== frame.contentWindow) return;
        let message = event.data;
        if (typeof message === 'string') message = safeParse(message);
        if (!message || String(message.requestId || '') !== requestId) return;
        const result = message.result || message.payload || message.response || message;
        if (!result || result.ok === false) {
          const error = new Error((result && result.message) || 'Máy chủ từ chối yêu cầu.');
          error.code = (result && result.code) || 'BACKEND_ERROR';
          finish(reject, error);
        } else {
          finish(resolve, result);
        }
      }
      const timeout = window.setTimeout(function timeoutRequest() {
        finish(reject, Object.assign(new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại.'), { code: 'BACKEND_TIMEOUT' }));
      }, backendTimeout());
      window.addEventListener('message', onMessage);
      document.body.append(frame, form);
      try {
        form.submit();
      } catch (_) {
        finish(reject, Object.assign(new Error('Không thể gửi yêu cầu tới máy chủ.'), { code: 'BACKEND_UNREACHABLE' }));
      }
    });
  }

  function scoreText(value) {
    const number = Number(value);
    return (Number.isFinite(number) ? number : 0).toFixed(2).replace('.', ',').replace(/,00$/, '').replace(/(,\d)0$/, '$1');
  }

  function dateText(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Không rõ thời gian';
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(date);
    } catch (_) {
      return date.toLocaleString('vi-VN');
    }
  }

  function resultRow(record, showExam) {
    const rank = record.rank ? node('span', { className: 'public-result-rank', text: '#' + record.rank }) : null;
    const copy = node('div', { className: 'catalog-item-copy' }, [
      node('div', { className: 'public-result-name-row' }, [rank, node('h3', { text: record.candidateName || 'Người làm bài' })]),
      node('p', {
        className: 'catalog-meta',
        text: (showExam ? (record.examTitle || record.examId) + ' · ' : '') + dateText(record.submittedAt)
      }),
      node('p', {
        className: 'catalog-description',
        text: 'Phần I: ' + scoreText(record.mcScore) + ' · Phần II: ' + scoreText(record.tfScore) + ' · Phần III: ' + scoreText(record.shortScore)
      })
    ]);
    const score = node('div', { className: 'catalog-item-actions' }, [
      node('span', { className: 'status-badge status-open', text: scoreText(record.total) + ' / 10' })
    ]);
    return node('article', { className: 'catalog-item attempt-history-item public-result-item' }, [copy, score]);
  }

  function renderPanel(target, options) {
    if (!target) return Promise.resolve();
    const settings = options || {};
    target.replaceChildren();
    const heading = node('div', { className: 'panel-heading catalog-heading' }, [
      node('div', {}, [
        node('span', { className: 'eyebrow', text: 'Hiển thị cho tất cả mọi người' }),
        node('h2', { text: settings.title || 'Danh sách người đã làm' })
      ]),
      node('button', { className: 'btn btn-small btn-secondary', text: '↻ Làm mới', attrs: { type: 'button' } })
    ]);
    const list = node('div', { className: 'catalog-list attempt-history-list', attrs: { 'aria-live': 'polite' } });
    list.append(node('div', { className: 'loading-card', text: 'Đang tải danh sách công khai…' }));
    target.className = 'panel catalog-panel attempt-history public-results-panel';
    target.append(heading, list);

    const refreshButton = heading.querySelector('button');
    function load() {
      refreshButton.disabled = true;
      list.replaceChildren(node('div', { className: 'loading-card', text: 'Đang tải danh sách công khai…' }));
      return callBackend('listClassicResults', {
        subject: settings.subject || '',
        examId: settings.examId || '',
        limit: Math.min(MAX_VISIBLE, Math.max(1, Number(settings.limit) || 100))
      }).then(function show(response) {
        const records = Array.isArray(response.results) ? response.results : [];
        list.replaceChildren();
        if (!records.length) {
          list.append(node('div', { className: 'empty-state compact-empty' }, [
            node('span', { className: 'empty-state-icon', text: '◎' }),
            node('h3', { text: 'Chưa có người nộp bài' }),
            node('p', { text: 'Kết quả sẽ xuất hiện tại đây sau lần nộp đầu tiên.' })
          ]));
          return;
        }
        records.forEach(function add(record) { list.append(resultRow(record, !settings.examId)); });
      }).catch(function showError(error) {
        list.replaceChildren(node('div', { className: 'empty-state compact-empty' }, [
          node('span', { className: 'empty-state-icon', text: '!' }),
          node('h3', { text: 'Chưa tải được danh sách công khai' }),
          node('p', { text: error.code === 'BACKEND_NOT_CONFIGURED' ? 'Hãy cấu hình URL Google Apps Script trong backend-config.js.' : (error.message || 'Vui lòng thử lại.') })
        ]));
      }).finally(function done() { refreshButton.disabled = false; });
    }
    refreshButton.addEventListener('click', load);
    return load();
  }

  function saveResult(payload) {
    return callBackend('recordClassicResult', payload || {});
  }

  window.HanaClassicResults = Object.freeze({
    isConfigured: function isConfigured() { return /^https:\/\//i.test(backendUrl()); },
    renderPanel: renderPanel,
    saveResult: saveResult
  });
})();
