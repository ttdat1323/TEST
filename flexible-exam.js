(function () {
  'use strict';

  const PAGE = document.body.dataset.page || '';
  const Core = window.HanaFlexible || {};
  const HISTORY_KEY = 'hana-flexible-history-v1';
  const ATTEMPT_PREFIX = 'hana-flexible-attempt-v1:';
  const PREVIEW_KEY = 'hana-flexible-exam-preview';
  const MAX_HISTORY = 200;
  const TYPE_LABELS = Object.assign({
    multipleChoice: 'Trắc nghiệm',
    trueFalse: 'Đúng / Sai',
    shortAnswer: 'Trả lời ngắn',
    fillBlank: 'Đục lỗ',
    essay: 'Tự luận'
  }, Core.TYPE_LABELS || {});

  let currentExam = null;
  let attempt = null;
  let previewMode = false;
  let timerHandle = 0;
  let releaseHandle = 0;
  let submissionPromise = null;

  function node(tagName, options, children) {
    const element = document.createElement(tagName);
    const settings = options || {};
    if (settings.className) element.className = settings.className;
    if (settings.text !== undefined) element.textContent = String(settings.text);
    if (settings.html !== undefined) element.innerHTML = settings.html;
    if (settings.id) element.id = settings.id;
    if (settings.attrs) {
      Object.keys(settings.attrs).forEach(function setAttribute(name) {
        const value = settings.attrs[name];
        if (value !== false && value !== null && value !== undefined) {
          element.setAttribute(name, value === true ? '' : String(value));
        }
      });
    }
    if (settings.dataset) {
      Object.keys(settings.dataset).forEach(function setData(name) {
        element.dataset[name] = settings.dataset[name];
      });
    }
    if (settings.on) {
      Object.keys(settings.on).forEach(function addListener(eventName) {
        element.addEventListener(eventName, settings.on[eventName]);
      });
    }
    (Array.isArray(children) ? children : children === undefined ? [] : [children]).forEach(function append(child) {
      if (child === null || child === undefined || child === false) return;
      element.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return element;
  }

  function asNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function roundScore(value) {
    return Math.round((asNumber(value, 0) + Number.EPSILON) * 100) / 100;
  }

  function scoreText(value) {
    return roundScore(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  }

  function safeParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }

  function readStorage(key, fallback) {
    try {
      return safeParse(localStorage.getItem(key), fallback);
    } catch (_) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {
      // Storage is optional in private browsing modes.
    }
  }

  function examCatalog() {
    const source = Array.isArray(window.FLEXIBLE_EXAMS) ? window.FLEXIBLE_EXAMS : [];
    return source.filter(function validExam(exam) {
      return exam && typeof exam === 'object' && String(exam.id || '').trim() && Array.isArray(exam.questions);
    });
  }

  function normalizeExam(exam) {
    if (!exam) return null;
    if (typeof Core.normalizeExam === 'function') {
      try {
        return Core.normalizeExam(exam);
      } catch (_) {
        return exam;
      }
    }
    return exam;
  }

  function getTotals(exam) {
    const candidates = ['totals', 'getTotals', 'calculateTotals', 'examTotals', 'totalsForExam'];
    for (let index = 0; index < candidates.length; index += 1) {
      const method = Core[candidates[index]];
      if (typeof method !== 'function') continue;
      try {
        const result = method(exam);
        if (result && typeof result === 'object') {
          return {
            objective: asNumber(result.objective, asNumber(result.objectiveMax, asNumber(result.autoMax, 0))),
            essay: asNumber(result.essay, asNumber(result.essayMax, 0)),
            total: asNumber(result.total, asNumber(result.totalMax,
              asNumber(result.objective, asNumber(result.objectiveMax, 0)) + asNumber(result.essay, asNumber(result.essayMax, 0))))
          };
        }
      } catch (_) {
        // Fall through to the local total calculator.
      }
    }
    const totals = (exam.questions || []).reduce(function sum(result, question) {
      const points = Math.max(0, asNumber(question.points, 0));
      if (question.type === 'essay') result.essay += points;
      else result.objective += points;
      return result;
    }, { objective: 0, essay: 0 });
    totals.total = totals.objective + totals.essay;
    return totals;
  }

  function publishTimestamp(exam) {
    const value = Date.parse(exam.publishAt || '');
    return Number.isFinite(value) ? value : 0;
  }

  function formatDate(isoValue, timeZone) {
    const date = new Date(isoValue);
    if (!Number.isFinite(date.getTime())) return 'Không đặt thời gian';
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        timeZone: timeZone || 'Asia/Ho_Chi_Minh',
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
    } catch (_) {
      return date.toLocaleString('vi-VN');
    }
  }

  function durationText(totalSeconds) {
    const seconds = Math.max(0, Math.floor(asNumber(totalSeconds, 0)));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    if (days) return days + ' ngày ' + hours + ' giờ';
    if (hours) return hours + ' giờ ' + minutes + ' phút';
    if (minutes) return minutes + ' phút ' + remainder + ' giây';
    return remainder + ' giây';
  }

  function clockText(totalSeconds) {
    const seconds = Math.max(0, Math.ceil(asNumber(totalSeconds, 0)));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return [hours, minutes, remainder].map(function pad(value) { return String(value).padStart(2, '0'); }).join(':');
  }

  function domId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  function announce(message) {
    const live = document.getElementById('flexible-exam-announcement');
    if (!live) return;
    live.textContent = '';
    window.setTimeout(function updateAnnouncement() { live.textContent = message; }, 20);
  }

  function allowedDomains(exam) {
    const access = exam && exam.access ? exam.access : {};
    const raw = Array.isArray(access.allowedEmailDomains)
      ? access.allowedEmailDomains
      : access.allowedEmailDomain ? [access.allowedEmailDomain]
        : exam && exam.allowedEmailDomain ? [exam.allowedEmailDomain] : [];
    return raw.map(function clean(domain) {
      return String(domain || '').trim().toLowerCase().replace(/^@+/, '');
    }).filter(Boolean).filter(function unique(domain, index, list) { return list.indexOf(domain) === index; });
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function emailDomain(value) {
    const email = normalizeEmail(value);
    const at = email.lastIndexOf('@');
    if (at <= 0 || at === email.length - 1 || email.indexOf('@') !== at) return '';
    return email.slice(at + 1);
  }

  function emailAllowed(email, exam) {
    const domains = allowedDomains(exam);
    return domains.length > 0 && domains.indexOf(emailDomain(email)) !== -1;
  }

  function historyEntries() {
    const value = readStorage(HISTORY_KEY, []);
    if (!Array.isArray(value)) return [];
    return value.filter(function valid(item) {
      return item && item.examId && item.submittedAt && Number.isFinite(Number(item.objectiveEarned));
    }).slice(0, MAX_HISTORY);
  }

  function addHistoryEntry(record) {
    const list = historyEntries().filter(function noDuplicate(item) { return item.id !== record.id; });
    list.unshift(record);
    writeStorage(HISTORY_KEY, list.slice(0, MAX_HISTORY));
  }

  function renderCatalog() {
    const catalog = document.getElementById('flexible-exam-catalog');
    const status = document.getElementById('flexible-catalog-status');
    if (!catalog || !status) return;
    window.clearInterval(releaseHandle);
    const exams = examCatalog().slice().sort(function newestFirst(left, right) {
      return publishTimestamp(right) - publishTimestamp(left);
    });
    catalog.replaceChildren();
    catalog.setAttribute('aria-busy', 'false');
    if (!exams.length) {
      status.textContent = 'Chưa có bài kiểm tra nào được đăng.';
      catalog.appendChild(node('div', { className: 'empty-card' }, [
        node('h2', { text: 'Kho bài kiểm tra đang trống' }),
        node('p', { text: 'Tạo bài đầu tiên rồi tải file flexible-exams.js lên GitHub.' }),
        node('a', { className: 'btn btn-primary', text: 'Tạo bài kiểm tra', attrs: { href: 'create-flexible.html' } })
      ]));
      renderHistory();
      return;
    }

    const openCount = exams.filter(function isOpen(exam) { return publishTimestamp(exam) <= Date.now(); }).length;
    status.textContent = openCount + '/' + exams.length + ' bài đang mở.';
    exams.forEach(function renderExam(exam) {
      const releaseAt = publishTimestamp(exam);
      const locked = releaseAt > Date.now();
      const totals = getTotals(exam);
      const types = new Set((exam.questions || []).map(function type(question) { return question.type; }));
      const card = node('article', { className: 'exam-card flex-catalog-card' + (locked ? ' exam-card-locked locked-card' : '') });
      const badges = node('div', { className: 'exam-card-badges' }, [
        node('span', { className: 'status-badge ' + (locked ? 'status-locked' : 'status-open'), text: locked ? 'Chưa mở' : 'Đang mở' }),
        node('span', { className: 'badge', text: (exam.questions || []).length + ' câu · ' + types.size + ' dạng' })
      ]);
      const meta = node('div', { className: 'exam-card-meta' }, [
        node('span', { text: '⏱ ' + Math.max(1, asNumber(exam.standardDuration, 45)) + ' phút' }),
        node('span', { text: 'Tự chấm: ' + scoreText(totals.objective) + ' điểm' }),
        totals.essay > 0 ? node('span', { text: 'Tự luận: ' + scoreText(totals.essay) + ' điểm' }) : null
      ]);
      card.append(
        badges,
        node('h2', { text: exam.title || exam.id }),
        exam.description ? node('p', { className: 'exam-card-description', text: exam.description }) : node('p', { className: 'exam-card-description', text: 'Bài kiểm tra linh hoạt.' }),
        meta,
        node('p', { className: 'exam-release', text: 'Mở lúc ' + formatDate(exam.publishAt, exam.timeZone) })
      );
      const actions = node('div', { className: 'exam-card-actions' });
      if (locked) {
        actions.appendChild(node('strong', {
          className: 'catalog-countdown',
          text: 'Còn ' + durationText((releaseAt - Date.now()) / 1000),
          dataset: { releaseAt: String(releaseAt) }
        }));
      } else {
        actions.appendChild(node('a', {
          className: 'btn btn-primary',
          text: 'Làm bài',
          attrs: { href: 'test.html?id=' + encodeURIComponent(exam.id) }
        }));
      }
      card.appendChild(actions);
      catalog.appendChild(card);
    });

    releaseHandle = window.setInterval(function tickCatalog() {
      let opened = false;
      document.querySelectorAll('[data-release-at]').forEach(function updateCountdown(element) {
        const seconds = (Number(element.dataset.releaseAt) - Date.now()) / 1000;
        if (seconds <= 0) opened = true;
        else element.textContent = 'Còn ' + durationText(seconds);
      });
      if (opened) renderCatalog();
    }, 1000);
    renderHistory();
  }

  function renderHistory(filterExamId) {
    const list = document.getElementById('flexible-history-list');
    const clear = document.getElementById('clear-flexible-history');
    if (!list) return;
    const history = historyEntries().filter(function filter(item) { return !filterExamId || item.examId === filterExamId; });
    list.replaceChildren();
    if (clear) {
      clear.disabled = history.length === 0;
      clear.onclick = function clearHistory() {
        if (!history.length || !window.confirm(filterExamId
          ? 'Xóa lịch sử của bài kiểm tra này trên thiết bị?'
          : 'Xóa toàn bộ lịch sử bài kiểm tra trên thiết bị?')) return;
        const remaining = filterExamId
          ? historyEntries().filter(function preserve(item) { return item.examId !== filterExamId; })
          : [];
        writeStorage(HISTORY_KEY, remaining);
        renderHistory(filterExamId);
      };
    }
    if (!history.length) {
      list.appendChild(node('div', { className: 'empty-card', text: 'Chưa có lần làm bài nào được lưu trên thiết bị này.' }));
      return;
    }
    history.forEach(function renderEntry(entry) {
      const details = node('div', { className: 'catalog-item-copy' }, [
        node('h3', { text: entry.examTitle || entry.examId }),
        node('p', { className: 'catalog-meta', text: (entry.candidateName || 'Người làm bài') + ' · ' + formatDate(entry.submittedAt, entry.timeZone) }),
        node('p', { className: 'catalog-description', text: 'Điểm tự động: ' + scoreText(entry.objectiveEarned) + '/' + scoreText(entry.objectiveMax) + (entry.essayMax > 0 ? ' · Tự luận chờ chấm: ' + scoreText(entry.essayMax) : '') })
      ]);
      const actions = node('div', { className: 'catalog-item-actions' }, [
        node('a', { className: 'btn btn-small btn-secondary', text: 'Mở bài', attrs: { href: 'test.html?id=' + encodeURIComponent(entry.examId) } })
      ]);
      list.appendChild(node('article', { className: 'catalog-item flex-history-item' }, [details, actions]));
    });
  }

  function attemptKey() {
    return ATTEMPT_PREFIX + currentExam.id + ':' + String(currentExam.version || 1);
  }

  function saveAttempt() {
    if (!attempt || previewMode) return;
    writeStorage(attemptKey(), attempt);
  }

  function loadAttempt() {
    if (previewMode) return null;
    const saved = readStorage(attemptKey(), null);
    if (!saved || saved.examId !== currentExam.id || Number(saved.examVersion || 1) !== Number(currentExam.version || 1)) return null;
    return saved;
  }

  function loadCurrentExam() {
    const params = new URLSearchParams(window.location.search);
    previewMode = params.get('preview') === '1';
    if (previewMode) {
      try {
        const preview = safeParse(sessionStorage.getItem(PREVIEW_KEY), null);
        if (preview && Array.isArray(preview.questions)) return normalizeExam(preview);
      } catch (_) {
        return null;
      }
      return null;
    }
    const id = params.get('id') || '';
    const match = examCatalog().find(function find(exam) { return String(exam.id) === id; });
    return normalizeExam(match || null);
  }

  function renderState(title, description, icon, actionText, actionHref) {
    const app = document.getElementById('flexible-exam-app');
    if (!app) return;
    app.replaceChildren(node('section', { className: 'state-container' }, [
      node('div', { className: 'container' }, [
        node('div', { className: 'state-card' }, [
          node('span', { className: 'state-icon', text: icon || '!' }),
          node('h1', { text: title }),
          node('p', { text: description }),
          actionText ? node('a', { className: 'btn btn-primary', text: actionText, attrs: { href: actionHref || 'tests.html' } }) : null
        ])
      ])
    ]));
  }

  function renderLocked() {
    const app = document.getElementById('flexible-exam-app');
    if (!app) return;
    const releaseAt = publishTimestamp(currentExam);
    const countdown = node('strong', { className: 'large-countdown', text: durationText((releaseAt - Date.now()) / 1000) });
    app.replaceChildren(node('section', { className: 'state-container' }, [
      node('div', { className: 'container' }, [
        node('div', { className: 'state-card locked-state-card' }, [
          node('span', { className: 'state-icon', text: '🔒' }),
          node('span', { className: 'eyebrow', text: 'Bài chưa công khai' }),
          node('h1', { text: currentExam.title || 'Bài kiểm tra' }),
          node('p', { text: 'Bài sẽ mở lúc ' + formatDate(currentExam.publishAt, currentExam.timeZone) + '.' }),
          node('div', { className: 'countdown-panel' }, [node('span', { text: 'Thời gian còn lại' }), countdown]),
          node('a', { className: 'btn btn-secondary', text: 'Về danh sách', attrs: { href: 'tests.html' } })
        ])
      ])
    ]));
    window.clearInterval(releaseHandle);
    releaseHandle = window.setInterval(function tickRelease() {
      const seconds = (releaseAt - Date.now()) / 1000;
      if (seconds <= 0) {
        window.clearInterval(releaseHandle);
        renderLobby();
      } else {
        countdown.textContent = durationText(seconds);
      }
    }, 1000);
  }

  function backendUrl() {
    const config = window.HANA_BACKEND_CONFIG || window.HANA_BACKEND || {};
    return String(config.webAppUrl || config.url || '').trim();
  }

  function backendTimeout() {
    const config = window.HANA_BACKEND_CONFIG || window.HANA_BACKEND || {};
    return Math.min(60000, Math.max(5000, asNumber(config.requestTimeoutMs, 30000)));
  }

  function requestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function backendCall(action, payload) {
    const url = backendUrl();
    if (!url) return Promise.reject(Object.assign(new Error('Trang chưa được kết nối Google Apps Script.'), { code: 'BACKEND_NOT_CONFIGURED' }));
    if (!/^https:\/\//i.test(url)) return Promise.reject(Object.assign(new Error('Đường dẫn Google Apps Script không hợp lệ.'), { code: 'BACKEND_URL_INVALID' }));
    const id = requestId();
    const frameName = 'hana-backend-' + id.replace(/[^a-zA-Z0-9_-]/g, '');
    return new Promise(function postThroughFrame(resolve, reject) {
      const frame = node('iframe', { attrs: { name: frameName, title: 'Kết nối máy chủ', 'aria-hidden': 'true' } });
      const form = node('form', { attrs: { method: 'post', action: url, target: frameName, enctype: 'application/x-www-form-urlencoded' } });
      frame.hidden = true;
      form.hidden = true;
      function hidden(name, value) {
        form.appendChild(node('input', { attrs: { type: 'hidden', name: name, value: value } }));
      }
      hidden('action', action);
      hidden('payload', JSON.stringify(payload || {}));
      hidden('requestId', id);
      hidden('replyOrigin', window.location.origin);
      let settled = false;
      const cleanup = function cleanup() {
        window.removeEventListener('message', onMessage);
        window.clearTimeout(timeout);
        form.remove();
        frame.remove();
      };
      const finish = function finish(callback, value) {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onMessage = function receive(event) {
        if (event.source !== frame.contentWindow) return;
        let message = event.data;
        if (typeof message === 'string') message = safeParse(message, null);
        if (!message || String(message.requestId || '') !== id) return;
        const result = message.result || message.payload || message.response || message;
        if (!result || result.ok === false) {
          const error = new Error((result && result.message) || 'Máy chủ từ chối yêu cầu.');
          error.code = (result && (result.code || result.errorCode)) || 'BACKEND_ERROR';
          finish(reject, error);
          return;
        }
        finish(resolve, result);
      };
      const timeout = window.setTimeout(function timeOut() {
        const error = new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
        error.code = 'BACKEND_TIMEOUT';
        finish(reject, error);
      }, backendTimeout());
      window.addEventListener('message', onMessage);
      document.body.append(frame, form);
      try {
        form.submit();
      } catch (_) {
        const error = new Error('Không thể gửi yêu cầu tới máy chủ.');
        error.code = 'BACKEND_UNREACHABLE';
        finish(reject, error);
      }
    });
  }

  function renderLobby() {
    window.clearInterval(timerHandle);
    const app = document.getElementById('flexible-exam-app');
    if (!app) return;
    const totals = getTotals(currentExam);
    const domains = allowedDomains(currentExam);
    let challengeId = '';
    let verifiedToken = '';
    let verifiedEmail = '';
    let cooldownHandle = 0;

    const nameInput = node('input', { id: 'flex-candidate-name', attrs: { type: 'text', maxlength: '120', autocomplete: 'name', required: true, placeholder: 'Nguyễn Văn A' } });
    const emailInput = node('input', { id: 'flex-candidate-email', attrs: { type: 'email', maxlength: '254', autocomplete: 'email', required: true, placeholder: domains.length ? 'ten@' + domains[0] : 'email@example.com' } });
    const durationInput = node('input', { id: 'flex-duration', attrs: { type: 'number', min: '5', max: '360', step: '1', value: String(Math.max(5, asNumber(currentExam.standardDuration, 45))), required: true } });
    const consent = node('input', { id: 'flex-consent', attrs: { type: 'checkbox', required: true } });
    if (previewMode) consent.checked = true;
    const codeInput = node('input', { id: 'flex-otp-code', className: 'flex-otp-code', attrs: { type: 'text', inputmode: 'text', maxlength: '6', minlength: '6', autocomplete: 'one-time-code', placeholder: 'ABC123', pattern: '[A-Za-z0-9]{6}', disabled: true } });
    const sendButton = node('button', { className: 'btn btn-secondary', text: 'Gửi mã xác thực', attrs: { type: 'button' } });
    const verifyButton = node('button', { className: 'btn btn-secondary', text: 'Xác nhận mã', attrs: { type: 'button', disabled: true } });
    const startButton = node('button', { className: 'btn btn-primary btn-lg', text: previewMode ? 'Bắt đầu bản xem thử' : 'Bắt đầu làm bài', attrs: { type: 'submit', disabled: !previewMode } });
    const status = node('p', { className: 'form-error flex-otp-status', attrs: { role: 'status', 'aria-live': 'polite' } });
    const domainHelp = domains.length
      ? 'Chỉ chấp nhận: ' + domains.map(function addAt(domain) { return '@' + domain; }).join(', ')
      : 'Bài kiểm tra chưa được cấu hình tên miền email.';

    function resetVerification() {
      challengeId = '';
      verifiedToken = '';
      verifiedEmail = '';
      codeInput.value = '';
      codeInput.disabled = true;
      verifyButton.disabled = true;
      startButton.disabled = !previewMode;
      status.textContent = '';
    }

    emailInput.addEventListener('input', resetVerification);
    codeInput.addEventListener('input', function uppercaseCode() {
      const position = codeInput.selectionStart;
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (position !== null) codeInput.setSelectionRange(Math.min(position, codeInput.value.length), Math.min(position, codeInput.value.length));
    });

    sendButton.addEventListener('click', async function requestOtp() {
      const email = normalizeEmail(emailInput.value);
      if (!emailAllowed(email, currentExam)) {
        status.textContent = 'Email phải thuộc đúng tên miền: ' + domains.map(function at(domain) { return '@' + domain; }).join(', ') + '.';
        emailInput.setAttribute('aria-invalid', 'true');
        emailInput.focus();
        return;
      }
      emailInput.removeAttribute('aria-invalid');
      sendButton.disabled = true;
      status.textContent = 'Đang gửi mã tới email…';
      try {
        const response = await backendCall('requestOtp', { examId: currentExam.id, email: email });
        challengeId = String(response.challengeId || '');
        if (!challengeId) throw new Error('Máy chủ không trả về mã yêu cầu xác thực.');
        codeInput.disabled = false;
        verifyButton.disabled = false;
        codeInput.focus();
        status.textContent = 'Đã gửi mã 6 ký tự. Hãy kiểm tra hộp thư và thư rác.';
        let remaining = Math.max(10, asNumber(response.retryAfterSeconds, 60));
        window.clearInterval(cooldownHandle);
        sendButton.textContent = 'Gửi lại sau ' + remaining + ' giây';
        cooldownHandle = window.setInterval(function cooldown() {
          remaining -= 1;
          if (remaining <= 0) {
            window.clearInterval(cooldownHandle);
            sendButton.disabled = false;
            sendButton.textContent = 'Gửi lại mã';
          } else {
            sendButton.textContent = 'Gửi lại sau ' + remaining + ' giây';
          }
        }, 1000);
      } catch (error) {
        sendButton.disabled = false;
        status.textContent = error.message || 'Không gửi được mã. Vui lòng thử lại.';
      }
    });

    verifyButton.addEventListener('click', async function verifyOtp() {
      const email = normalizeEmail(emailInput.value);
      const code = codeInput.value.trim().toUpperCase();
      if (!challengeId || !/^[A-Z0-9]{6}$/.test(code)) {
        status.textContent = 'Nhập đủ 6 chữ hoặc số trong email.';
        codeInput.focus();
        return;
      }
      verifyButton.disabled = true;
      status.textContent = 'Đang xác nhận mã…';
      try {
        const response = await backendCall('verifyOtp', {
          examId: currentExam.id,
          email: email,
          challengeId: challengeId,
          code: code
        });
        verifiedToken = String(response.verificationToken || response.token || '');
        if (!verifiedToken) throw new Error('Máy chủ không trả về phiên xác thực.');
        verifiedEmail = email;
        emailInput.readOnly = true;
        codeInput.disabled = true;
        sendButton.disabled = true;
        verifyButton.disabled = true;
        startButton.disabled = false;
        status.textContent = 'Email đã xác thực. Bạn có thể bắt đầu làm bài.';
        startButton.focus();
      } catch (error) {
        verifyButton.disabled = false;
        status.textContent = error.message || 'Mã không đúng hoặc đã hết hạn.';
        codeInput.select();
      }
    });

    const form = node('form', { className: 'flex-access-panel form-grid', attrs: { novalidate: true } }, [
      node('div', { className: 'form-field' }, [node('label', { text: 'Họ và tên *', attrs: { for: nameInput.id } }), nameInput]),
      node('div', { className: 'form-field' }, [node('label', { text: 'Email *', attrs: { for: emailInput.id } }), emailInput, node('small', { text: domainHelp })]),
      node('div', { className: 'form-field' }, [node('label', { text: 'Thời gian làm bài (phút) *', attrs: { for: durationInput.id } }), durationInput]),
      previewMode ? node('div', { className: 'notice-card warning-notice' }, [node('span', { className: 'notice-icon', text: '👁' }), node('p', { text: 'Bản xem thử bỏ qua xác thực email và không gửi kết quả lên Drive.' })]) : null,
      previewMode ? null : node('div', { className: 'flex-otp-grid' }, [sendButton, codeInput, verifyButton]),
      status,
      node('label', { className: 'privacy-note flex-consent-row flex-privacy-consent' }, [consent, node('span', { text: previewMode
        ? ' Tôi hiểu đây là bản xem thử và dữ liệu sẽ không được gửi đi.'
        : ' Tôi đồng ý gửi họ tên, email, bài làm và điểm phần không tự luận vào Google Drive của người ra đề.' })]),
      startButton
    ]);

    form.addEventListener('submit', function startExam(event) {
      event.preventDefault();
      const name = String(nameInput.value || '').trim().replace(/\s+/g, ' ');
      const email = normalizeEmail(emailInput.value);
      const minutes = Math.floor(asNumber(durationInput.value, 0));
      if (name.length < 2) {
        status.textContent = 'Hãy nhập họ và tên.';
        nameInput.focus();
        return;
      }
      if (!previewMode && (!verifiedToken || verifiedEmail !== email)) {
        status.textContent = 'Hãy xác thực email trước khi bắt đầu.';
        return;
      }
      if (!previewMode && !emailAllowed(email, currentExam)) {
        status.textContent = 'Email không còn khớp tên miền cho phép.';
        return;
      }
      if (!consent.checked) {
        status.textContent = 'Cần đồng ý việc lưu thông tin và kết quả trước khi làm bài.';
        consent.focus();
        return;
      }
      if (minutes < 5 || minutes > 360) {
        status.textContent = 'Thời gian làm bài phải từ 5 đến 360 phút.';
        durationInput.focus();
        return;
      }
      const now = Date.now();
      attempt = {
        schemaVersion: 1,
        examId: currentExam.id,
        examVersion: Number(currentExam.version || 1),
        candidate: { name: name, email: email },
        durationMinutes: minutes,
        startedAt: new Date(now).toISOString(),
        endAt: now + minutes * 60000,
        answers: {},
        verificationToken: previewMode ? '' : verifiedToken,
        submissionId: requestId(),
        phase: 'active'
      };
      saveAttempt();
      renderWorkspace();
    });

    const intro = node('div', { className: 'exam-intro-copy' }, [
      node('span', { className: 'eyebrow', text: previewMode ? 'Bản xem thử' : 'Sẵn sàng làm bài' }),
      node('h1', { text: currentExam.title || 'Bài kiểm tra' }),
      currentExam.description ? node('p', { text: currentExam.description }) : null,
      node('div', { className: 'exam-open-meta' }, [
        node('p', { text: (currentExam.questions || []).length + ' câu · Thời lượng gợi ý ' + Math.max(5, asNumber(currentExam.standardDuration, 45)) + ' phút' }),
        node('p', { text: 'Đã công khai: ' + formatDate(currentExam.publishAt, currentExam.timeZone) })
      ]),
      node('div', { className: 'score-rules' }, [
        node('div', { className: 'score-rule' }, [node('strong', { text: scoreText(totals.objective) }), node('span', { text: 'điểm được chấm tự động' })]),
        totals.essay > 0 ? node('div', { className: 'score-rule' }, [node('strong', { text: scoreText(totals.essay) }), node('span', { text: 'điểm tự luận chờ chấm' })]) : null
      ])
    ]);

    app.replaceChildren(node('section', { className: 'exam-lobby flex-lobby' }, [
      node('div', { className: 'container' }, [node('div', { className: 'exam-intro-card flex-lobby-card flex-lobby-grid' }, [intro, form])])
    ]));
    window.setTimeout(function focusFirst() { nameInput.focus(); }, 50);
  }

  function imageSource(image) {
    if (typeof image === 'string') return image;
    return image && (image.src || image.dataUrl || image.url) ? String(image.src || image.dataUrl || image.url) : '';
  }

  function renderImages(question, questionNumber) {
    const images = Array.isArray(question.images) ? question.images.map(imageSource).filter(Boolean) : [];
    if (!images.length) return null;
    const gallery = node('div', { className: 'question-image-gallery' });
    images.forEach(function renderImage(source, index) {
      const image = node('img', { attrs: { src: source, alt: 'Ảnh ' + (index + 1) + ' của câu ' + questionNumber, loading: 'lazy' } });
      const button = node('button', {
        className: 'question-image-button',
        attrs: { type: 'button', 'aria-label': 'Phóng to ảnh ' + (index + 1) + ' của câu ' + questionNumber },
        on: { click: function open() { openImageViewer(source, image.alt); } }
      }, [image]);
      image.addEventListener('error', function imageError() {
        button.classList.add('image-error');
        button.disabled = true;
        button.textContent = 'Không tải được ảnh ' + (index + 1);
      }, { once: true });
      gallery.appendChild(button);
    });
    return gallery;
  }

  function openImageViewer(source, alt) {
    const dialog = document.getElementById('flexible-image-viewer');
    const image = document.getElementById('flexible-image-viewer-content');
    if (!dialog || !image) return;
    image.src = source;
    image.alt = alt || 'Ảnh câu hỏi phóng to';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeImageViewer() {
    const dialog = document.getElementById('flexible-image-viewer');
    const image = document.getElementById('flexible-image-viewer-content');
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    if (image) image.removeAttribute('src');
  }

  function promptNode(question) {
    const prompt = String(question.prompt || question.text || '').trim();
    return prompt ? node('p', { className: 'flex-question-prompt', text: prompt }) : null;
  }

  function answerFor(questionId) {
    return attempt && attempt.answers ? attempt.answers[questionId] : undefined;
  }

  function ensureObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function setAnswer(questionId, value) {
    if (!attempt || attempt.phase !== 'active') return;
    attempt.answers[questionId] = value;
    saveAttempt();
    updateProgress();
  }

  function renderMultipleChoice(question, disabled) {
    const grid = node('div', { className: 'choice-grid flex-choice-grid' });
    const value = String(answerFor(question.id) || '');
    const options = Array.isArray(question.options) && question.options.length
      ? question.options
      : ['A', 'B', 'C', 'D'].map(function option(id) { return { id: id, text: '' }; });
    options.forEach(function renderOption(option, index) {
      const optionId = String(option.id || String.fromCharCode(65 + index));
      const inputId = domId(question.id + '-option-' + optionId);
      const input = node('input', { attrs: { type: 'radio', id: inputId, name: 'answer-' + domId(question.id), value: optionId, checked: value === optionId, disabled: disabled } });
      input.addEventListener('change', function choose() { if (input.checked) setAnswer(question.id, optionId); });
      const labelText = optionId + (String(option.text || '').trim() ? '. ' + String(option.text).trim() : '');
      grid.appendChild(node('div', { className: 'flex-choice-option' }, [input, node('label', { text: labelText, attrs: { for: inputId } })]));
    });
    return grid;
  }

  function renderTrueFalse(question, disabled) {
    const list = node('div', { className: 'tf-statement-list flex-tf-list' });
    const value = ensureObject(answerFor(question.id));
    const statements = Array.isArray(question.statements) ? question.statements : [];
    statements.forEach(function renderStatement(statement, index) {
      const statementId = String(statement.id || String.fromCharCode(97 + index));
      const title = String(statement.text || statement.label || '').trim();
      const options = node('div', { className: 'tf-options flex-truth-options' });
      [{ value: true, label: 'Đúng' }, { value: false, label: 'Sai' }].forEach(function option(choice) {
        const inputId = domId(question.id + '-' + statementId + '-' + choice.label);
        const checked = value[statementId] === choice.value;
        const input = node('input', { attrs: { type: 'radio', id: inputId, name: 'answer-' + domId(question.id) + '-' + domId(statementId), value: String(choice.value), checked: checked, disabled: disabled } });
        input.addEventListener('change', function choose() {
          if (!input.checked) return;
          const next = Object.assign({}, ensureObject(answerFor(question.id)));
          next[statementId] = choice.value;
          setAnswer(question.id, next);
        });
        options.appendChild(node('div', { className: 'flex-truth-option' }, [input, node('label', { text: choice.label, attrs: { for: inputId } })]));
      });
      list.appendChild(node('div', { className: 'tf-answer-row flex-tf-row' }, [
        node('div', { className: 'flex-tf-statement' }, [node('strong', { text: statementId + ')' }), title ? node('span', { text: ' ' + title }) : null]),
        options
      ]));
    });
    return list;
  }

  function renderShortAnswer(question, disabled) {
    const maxLength = Math.min(500, Math.max(1, asNumber(question.maxLength, 120)));
    const input = node('input', {
      className: 'short-answer-input flex-short-answer',
      attrs: { type: 'text', maxlength: String(maxLength), value: String(answerFor(question.id) || ''), autocomplete: 'off', disabled: disabled, 'aria-label': 'Trả lời câu hỏi' }
    });
    input.addEventListener('input', function update() { setAnswer(question.id, input.value); });
    return node('div', { className: 'short-answer-row' }, [
      node('label', { text: 'Đáp án', attrs: { for: (input.id = domId(question.id + '-short')) } }),
      input,
      node('span', { className: 'character-hint flex-char-count', text: 'Tối đa ' + maxLength + ' ký tự' })
    ]);
  }

  function renderFillBlank(question, disabled) {
    const grid = node('div', { className: 'flex-fill-grid' });
    const value = ensureObject(answerFor(question.id));
    const blanks = Array.isArray(question.blanks) ? question.blanks : [];
    blanks.forEach(function renderBlank(blank, index) {
      const blankId = String(blank.id || 'blank-' + (index + 1));
      const inputId = domId(question.id + '-' + blankId);
      const input = node('input', { attrs: { type: 'text', id: inputId, maxlength: String(Math.min(500, Math.max(1, asNumber(blank.maxLength, 120)))), value: String(value[blankId] || ''), autocomplete: 'off', disabled: disabled } });
      input.addEventListener('input', function updateBlank() {
        const next = Object.assign({}, ensureObject(answerFor(question.id)));
        next[blankId] = input.value;
        setAnswer(question.id, next);
      });
      grid.appendChild(node('div', { className: 'form-field flex-fill-row' }, [
        node('label', { text: String(blank.label || 'Ô trống ' + (index + 1)), attrs: { for: inputId } }),
        input
      ]));
    });
    return grid;
  }

  function renderEssay(question, disabled) {
    const maxLength = Math.min(20000, Math.max(100, asNumber(question.maxLength, 5000)));
    const textarea = node('textarea', {
      className: 'flex-essay',
      attrs: { rows: '9', maxlength: String(maxLength), placeholder: 'Nhập bài làm tự luận…', disabled: disabled, 'aria-label': 'Bài làm tự luận' }
    });
    textarea.value = String(answerFor(question.id) || '');
    const hint = node('small', { className: 'character-hint flex-char-count', text: textarea.value.length + '/' + maxLength + ' ký tự' });
    textarea.addEventListener('input', function updateEssay() {
      hint.textContent = textarea.value.length + '/' + maxLength + ' ký tự';
      setAnswer(question.id, textarea.value);
    });
    return node('div', { className: 'form-field' }, [textarea, hint]);
  }

  function renderQuestion(question, index, disabled) {
    const fieldset = node('fieldset', { className: 'question-card flex-question', id: 'flex-question-' + domId(question.id) });
    const points = Math.max(0, asNumber(question.points, 0));
    fieldset.appendChild(node('legend', {}, [
      node('span', { text: 'Câu ' + (index + 1) }),
      node('small', { className: 'flex-question-meta', text: ' · ' + TYPE_LABELS[question.type] + ' · ' + scoreText(points) + ' điểm' })
    ]));
    const prompt = promptNode(question);
    const images = renderImages(question, index + 1);
    if (prompt) fieldset.appendChild(prompt);
    if (images) fieldset.appendChild(images);
    let answerControl = null;
    if (question.type === 'multipleChoice') answerControl = renderMultipleChoice(question, disabled);
    else if (question.type === 'trueFalse') answerControl = renderTrueFalse(question, disabled);
    else if (question.type === 'shortAnswer') answerControl = renderShortAnswer(question, disabled);
    else if (question.type === 'fillBlank') answerControl = renderFillBlank(question, disabled);
    else if (question.type === 'essay') answerControl = renderEssay(question, disabled);
    else answerControl = node('p', { className: 'form-error', text: 'Dạng câu hỏi này chưa được hỗ trợ.' });
    fieldset.appendChild(answerControl);
    return fieldset;
  }

  function answerStatus(question) {
    const value = answerFor(question.id);
    if (question.type === 'multipleChoice' || question.type === 'shortAnswer' || question.type === 'essay') {
      return String(value || '').trim() ? 'complete' : 'empty';
    }
    const object = ensureObject(value);
    const parts = question.type === 'trueFalse'
      ? (Array.isArray(question.statements) ? question.statements : [])
      : (Array.isArray(question.blanks) ? question.blanks : []);
    if (!parts.length) return 'empty';
    const count = parts.filter(function answered(part, index) {
      const id = String(part.id || (question.type === 'trueFalse' ? String.fromCharCode(97 + index) : 'blank-' + (index + 1)));
      if (question.type === 'trueFalse') return object[id] === true || object[id] === false;
      return String(object[id] || '').trim().length > 0;
    }).length;
    if (count === parts.length) return 'complete';
    return count > 0 ? 'partial' : 'empty';
  }

  function updateProgress() {
    if (!currentExam || !attempt) return;
    let complete = 0;
    let partial = 0;
    currentExam.questions.forEach(function update(question) {
      const status = answerStatus(question);
      if (status === 'complete') complete += 1;
      else if (status === 'partial') partial += 1;
      const palette = Array.from(document.querySelectorAll('[data-flex-palette]')).find(function sameQuestion(item) {
        return item.dataset.flexPalette === String(question.id);
      });
      if (palette) {
        palette.classList.toggle('is-complete', status === 'complete');
        palette.classList.toggle('is-partial', status === 'partial');
      }
    });
    const progress = document.getElementById('flex-progress-value');
    if (progress) progress.textContent = complete + '/' + currentExam.questions.length;
    const summary = document.getElementById('flex-answer-summary');
    if (summary) summary.textContent = complete + ' câu hoàn tất' + (partial ? ' · ' + partial + ' câu còn thiếu ý' : '');
  }

  function renderPalette() {
    const aside = node('aside', { className: 'question-palette flex-question-nav', attrs: { 'aria-label': 'Điều hướng nhanh câu hỏi' } }, [node('h2', { text: 'Câu hỏi' })]);
    const grid = node('div', { className: 'palette-grid flex-question-nav-grid' });
    currentExam.questions.forEach(function palette(question, index) {
      const status = answerStatus(question);
      const button = node('button', {
        className: 'palette-item' + (status === 'complete' ? ' is-complete' : status === 'partial' ? ' is-partial' : ''),
        text: String(index + 1),
        attrs: { type: 'button', title: TYPE_LABELS[question.type] || 'Câu hỏi' },
        dataset: { flexPalette: String(question.id) },
        on: { click: function scroll() { document.getElementById('flex-question-' + domId(question.id)).scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
      });
      grid.appendChild(button);
    });
    aside.append(grid, node('p', { className: 'palette-legend', text: '● Đã trả lời · ◐ Chưa đủ ý' }));
    return aside;
  }

  function renderWorkspace() {
    const app = document.getElementById('flexible-exam-app');
    if (!app || !attempt) return;
    window.clearInterval(timerHandle);
    const locked = attempt.phase !== 'active';
    const toolbar = node('div', { className: 'exam-toolbar' }, [
      node('div', { className: 'container exam-toolbar-inner' }, [
        node('div', { className: 'candidate-chip' }, [node('span', { text: 'Người làm' }), node('strong', { text: attempt.candidate.name })]),
        node('div', { className: 'timer-chip', id: 'flex-timer-chip' }, [node('span', { text: 'Còn lại' }), node('strong', { className: 'timer-value', id: 'flex-timer-value', text: clockText((attempt.endAt - Date.now()) / 1000) })]),
        node('div', { className: 'progress-chip' }, [node('span', { text: 'Hoàn tất' }), node('strong', { className: 'progress-value', id: 'flex-progress-value', text: '0/' + currentExam.questions.length })]),
        node('button', { className: 'btn btn-primary', text: locked ? 'Thử nộp lại' : 'Nộp bài', attrs: { type: 'button' }, on: { click: function submit() { requestSubmit(locked ? (attempt.submitReason || 'manual') : 'manual'); } } })
      ])
    ]);
    const content = node('div', { className: 'exam-content' }, [
      node('header', { className: 'exam-paper-header' }, [
        node('span', { className: 'eyebrow', text: previewMode ? 'Bản xem thử' : 'Bài kiểm tra' }),
        node('h1', { text: currentExam.title }),
        currentExam.description ? node('p', { text: currentExam.description }) : null
      ])
    ]);
    if (locked) {
      content.appendChild(node('div', { className: 'notice-card warning-notice flex-submit-status flex-submit-retry', attrs: { role: 'alert' } }, [
        node('span', { className: 'notice-icon', text: '!' }),
        node('div', {}, [
          node('strong', { text: 'Bài làm chưa được lưu lên Google Drive' }),
          node('p', { text: attempt.submitError || 'Kiểm tra kết nối rồi nhấn “Thử nộp lại”. Toàn bộ câu trả lời vẫn được giữ trên thiết bị.' }),
          node('button', { className: 'btn btn-small btn-secondary', text: 'Xác thực lại email', attrs: { type: 'button' }, on: { click: renderReauthentication } })
        ])
      ]));
    }
    const section = node('section', { className: 'exam-section', attrs: { 'aria-labelledby': 'flex-question-heading' } }, [
      node('div', { className: 'exam-section-header' }, [node('h2', { id: 'flex-question-heading', text: 'Nội dung bài kiểm tra' }), node('p', { text: 'Câu tự luận được lưu để chấm sau và không cộng vào điểm tự động.' })])
    ]);
    currentExam.questions.forEach(function addQuestion(question, index) { section.appendChild(renderQuestion(question, index, locked)); });
    section.appendChild(node('div', { className: 'exam-bottom-submit' }, [
      node('p', { id: 'flex-answer-summary', text: 'Đang cập nhật tiến độ…' }),
      node('button', { className: 'btn btn-primary btn-lg', text: locked ? 'Thử nộp lại' : 'Nộp bài', attrs: { type: 'button' }, on: { click: function submitBottom() { requestSubmit(locked ? (attempt.submitReason || 'manual') : 'manual'); } } })
    ]));
    content.appendChild(section);
    app.replaceChildren(toolbar, node('div', { className: 'container exam-layout flex-exam-layout' }, [renderPalette(), content]));
    updateProgress();
    if (!locked) {
      tickTimer();
      timerHandle = window.setInterval(tickTimer, 1000);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function tickTimer() {
    if (!attempt || attempt.phase !== 'active') return;
    const remaining = Math.max(0, (Number(attempt.endAt) - Date.now()) / 1000);
    const value = document.getElementById('flex-timer-value');
    const chip = document.getElementById('flex-timer-chip');
    if (value) value.textContent = clockText(remaining);
    if (chip) {
      chip.classList.toggle('timer-warning', remaining <= 600 && remaining > 60);
      chip.classList.toggle('timer-critical', remaining <= 60);
    }
    if (remaining <= 0) {
      window.clearInterval(timerHandle);
      announce('Hết giờ. Hệ thống đang tự động nộp bài.');
      requestSubmit('timeout');
    }
  }

  function incompleteCount() {
    return currentExam.questions.filter(function incomplete(question) { return answerStatus(question) !== 'complete'; }).length;
  }

  function requestSubmit(reason) {
    if (!attempt || submissionPromise) return;
    if (attempt.phase === 'active' && reason === 'manual') {
      const missing = incompleteCount();
      const message = missing
        ? 'Bạn còn ' + missing + ' câu chưa hoàn tất. Vẫn nộp bài?'
        : 'Nộp bài ngay bây giờ?';
      if (!window.confirm(message)) return;
    }
    submitAttempt(reason);
  }

  function localScore(exam, answers) {
    if (typeof Core.scoreSubmission === 'function') {
      try {
        const value = Core.scoreSubmission(exam, answers);
        if (value) return value;
      } catch (_) {
        // Use fallback scorer below.
      }
    }
    if (typeof Core.scoreExam === 'function') {
      try {
        const value = Core.scoreExam(exam, answers);
        if (value) return value;
      } catch (_) {
        // Use fallback scorer below.
      }
    }
    const totals = getTotals(exam);
    let earned = 0;
    const normalize = function normalize(value, caseSensitive) {
      let text = String(value === null || value === undefined ? '' : value).normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/(\d),(?=\d)/g, '$1.');
      if (!caseSensitive) text = text.toLocaleLowerCase('vi-VN');
      return text;
    };
    (exam.questions || []).forEach(function grade(question) {
      if (question.type === 'essay') return;
      const points = Math.max(0, asNumber(question.points, 0));
      const answer = answers[question.id];
      if (question.type === 'multipleChoice') {
        if (String(answer || '') === String(question.correctOptionId || '')) earned += points;
      } else if (question.type === 'shortAnswer') {
        const given = normalize(answer, question.caseSensitive);
        if ((question.acceptedAnswers || []).some(function match(key) { return normalize(key, question.caseSensitive) === given && given; })) earned += points;
      } else if (question.type === 'trueFalse') {
        const object = ensureObject(answer);
        const statements = question.statements || [];
        if (statements.length) {
          const correct = statements.filter(function right(statement, index) {
            const id = String(statement.id || String.fromCharCode(97 + index));
            return object[id] === Boolean(statement.answer);
          }).length;
          earned += question.scoringMode === 'allOrNothing'
            ? (correct === statements.length ? points : 0)
            : points * correct / statements.length;
        }
      } else if (question.type === 'fillBlank') {
        const object = ensureObject(answer);
        const blanks = question.blanks || [];
        if (blanks.length) {
          const correct = blanks.filter(function right(blank, index) {
            const id = String(blank.id || 'blank-' + (index + 1));
            const given = normalize(object[id], blank.caseSensitive);
            return (blank.acceptedAnswers || []).some(function match(key) { return normalize(key, blank.caseSensitive) === given && given; });
          }).length;
          earned += question.scoringMode === 'allOrNothing'
            ? (correct === blanks.length ? points : 0)
            : points * correct / blanks.length;
        }
      }
    });
    return { objectiveEarned: roundScore(earned), objectiveMax: roundScore(totals.objective), essayMax: roundScore(totals.essay), totalMax: roundScore(totals.total) };
  }

  function normalizeScore(response) {
    const source = response && (response.score || response.result && response.result.score || response.result) || response || {};
    const totals = getTotals(currentExam);
    return {
      objectiveEarned: roundScore(asNumber(source.objectiveEarned, asNumber(source.earned, asNumber(source.autoScore, 0)))),
      objectiveMax: roundScore(asNumber(source.objectiveMax, asNumber(source.max, asNumber(source.autoMax, totals.objective)))),
      essayMax: roundScore(asNumber(source.essayMax, totals.essay)),
      totalMax: roundScore(asNumber(source.totalMax, totals.total)),
      byType: source.byType && typeof source.byType === 'object' ? source.byType : {}
    };
  }

  async function submitAttempt(reason) {
    if (!attempt || submissionPromise) return;
    attempt.phase = 'submitting';
    attempt.submitReason = reason || 'manual';
    attempt.submittedAt = new Date().toISOString();
    saveAttempt();
    renderWorkspace();
    announce('Đang nộp bài. Vui lòng không đóng trang.');
    submissionPromise = (async function submit() {
      try {
        let response;
        if (previewMode) {
          response = { ok: true, receiptId: 'preview', score: localScore(currentExam, attempt.answers || {}) };
        } else {
          if (!attempt.verificationToken) {
            const missingToken = new Error('Phiên xác thực email không còn hiệu lực. Hãy xác thực lại.');
            missingToken.code = 'TOKEN_INVALID';
            throw missingToken;
          }
          response = await backendCall('submitExam', {
            examId: currentExam.id,
            examVersion: Number(currentExam.version || 1),
            verificationToken: attempt.verificationToken,
            submissionId: attempt.submissionId,
            candidate: { name: attempt.candidate.name, email: attempt.candidate.email },
            startedAt: attempt.startedAt,
            submittedAt: attempt.submittedAt,
            durationSeconds: Math.max(0, Math.round((Date.parse(attempt.submittedAt) - Date.parse(attempt.startedAt)) / 1000)),
            submissionReason: attempt.submitReason,
            answers: attempt.answers || {}
          });
        }
        const score = normalizeScore(response);
        attempt.phase = 'submitted';
        attempt.result = {
          score: score,
          receiptId: String(response.receiptId || response.receipt || ''),
          savedAt: response.savedAt || new Date().toISOString(),
          reason: attempt.submitReason
        };
        attempt.answers = {};
        attempt.verificationToken = '';
        attempt.submitError = '';
        attempt.submitErrorCode = '';
        saveAttempt();
        if (!previewMode) {
          addHistoryEntry({
            id: currentExam.id + ':' + attempt.submissionId,
            examId: currentExam.id,
            examTitle: currentExam.title,
            timeZone: currentExam.timeZone,
            candidateName: attempt.candidate.name,
            objectiveEarned: score.objectiveEarned,
            objectiveMax: score.objectiveMax,
            essayMax: score.essayMax,
            startedAt: attempt.startedAt,
            submittedAt: attempt.submittedAt,
            reason: attempt.submitReason
          });
        }
        renderResult();
      } catch (error) {
        attempt.phase = 'awaitingSubmission';
        attempt.submitError = error.message || 'Không thể nộp bài. Vui lòng thử lại.';
        attempt.submitErrorCode = error.code || 'SUBMIT_FAILED';
        saveAttempt();
        renderWorkspace();
        announce('Chưa nộp được bài. Câu trả lời vẫn được giữ trên thiết bị.');
      } finally {
        submissionPromise = null;
      }
    }());
    return submissionPromise;
  }

  function renderReauthentication() {
    if (!attempt) return;
    const app = document.getElementById('flexible-exam-app');
    const email = normalizeEmail(attempt.candidate.email);
    let challengeId = '';
    const code = node('input', { className: 'flex-otp-code', attrs: { type: 'text', maxlength: '6', autocomplete: 'one-time-code', placeholder: 'ABC123', disabled: true } });
    const status = node('p', { className: 'form-error', attrs: { role: 'status' } });
    const send = node('button', { className: 'btn btn-secondary', text: 'Gửi mã mới', attrs: { type: 'button' } });
    const verify = node('button', { className: 'btn btn-primary', text: 'Xác thực và nộp lại', attrs: { type: 'button', disabled: true } });
    code.addEventListener('input', function upper() { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
    send.addEventListener('click', async function request() {
      send.disabled = true;
      status.textContent = 'Đang gửi mã…';
      try {
        const result = await backendCall('requestOtp', { examId: currentExam.id, email: email });
        challengeId = String(result.challengeId || '');
        if (!challengeId) throw new Error('Không nhận được mã yêu cầu xác thực.');
        code.disabled = false;
        verify.disabled = false;
        code.focus();
        status.textContent = 'Đã gửi mã tới ' + email + '.';
      } catch (error) {
        send.disabled = false;
        status.textContent = error.message;
      }
    });
    verify.addEventListener('click', async function confirm() {
      if (!/^[A-Z0-9]{6}$/.test(code.value)) {
        status.textContent = 'Nhập đủ 6 chữ hoặc số.';
        return;
      }
      verify.disabled = true;
      status.textContent = 'Đang xác thực…';
      try {
        const result = await backendCall('verifyOtp', { examId: currentExam.id, email: email, challengeId: challengeId, code: code.value });
        attempt.verificationToken = String(result.verificationToken || result.token || '');
        if (!attempt.verificationToken) throw new Error('Không nhận được phiên xác thực.');
        saveAttempt();
        submitAttempt(attempt.submitReason || 'manual');
      } catch (error) {
        verify.disabled = false;
        status.textContent = error.message;
      }
    });
    app.replaceChildren(node('section', { className: 'state-container' }, [
      node('div', { className: 'container' }, [node('div', { className: 'state-card' }, [
        node('span', { className: 'state-icon', text: '✉' }),
        node('h1', { text: 'Xác thực lại để nộp bài' }),
        node('p', { text: 'Bài làm vẫn được giữ nguyên. Mã mới sẽ gửi tới ' + email + '.' }),
        node('div', { className: 'flex-otp-grid' }, [send, code, verify]),
        status,
        node('button', { className: 'btn btn-ghost', text: 'Quay lại bài làm', attrs: { type: 'button' }, on: { click: renderWorkspace } })
      ])])
    ]));
  }

  function renderResult() {
    window.clearInterval(timerHandle);
    const app = document.getElementById('flexible-exam-app');
    if (!app || !attempt || !attempt.result) return;
    const score = attempt.result.score || {};
    const reasonText = attempt.result.reason === 'timeout' ? 'Tự động nộp khi hết giờ' : 'Đã nộp bài';
    const cards = node('div', { className: 'result-summary-grid flex-result-grid' }, [
      node('div', { className: 'result-summary-card' }, [node('strong', { text: scoreText(score.objectiveEarned) + '/' + scoreText(score.objectiveMax) }), node('small', { text: 'Điểm chấm tự động' })]),
      node('div', { className: 'result-summary-card' }, [node('strong', { text: scoreText(score.essayMax || 0) }), node('small', { text: Number(score.essayMax || 0) > 0 ? 'Điểm tự luận chờ chấm' : 'Không có phần tự luận' })]),
      node('div', { className: 'result-summary-card' }, [node('strong', { text: attempt.candidate.name }), node('small', { text: reasonText })])
    ]);
    const result = node('section', { className: 'result-container flex-result' }, [
      node('div', { className: 'container' }, [
        node('div', { className: 'result-hero flex-result-card' }, [
          node('span', { className: 'eyebrow', text: previewMode ? 'Kết quả xem thử' : 'Đã ghi nhận kết quả' }),
          node('h1', { text: previewMode ? 'Bản xem thử đã hoàn tất' : 'Hoàn thành bài kiểm tra' }),
          node('p', { className: 'result-exam-title', text: currentExam.title }),
          node('div', { className: 'score-circle' }, [node('strong', { text: scoreText(score.objectiveEarned) }), node('span', { text: '/ ' + scoreText(score.objectiveMax) + ' điểm tự động' })]),
          Number(score.essayMax || 0) > 0 ? node('p', { text: 'Phần tự luận tối đa ' + scoreText(score.essayMax) + ' điểm đang chờ người ra đề chấm.' }) : null,
          previewMode ? node('p', { className: 'privacy-note', text: 'Bản xem thử không gửi dữ liệu lên Google Drive.' }) : node('p', { className: 'privacy-note', text: 'Kết quả đã được gửi tới Google Drive. Mã biên nhận: ' + (attempt.result.receiptId || 'đã lưu') }),
          cards
        ]),
        node('div', { className: 'result-actions' }, [
          node('button', { className: 'btn btn-primary', text: 'Làm lại bài này', attrs: { type: 'button' }, on: { click: restartExam } }),
          node('a', { className: 'btn btn-secondary', text: previewMode ? 'Quay lại trình tạo' : 'Về danh sách', attrs: { href: previewMode ? 'create-flexible.html' : 'tests.html' } })
        ]),
        previewMode ? null : node('section', { className: 'panel', attrs: { 'aria-labelledby': 'result-history-heading' } }, [
          node('div', { className: 'panel-heading' }, [node('div', {}, [node('span', { className: 'eyebrow', text: 'Chỉ trên thiết bị này' }), node('h2', { id: 'result-history-heading', text: 'Các lần làm bài này' })]), node('button', { className: 'btn btn-small btn-danger', text: 'Xóa lịch sử', id: 'clear-flexible-history', attrs: { type: 'button' } })]),
          node('div', { id: 'flexible-history-list', className: 'catalog-list flex-history-list' })
        ])
      ])
    ]);
    app.replaceChildren(result);
    if (!previewMode) renderHistory(currentExam.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function restartExam() {
    if (!window.confirm('Bắt đầu một lượt làm bài mới? Lịch sử cũ vẫn được giữ trên thiết bị.')) return;
    if (!previewMode) removeStorage(attemptKey());
    attempt = null;
    window.location.reload();
  }

  function initPlayer() {
    currentExam = loadCurrentExam();
    const backLink = document.getElementById('flexible-exam-back-link');
    if (backLink && previewMode) {
      backLink.href = 'create-flexible.html';
      backLink.textContent = '← Trình tạo bài kiểm tra';
    }
    if (!currentExam) {
      renderState('Không tìm thấy bài kiểm tra', previewMode
        ? 'Bản xem thử không còn trong phiên này. Hãy quay lại trình tạo và bấm xem thử lần nữa.'
        : 'Đường dẫn có thể chưa đúng hoặc bài đã được gỡ khỏi danh sách.', '?', previewMode ? 'Về trình tạo' : 'Về danh sách', previewMode ? 'create-flexible.html' : 'tests.html');
      return;
    }
    document.title = (currentExam.title || 'Làm bài kiểm tra') + ' | Hana Exam Lab';
    if (!previewMode && publishTimestamp(currentExam) > Date.now()) {
      renderLocked();
      return;
    }
    attempt = loadAttempt();
    if (attempt && attempt.phase === 'submitted' && attempt.result) {
      renderResult();
      return;
    }
    if (attempt && ['active', 'submitting', 'awaitingSubmission'].indexOf(attempt.phase) !== -1) {
      if (attempt.phase === 'submitting') attempt.phase = 'awaitingSubmission';
      renderWorkspace();
      if (attempt.phase === 'active' && Number(attempt.endAt) <= Date.now()) requestSubmit('timeout');
      return;
    }
    renderLobby();
  }

  function initImageViewer() {
    const close = document.querySelector('[data-close-flexible-image]');
    const dialog = document.getElementById('flexible-image-viewer');
    if (close) close.addEventListener('click', closeImageViewer);
    if (dialog) {
      dialog.addEventListener('click', function closeBackdrop(event) { if (event.target === dialog) closeImageViewer(); });
      dialog.addEventListener('cancel', function clearImage() {
        const image = document.getElementById('flexible-image-viewer-content');
        if (image) image.removeAttribute('src');
      });
    }
  }

  function init() {
    if (PAGE === 'flexible-catalog') renderCatalog();
    if (PAGE === 'flexible-exam') {
      initImageViewer();
      initPlayer();
    }
  }

  window.FlexibleExamApp = Object.freeze({
    emailDomain: emailDomain,
    emailAllowed: emailAllowed,
    getTotals: getTotals,
    scorePreview: localScore,
    backendCall: backendCall,
    historyEntries: historyEntries
  });

  window.addEventListener('beforeunload', function warn(event) {
    if (!attempt || attempt.phase !== 'active') return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
