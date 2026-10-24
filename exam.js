(function examApplication() {
  'use strict';

  const SUBJECTS = Object.freeze({
    math: Object.freeze({
      key: 'math', label: 'Toán', catalogPage: 'math.html', builderPage: 'create-math.html',
      catalogGlobal: 'MATH_EXAMS', mcCount: 12, tfCount: 4, shortCount: 6,
      mcPoint: 0.25, shortPoint: 0.5, mcMax: 3, tfMax: 4, shortMax: 3,
      defaultDuration: 90, emptyIcon: '∑'
    }),
    physics: Object.freeze({
      key: 'physics', label: 'Vật lý', catalogPage: 'physics.html', builderPage: 'create-physics.html',
      catalogGlobal: 'PHYSICS_EXAMS', mcCount: 18, tfCount: 4, shortCount: 6,
      mcPoint: 0.25, shortPoint: 0.25, mcMax: 4.5, tfMax: 4, shortMax: 1.5,
      defaultDuration: 50, emptyIcon: '⚛'
    })
  });
  const TF_POINT_TABLE = [0, 0.1, 0.25, 0.5, 1];
  let currentSubjectKey = 'math';
  let currentSubject = SUBJECTS.math;
  let currentExam = null;
  let attempt = null;
  let stateKey = '';
  let timerHandle = null;
  let catalogHandle = null;
  let finishing = false;
  let announcedFiveMinutes = false;
  let announcedOneMinute = false;

  function element(tagName, options, children) {
    const node = document.createElement(tagName);
    const opts = options || {};
    if (opts.className) node.className = opts.className;
    if (Object.prototype.hasOwnProperty.call(opts, 'text')) node.textContent = String(opts.text);
    if (opts.id) node.id = opts.id;
    if (opts.type) node.type = opts.type;
    if (opts.name) node.name = opts.name;
    if (Object.prototype.hasOwnProperty.call(opts, 'value')) node.value = String(opts.value);
    if (opts.href) node.setAttribute('href', opts.href);
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function setAttribute(name) {
        const value = opts.attrs[name];
        if (value !== null && value !== undefined && value !== false) {
          node.setAttribute(name, value === true ? '' : String(value));
        }
      });
    }
    if (opts.dataset) {
      Object.keys(opts.dataset).forEach(function setData(name) {
        node.dataset[name] = String(opts.dataset[name]);
      });
    }
    (children || []).forEach(function appendChild(child) {
      if (child === null || child === undefined) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function selectSubject(subjectKey) {
    currentSubjectKey = subjectKey === 'physics' ? 'physics' : 'math';
    currentSubject = SUBJECTS[currentSubjectKey];
    return currentSubject;
  }

  function totalResponses() {
    return currentSubject.mcCount + (currentSubject.tfCount * 4) + currentSubject.shortCount;
  }

  function totalQuestions() {
    return currentSubject.mcCount + currentSubject.tfCount + currentSubject.shortCount;
  }

  function getExamCatalog(subjectKey) {
    const config = SUBJECTS[subjectKey === 'physics' ? 'physics' : 'math'];
    return Array.isArray(window[config.catalogGlobal]) ? window[config.catalogGlobal] : [];
  }

  function questionImages(question) {
    if (!question || typeof question !== 'object') return [];
    const sources = Array.isArray(question.images) && question.images.length
      ? question.images
      : question.image
        ? [question.image]
        : [];
    return sources.map(safeImageSource).filter(Boolean);
  }

  function hasValidExamShape(exam) {
    if (!exam || typeof exam !== 'object' || !exam.id || !exam.title || !exam.sections) return false;
    if (exam.subject && exam.subject !== currentSubjectKey) return false;
    const mc = exam.sections.multipleChoice;
    const tf = exam.sections.trueFalse;
    const short = exam.sections.shortAnswer;
    if (!Array.isArray(mc) || mc.length !== currentSubject.mcCount) return false;
    if (!Array.isArray(tf) || tf.length !== currentSubject.tfCount) return false;
    if (!Array.isArray(short) || short.length !== currentSubject.shortCount) return false;
    if (!mc.every(function validMc(q) { return q && questionImages(q).length && ['A', 'B', 'C', 'D'].includes(String(q.answer).toUpperCase()); })) return false;
    if (!tf.every(function validTf(q) {
      return q && questionImages(q).length && Array.isArray(q.answers) && q.answers.length === 4 && q.answers.every(function booleanOnly(v) { return typeof v === 'boolean'; });
    })) return false;
    return short.every(function validShort(q) {
      if (!q || !questionImages(q).length || q.answer === null || q.answer === undefined) return false;
      return String(q.answer).split('|').every(function validVariant(answer) {
        const normalized = normalizeShortAnswer(answer);
        return normalized.length > 0 && normalized.length <= 4;
      });
    });
  }

  function formatPublishedTime(isoString, timeZone) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'Thời gian chưa hợp lệ';
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        timeZone: timeZone || 'Asia/Ho_Chi_Minh',
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZoneName: 'short'
      }).format(date);
    } catch (error) {
      return date.toLocaleString('vi-VN');
    }
  }

  function formatCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const clock = [hours, minutes, seconds].map(function twoDigits(value) { return String(value).padStart(2, '0'); }).join(':');
    return days > 0 ? days + ' ngày ' + clock : clock;
  }

  function formatTimer(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(function twoDigits(value) { return String(value).padStart(2, '0'); }).join(':');
  }

  function formatScore(value) {
    return Number(value || 0).toFixed(2).replace('.', ',').replace(/,00$/, '').replace(/(,\d)0$/, '$1');
  }

  function initCatalogPage() {
    const catalogNode = document.getElementById('exam-catalog');
    const statusNode = document.getElementById('catalog-status');
    if (!catalogNode || !statusNode) return;
    selectSubject(document.body.dataset.subject || document.body.dataset.page);

    function renderCatalog() {
      const exams = getExamCatalog(currentSubjectKey).filter(hasValidExamShape).slice().sort(function newestFirst(a, b) {
        return new Date(b.publishAt).getTime() - new Date(a.publishAt).getTime();
      });
      const now = Date.now();
      catalogNode.replaceChildren();
      catalogNode.setAttribute('aria-busy', 'false');

      if (!exams.length) {
        const empty = element('div', { className: 'empty-state' }, [
          element('div', { className: 'empty-state-icon', text: currentSubject.emptyIcon }),
          element('h2', { text: 'Chưa có đề ' + currentSubject.label }),
          element('p', { text: 'Hãy dùng công cụ tạo đề để soạn đề đầu tiên của bạn.' }),
          element('a', { className: 'btn btn-primary', href: currentSubject.builderPage, text: 'Tạo đề ' + currentSubject.label })
        ]);
        catalogNode.append(empty);
        statusNode.textContent = '0 đề đang mở';
        if (catalogHandle) clearInterval(catalogHandle);
        return;
      }

      let openCount = 0;
      let lockedCount = 0;
      exams.forEach(function renderExamCard(exam) {
        const publishAt = new Date(exam.publishAt).getTime();
        const isOpen = !Number.isFinite(publishAt) || now >= publishAt;
        if (isOpen) openCount += 1;
        else lockedCount += 1;

        const badges = element('div', { className: 'exam-card-badges' });
        badges.append(element('span', {
          className: 'status-badge ' + (isOpen ? 'status-open' : 'status-locked'),
          text: isOpen ? '● Đang mở' : '🔒 Chưa mở'
        }));
        const card = element('article', {
          className: 'exam-card' + (isOpen ? '' : ' exam-card-locked'),
          dataset: { publishMs: publishAt, locked: isOpen ? 'false' : 'true' }
        });
        const title = element('h3', { text: exam.title });
        const description = element('p', { className: 'exam-card-description', text: exam.description || 'Đề luyện tập ' + currentSubject.label + ' trực tuyến.' });
        const meta = element('div', { className: 'exam-card-meta' }, [
          element('span', { text: '⏱ ' + (Number(exam.standardDuration) || currentSubject.defaultDuration) + ' phút tiêu chuẩn' }),
          element('span', { text: '🧮 ' + totalQuestions() + ' câu · ' + totalResponses() + ' lượt trả lời' })
        ]);
        const release = element('p', { className: 'exam-release', text: 'Mở lúc: ' + formatPublishedTime(exam.publishAt, exam.timeZone) });
        const actions = element('div', { className: 'exam-card-actions' });
        if (isOpen) {
          actions.append(element('a', {
            className: 'btn btn-primary',
            href: 'exam.html?subject=' + encodeURIComponent(currentSubjectKey) + '&id=' + encodeURIComponent(exam.id),
            text: 'Làm bài →'
          }));
        } else {
          actions.append(element('span', { className: 'countdown-label', text: 'Còn ' }), element('strong', {
            className: 'catalog-countdown',
            text: formatCountdown(publishAt - now),
            dataset: { countdown: publishAt }
          }));
        }
        card.append(badges, title, description, meta, release, actions);
        catalogNode.append(card);
      });

      statusNode.textContent = openCount + ' đề đang mở' + (lockedCount ? ' · ' + lockedCount + ' đề sắp mở' : '');
      startCatalogTicker(renderCatalog);
    }

    renderCatalog();
  }

  function startCatalogTicker(renderCatalog) {
    if (catalogHandle) clearInterval(catalogHandle);
    const lockedCards = document.querySelectorAll('.exam-card[data-locked="true"]');
    if (!lockedCards.length) return;
    catalogHandle = window.setInterval(function updateCatalogCountdowns() {
      let needsRender = false;
      document.querySelectorAll('[data-countdown]').forEach(function updateCountdown(node) {
        const publishAt = Number(node.dataset.countdown);
        const remaining = publishAt - Date.now();
        if (remaining <= 0) needsRender = true;
        else node.textContent = formatCountdown(remaining);
      });
      if (needsRender) renderCatalog();
    }, 1000);
  }

  function initExamPage() {
    const app = document.getElementById('exam-app');
    if (!app) return;
    setupImageViewer();
    const params = new URLSearchParams(window.location.search);
    const previewMode = params.get('preview') === '1';
    const examId = params.get('id');
    const requestedSubject = params.get('subject');
    const subjectCandidates = requestedSubject === 'physics' || requestedSubject === 'math'
      ? [requestedSubject]
      : ['math', 'physics'];

    if (previewMode) {
      for (const subjectKey of subjectCandidates) {
        try {
          currentExam = JSON.parse(sessionStorage.getItem(subjectKey + '-exam-preview') || 'null');
        } catch (error) {
          currentExam = null;
        }
        if (currentExam) {
          selectSubject(subjectKey);
          break;
        }
      }
    } else {
      for (const subjectKey of subjectCandidates) {
        const match = getExamCatalog(subjectKey).find(function matchExam(exam) { return String(exam.id) === String(examId); }) || null;
        if (match) {
          currentExam = match;
          selectSubject(subjectKey);
          break;
        }
      }
    }

    if (!currentExam) selectSubject(subjectCandidates[0]);
    const headerBackLink = document.getElementById('exam-back-link');
    if (headerBackLink) {
      headerBackLink.href = currentSubject.catalogPage;
      headerBackLink.textContent = '← Danh sách đề ' + currentSubject.label;
    }

    if (!currentExam) {
      renderMessageState('Không tìm thấy đề thi', 'Đường dẫn có thể chưa đúng hoặc đề đã được gỡ khỏi danh sách.', 'Về danh sách đề', currentSubject.catalogPage);
      return;
    }
    if (!hasValidExamShape(currentExam)) {
      renderMessageState('Dữ liệu đề chưa hoàn chỉnh', 'Đề phải có đủ ' + currentSubject.mcCount + ' câu trắc nghiệm, ' + currentSubject.tfCount + ' câu đúng–sai và ' + currentSubject.shortCount + ' câu trả lời ngắn cùng đáp án.', 'Về danh sách đề', currentSubject.catalogPage);
      return;
    }

    document.title = currentExam.title + ' | Hana Exam Lab';
    stateKey = (previewMode ? 'hana-' + currentSubjectKey + '-preview-attempt:' : 'hana-' + currentSubjectKey + '-attempt:') + currentExam.id + ':v' + (Number(currentExam.version) || 1);
    const publishAt = new Date(currentExam.publishAt).getTime();
    if (!previewMode && Number.isFinite(publishAt) && Date.now() < publishAt) {
      renderLockedExam(publishAt);
      return;
    }
    openExamRoom();
  }

  function renderMessageState(titleText, bodyText, actionText, actionHref) {
    const app = document.getElementById('exam-app');
    const wrapper = element('div', { className: 'container state-container' }, [
      element('div', { className: 'state-card' }, [
        element('div', { className: 'state-icon', text: '!' }),
        element('h1', { text: titleText }),
        element('p', { text: bodyText }),
        element('a', { className: 'btn btn-primary', text: actionText, href: actionHref })
      ])
    ]);
    app.replaceChildren(wrapper);
  }

  function renderLockedExam(publishAt) {
    const app = document.getElementById('exam-app');
    const countdown = element('strong', { className: 'large-countdown', text: formatCountdown(publishAt - Date.now()) });
    const card = element('div', { className: 'state-card locked-state-card' }, [
      element('div', { className: 'state-icon', text: '🔒' }),
      element('span', { className: 'eyebrow', text: 'Đề chưa được công khai' }),
      element('h1', { text: currentExam.title }),
      element('p', { text: 'Đề sẽ tự động mở vào ' + formatPublishedTime(currentExam.publishAt, currentExam.timeZone) + '.' }),
      element('div', { className: 'countdown-panel' }, [element('span', { text: 'Thời gian còn lại' }), countdown]),
      element('a', { className: 'btn btn-secondary', href: currentSubject.catalogPage, text: '← Về danh sách đề ' + currentSubject.label })
    ]);
    app.replaceChildren(element('div', { className: 'container state-container' }, [card]));

    if (timerHandle) clearInterval(timerHandle);
    timerHandle = window.setInterval(function tickReleaseCountdown() {
      const remaining = publishAt - Date.now();
      if (remaining <= 0) {
        clearInterval(timerHandle);
        timerHandle = null;
        openExamRoom();
      } else {
        countdown.textContent = formatCountdown(remaining);
      }
    }, 1000);
  }

  function loadAttempt() {
    try {
      const saved = JSON.parse(localStorage.getItem(stateKey) || 'null');
      if (!saved || saved.examId !== currentExam.id || Number(saved.version) !== (Number(currentExam.version) || 1)) return null;
      if (!saved.answers || !Array.isArray(saved.answers.mc) || saved.answers.mc.length !== currentSubject.mcCount) return null;
      if (!Array.isArray(saved.answers.tf) || saved.answers.tf.length !== currentSubject.tfCount || !saved.answers.tf.every(function validTfRow(row) { return Array.isArray(row) && row.length === 4; })) return null;
      if (!Array.isArray(saved.answers.short) || saved.answers.short.length !== currentSubject.shortCount) return null;
      return saved;
    } catch (error) {
      return null;
    }
  }

  function openExamRoom() {
    attempt = loadAttempt();
    if (attempt && attempt.submittedAt) {
      renderResult();
      return;
    }
    if (attempt) {
      renderExamWorkspace();
      if (Number(attempt.endAt) <= Date.now()) finishExam('timeout');
      else startTimer();
      return;
    }
    renderExamLobby();
  }

  function renderExamLobby() {
    const app = document.getElementById('exam-app');
    const scoreRules = element('div', { className: 'score-rules' }, [
      element('div', { className: 'score-rule' }, [element('strong', { text: formatScore(currentSubject.mcMax) + ' điểm' }), element('span', { text: currentSubject.mcCount + ' câu trắc nghiệm' })]),
      element('div', { className: 'score-rule' }, [element('strong', { text: formatScore(currentSubject.tfMax) + ' điểm' }), element('span', { text: currentSubject.tfCount + ' câu đúng–sai' })]),
      element('div', { className: 'score-rule' }, [element('strong', { text: formatScore(currentSubject.shortMax) + ' điểm' }), element('span', { text: currentSubject.shortCount + ' câu trả lời ngắn' })])
    ]);
    const startButton = element('button', { className: 'btn btn-primary btn-large', type: 'button', text: 'Bắt đầu làm bài' });
    startButton.addEventListener('click', showStartDialog);
    const card = element('article', { className: 'exam-intro-card' }, [
      element('div', { className: 'exam-intro-copy' }, [
        element('span', { className: 'eyebrow', text: 'Đề ' + currentSubject.label + ' · Có chấm điểm' }),
        element('h1', { text: currentExam.title }),
        element('p', { className: 'lead', text: currentExam.description || 'Đề luyện tập ' + currentSubject.label + ' trực tuyến.' }),
        element('p', { className: 'exam-open-meta', text: 'Thời lượng tiêu chuẩn: ' + (Number(currentExam.standardDuration) || currentSubject.defaultDuration) + ' phút · Tổng điểm: 10' }),
        startButton,
        element('p', { className: 'privacy-note', text: 'Tên và kết quả chỉ được lưu trên thiết bị này; website không gửi bài về giáo viên.' })
      ]),
      scoreRules
    ]);
    app.replaceChildren(element('div', { className: 'container exam-lobby' }, [card]));
  }

  function showStartDialog() {
    const existing = document.getElementById('start-exam-dialog');
    if (existing) existing.remove();
    const dialog = element('dialog', { className: 'start-exam-dialog', id: 'start-exam-dialog' });
    const form = element('form', { className: 'start-exam-form', attrs: { method: 'dialog', novalidate: true } });
    const close = element('button', { className: 'dialog-close', type: 'button', text: '×', attrs: { 'aria-label': 'Đóng' } });
    const nameInput = element('input', {
      id: 'candidate-name',
      type: 'text',
      attrs: { required: true, maxlength: 80, autocomplete: 'name', placeholder: 'Ví dụ: Nguyễn Minh Anh' }
    });
    const durationSelect = element('select', { id: 'exam-duration', attrs: { required: true } });
    const standard = Number(currentExam.standardDuration) || currentSubject.defaultDuration;
    const durations = Array.from(new Set([15, 30, 45, 60, 90, 120, standard])).filter(function inRange(value) { return value >= 5 && value <= 240; }).sort(function numeric(a, b) { return a - b; });
    durations.forEach(function addDuration(minutes) {
      const option = element('option', { value: minutes, text: minutes + ' phút' + (minutes === standard ? ' (tiêu chuẩn)' : '') });
      if (minutes === standard) option.selected = true;
      durationSelect.append(option);
    });
    durationSelect.append(element('option', { value: 'custom', text: 'Thời gian khác…' }));
    const customInput = element('input', {
      id: 'custom-duration',
      type: 'number',
      attrs: { min: 5, max: 240, step: 1, placeholder: '5–240', hidden: true }
    });
    const customWrap = element('div', { className: 'custom-duration-wrap', attrs: { hidden: true } }, [
      element('label', { text: 'Số phút muốn làm', attrs: { for: 'custom-duration' } }), customInput
    ]);
    const errorNode = element('p', { className: 'form-error', attrs: { role: 'alert' } });
    const submit = element('button', { className: 'btn btn-primary btn-large', type: 'submit', text: 'Vào làm bài' });
    form.append(
      close,
      element('span', { className: 'eyebrow', text: 'Chuẩn bị làm bài' }),
      element('h2', { text: 'Nhập thông tin của bạn' }),
      element('label', { text: 'Họ và tên', attrs: { for: 'candidate-name' } }),
      nameInput,
      element('label', { text: 'Thời gian làm bài', attrs: { for: 'exam-duration' } }),
      durationSelect,
      customWrap,
      errorNode,
      submit
    );
    dialog.append(form);
    document.body.append(dialog);

    close.addEventListener('click', function closeDialog() { closeNativeDialog(dialog); });
    durationSelect.addEventListener('change', function toggleCustomDuration() {
      const isCustom = durationSelect.value === 'custom';
      customWrap.hidden = !isCustom;
      customInput.hidden = !isCustom;
      customInput.required = isCustom;
      if (isCustom) customInput.focus();
    });
    form.addEventListener('submit', function beginExam(event) {
      event.preventDefault();
      const candidateName = nameInput.value.trim();
      const duration = durationSelect.value === 'custom' ? Number(customInput.value) : Number(durationSelect.value);
      if (!candidateName) {
        errorNode.textContent = 'Vui lòng nhập họ và tên trước khi bắt đầu.';
        nameInput.focus();
        return;
      }
      if (!Number.isInteger(duration) || duration < 5 || duration > 240) {
        errorNode.textContent = 'Thời gian làm bài phải là số nguyên từ 5 đến 240 phút.';
        (durationSelect.value === 'custom' ? customInput : durationSelect).focus();
        return;
      }
      if (attempt || loadAttempt()) {
        closeNativeDialog(dialog);
        openExamRoom();
        return;
      }
      const startedAt = Date.now();
      attempt = {
        examId: currentExam.id,
        subject: currentSubjectKey,
        version: Number(currentExam.version) || 1,
        candidateName: candidateName,
        durationMinutes: duration,
        startedAt: startedAt,
        endAt: startedAt + duration * 60 * 1000,
        submittedAt: null,
        submitReason: null,
        answers: {
          mc: Array(currentSubject.mcCount).fill(null),
          tf: Array.from({ length: currentSubject.tfCount }, function emptyTf() { return Array(4).fill(null); }),
          short: Array(currentSubject.shortCount).fill('')
        },
        result: null
      };
      persistAttempt();
      closeNativeDialog(dialog);
      renderExamWorkspace();
      startTimer();
    });
    openNativeDialog(dialog);
    window.setTimeout(function focusName() { nameInput.focus(); }, 50);
  }

  function openNativeDialog(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeNativeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    dialog.remove();
  }

  function renderExamWorkspace() {
    const app = document.getElementById('exam-app');
    const timerNode = element('strong', { className: 'timer-value', id: 'exam-timer', text: formatTimer(Number(attempt.endAt) - Date.now()), attrs: { role: 'timer', 'aria-live': 'off' } });
    const progressNode = element('span', { className: 'progress-value', id: 'exam-progress', text: '0/' + totalResponses() + ' lượt trả lời' });
    const submitButton = element('button', { className: 'btn btn-danger', type: 'button', text: 'Nộp bài' });
    submitButton.addEventListener('click', requestManualSubmit);
    const toolbar = element('div', { className: 'exam-toolbar' }, [
      element('div', { className: 'exam-toolbar-inner container' }, [
        element('div', { className: 'candidate-chip' }, [element('span', { text: 'Thí sinh' }), element('strong', { text: attempt.candidateName })]),
        element('div', { className: 'timer-chip' }, [element('span', { text: 'Còn lại' }), timerNode]),
        element('div', { className: 'progress-chip' }, [element('span', { text: 'Tiến độ' }), progressNode]),
        submitButton
      ])
    ]);

    const palette = buildQuestionPalette();
    const content = element('div', { className: 'exam-content' });
    content.append(
      element('header', { className: 'exam-paper-header' }, [
        element('span', { className: 'eyebrow', text: 'Bài thi ' + currentSubject.label + ' trực tuyến' }),
        element('h1', { text: currentExam.title }),
        element('p', { text: 'Thời gian đã chọn: ' + attempt.durationMinutes + ' phút · Tổng điểm: 10' })
      ]),
      buildMultipleChoiceSection(),
      buildTrueFalseSection(),
      buildShortAnswerSection(),
      element('div', { className: 'exam-bottom-submit' }, [
        element('p', { text: 'Hãy kiểm tra lại các câu còn bỏ trống trước khi nộp.' }),
        (function bottomButton() {
          const button = element('button', { className: 'btn btn-danger btn-large', type: 'button', text: 'Nộp bài và xem điểm' });
          button.addEventListener('click', requestManualSubmit);
          return button;
        })()
      ])
    );
    const layout = element('div', { className: 'container exam-layout' }, [palette, content]);
    app.replaceChildren(toolbar, layout);
    updateProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function buildQuestionPalette() {
    const nav = element('aside', { className: 'question-palette', attrs: { 'aria-label': 'Điều hướng nhanh câu hỏi' } });
    nav.append(element('h2', { text: 'Câu hỏi' }));
    const groups = [
      { title: 'I. Trắc nghiệm', prefix: 'mc', count: currentSubject.mcCount },
      { title: 'II. Đúng – Sai', prefix: 'tf', count: currentSubject.tfCount },
      { title: 'III. Trả lời ngắn', prefix: 'short', count: currentSubject.shortCount }
    ];
    groups.forEach(function addPaletteGroup(group) {
      const grid = element('div', { className: 'palette-grid' });
      for (let index = 0; index < group.count; index += 1) {
        grid.append(element('a', {
          className: 'palette-item',
          href: '#' + group.prefix + '-q-' + (index + 1),
          text: index + 1,
          dataset: { palette: group.prefix + '-' + index },
          attrs: { 'aria-label': group.title + ', câu ' + (index + 1) }
        }));
      }
      nav.append(element('h3', { text: group.title }), grid);
    });
    nav.append(element('p', { className: 'palette-legend', text: '● Đã trả lời · ◐ Chưa đủ ý' }));
    return nav;
  }

  function buildSectionHeader(eyebrowText, titleText, noteText) {
    return element('header', { className: 'exam-section-header' }, [
      element('span', { className: 'eyebrow', text: eyebrowText }),
      element('h2', { text: titleText }),
      element('p', { text: noteText })
    ]);
  }

  function buildMultipleChoiceSection() {
    const section = element('section', { className: 'exam-section', id: 'part-one' });
    section.append(buildSectionHeader('Phần I · ' + formatScore(currentSubject.mcMax) + ' điểm', 'Trắc nghiệm nhiều lựa chọn', 'Từ câu 1 đến câu ' + currentSubject.mcCount + '. Mỗi câu chỉ chọn một phương án A, B, C hoặc D.'));
    currentExam.sections.multipleChoice.forEach(function addQuestion(question, questionIndex) {
      const fieldset = element('fieldset', { className: 'question-card', id: 'mc-q-' + (questionIndex + 1) });
      fieldset.append(element('legend', { text: 'Câu ' + (questionIndex + 1) }), buildQuestionImages(question, 'Câu ' + (questionIndex + 1) + ' phần trắc nghiệm'));
      const choices = element('div', { className: 'choice-grid mc-choice-grid' });
      ['A', 'B', 'C', 'D'].forEach(function addChoice(letter) {
        const inputId = 'mc-' + questionIndex + '-' + letter;
        const input = element('input', { id: inputId, type: 'radio', name: 'mc-' + questionIndex, value: letter });
        input.checked = attempt.answers.mc[questionIndex] === letter;
        input.addEventListener('change', function saveMcAnswer() {
          attempt.answers.mc[questionIndex] = letter;
          persistAttempt();
          updateProgress();
        });
        const label = element('label', { className: 'answer-option', attrs: { for: inputId } }, [input, element('span', { text: letter })]);
        choices.append(label);
      });
      fieldset.append(choices);
      section.append(fieldset);
    });
    return section;
  }

  function buildTrueFalseSection() {
    const section = element('section', { className: 'exam-section', id: 'part-two' });
    section.append(buildSectionHeader('Phần II · ' + formatScore(currentSubject.tfMax) + ' điểm', 'Trắc nghiệm Đúng – Sai', 'Từ câu 1 đến câu ' + currentSubject.tfCount + '. Với mỗi ý a, b, c, d, hãy chọn Đúng hoặc Sai.'));
    currentExam.sections.trueFalse.forEach(function addTfQuestion(question, questionIndex) {
      const fieldset = element('fieldset', { className: 'question-card', id: 'tf-q-' + (questionIndex + 1) });
      fieldset.append(element('legend', { text: 'Câu ' + (questionIndex + 1) }), buildQuestionImages(question, 'Câu ' + (questionIndex + 1) + ' phần đúng sai'));
      const statementList = element('div', { className: 'tf-statement-list' });
      ['a', 'b', 'c', 'd'].forEach(function addStatement(letter, statementIndex) {
        const row = element('div', { className: 'tf-answer-row' });
        row.append(element('strong', { className: 'tf-letter', text: letter + ')' }));
        const options = element('div', { className: 'tf-options' });
        [
          { label: 'Đúng', value: true },
          { label: 'Sai', value: false }
        ].forEach(function addTfOption(option) {
          const inputId = 'tf-' + questionIndex + '-' + statementIndex + '-' + String(option.value);
          const input = element('input', { id: inputId, type: 'radio', name: 'tf-' + questionIndex + '-' + statementIndex, value: String(option.value) });
          input.checked = attempt.answers.tf[questionIndex][statementIndex] === option.value;
          input.addEventListener('change', function saveTfAnswer() {
            attempt.answers.tf[questionIndex][statementIndex] = option.value;
            persistAttempt();
            updateProgress();
          });
          options.append(element('label', { className: 'answer-option tf-option', attrs: { for: inputId } }, [input, element('span', { text: option.label })]));
        });
        row.append(options);
        statementList.append(row);
      });
      fieldset.append(statementList);
      section.append(fieldset);
    });
    return section;
  }

  function buildShortAnswerSection() {
    const section = element('section', { className: 'exam-section', id: 'part-three' });
    section.append(buildSectionHeader('Phần III · ' + formatScore(currentSubject.shortMax) + ' điểm', 'Trắc nghiệm trả lời ngắn', 'Từ câu 1 đến câu ' + currentSubject.shortCount + '. Nhập đáp án tối đa 4 ký tự. Có thể dùng dấu phẩy hoặc dấu chấm thập phân.'));
    currentExam.sections.shortAnswer.forEach(function addShortQuestion(question, questionIndex) {
      const fieldset = element('fieldset', { className: 'question-card', id: 'short-q-' + (questionIndex + 1) });
      fieldset.append(element('legend', { text: 'Câu ' + (questionIndex + 1) }), buildQuestionImages(question, 'Câu ' + (questionIndex + 1) + ' phần trả lời ngắn'));
      const inputId = 'short-' + questionIndex;
      const input = element('input', {
        className: 'short-answer-input',
        id: inputId,
        type: 'text',
        value: attempt.answers.short[questionIndex] || '',
        attrs: { maxlength: 4, inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: 'Đáp án' }
      });
      input.addEventListener('input', function saveShortAnswer() {
        if (input.value.length > 4) input.value = input.value.slice(0, 4);
        attempt.answers.short[questionIndex] = input.value;
        persistAttempt();
        updateProgress();
      });
      fieldset.append(element('div', { className: 'short-answer-row' }, [
        element('label', { text: 'Đáp án của bạn:', attrs: { for: inputId } }),
        input,
        element('span', { className: 'character-hint', text: 'Tối đa 4 ký tự' })
      ]));
      section.append(fieldset);
    });
    return section;
  }

  function buildQuestionImages(question, altText) {
    const sources = questionImages(question);
    const gallery = element('div', { className: 'question-image-gallery' });
    gallery.setAttribute('aria-label', sources.length + ' ảnh cho ' + altText);
    sources.forEach(function addQuestionImage(safeSource, imageIndex) {
      const numberedAlt = altText + ', ảnh ' + (imageIndex + 1) + ' trên ' + sources.length;
      const image = element('img', { attrs: { src: safeSource, alt: numberedAlt, loading: 'lazy', decoding: 'async' } });
      const button = element('button', { className: 'question-image-button', type: 'button', attrs: { 'aria-label': 'Phóng to ' + numberedAlt } }, [image]);
      button.addEventListener('click', function openImage() { showQuestionImage(safeSource, numberedAlt); });
      image.addEventListener('error', function imageError() {
        button.disabled = true;
        button.classList.add('image-error');
        image.alt = 'Không tải được ảnh câu hỏi';
      });
      gallery.append(button);
    });
    return gallery;
  }

  function safeImageSource(source) {
    const value = String(source || '').trim();
    if (/^javascript:/i.test(value)) return '';
    if (/^data:/i.test(value) && !/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(value)) return '';
    return value;
  }

  function setupImageViewer() {
    const dialog = document.getElementById('image-viewer');
    const close = dialog ? dialog.querySelector('[data-close-image]') : null;
    if (!dialog || !close) return;
    close.addEventListener('click', function closeViewer() {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    });
    dialog.addEventListener('click', function closeOnBackdrop(event) {
      if (event.target === dialog) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
    });
  }

  function showQuestionImage(source, altText) {
    const dialog = document.getElementById('image-viewer');
    const image = document.getElementById('image-viewer-content');
    if (!dialog || !image || !source) return;
    image.src = source;
    image.alt = altText + ' (phóng to)';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function persistAttempt() {
    if (!attempt || !stateKey) return;
    try {
      localStorage.setItem(stateKey, JSON.stringify(attempt));
    } catch (error) {
      announce('Không thể lưu tiến độ trên thiết bị này. Hãy tiếp tục làm bài và tránh tải lại trang.');
    }
  }

  function countAnsweredResponses() {
    if (!attempt) return 0;
    const mcCount = attempt.answers.mc.filter(function answered(answer) { return answer !== null && answer !== ''; }).length;
    const tfCount = attempt.answers.tf.reduce(function countTf(total, answers) {
      return total + answers.filter(function answered(answer) { return typeof answer === 'boolean'; }).length;
    }, 0);
    const shortCount = attempt.answers.short.filter(function answered(answer) { return String(answer || '').trim().length > 0; }).length;
    return mcCount + tfCount + shortCount;
  }

  function updateProgress() {
    const answered = countAnsweredResponses();
    const progress = document.getElementById('exam-progress');
    if (progress) progress.textContent = answered + '/' + totalResponses() + ' lượt trả lời';

    attempt.answers.mc.forEach(function updateMc(answer, index) {
      setPaletteState('mc-' + index, answer !== null && answer !== '', false);
    });
    attempt.answers.tf.forEach(function updateTf(answers, index) {
      const count = answers.filter(function answered(answer) { return typeof answer === 'boolean'; }).length;
      setPaletteState('tf-' + index, count === 4, count > 0 && count < 4);
    });
    attempt.answers.short.forEach(function updateShort(answer, index) {
      setPaletteState('short-' + index, String(answer || '').trim().length > 0, false);
    });
  }

  function setPaletteState(key, complete, partial) {
    const node = document.querySelector('[data-palette="' + key + '"]');
    if (!node) return;
    node.classList.toggle('is-complete', complete);
    node.classList.toggle('is-partial', partial);
  }

  function startTimer() {
    if (timerHandle) clearInterval(timerHandle);
    announcedFiveMinutes = false;
    announcedOneMinute = false;
    tickExamTimer();
    timerHandle = window.setInterval(tickExamTimer, 1000);
  }

  function tickExamTimer() {
    if (!attempt || attempt.submittedAt) {
      if (timerHandle) clearInterval(timerHandle);
      timerHandle = null;
      return;
    }
    const remaining = Number(attempt.endAt) - Date.now();
    const timer = document.getElementById('exam-timer');
    if (timer) {
      timer.textContent = formatTimer(remaining);
      timer.closest('.timer-chip')?.classList.toggle('timer-warning', remaining <= 5 * 60 * 1000);
      timer.closest('.timer-chip')?.classList.toggle('timer-critical', remaining <= 60 * 1000);
    }
    if (remaining <= 5 * 60 * 1000 && remaining > 60 * 1000 && !announcedFiveMinutes) {
      announcedFiveMinutes = true;
      announce('Bạn còn 5 phút làm bài.');
    }
    if (remaining <= 60 * 1000 && remaining > 0 && !announcedOneMinute) {
      announcedOneMinute = true;
      announce('Bạn còn 1 phút làm bài.');
    }
    if (remaining <= 0) finishExam('timeout');
  }

  function announce(message) {
    const node = document.getElementById('exam-announcement');
    if (!node) return;
    node.textContent = '';
    window.setTimeout(function setAnnouncement() { node.textContent = message; }, 20);
  }

  function requestManualSubmit() {
    if (!attempt || attempt.submittedAt || finishing) return;
    const unanswered = totalResponses() - countAnsweredResponses();
    const message = unanswered > 0
      ? 'Bạn còn ' + unanswered + ' lượt trả lời đang bỏ trống. Bạn vẫn muốn nộp bài?'
      : 'Bạn đã trả lời đủ. Nộp bài và xem điểm ngay?';
    if (window.confirm(message)) finishExam('manual');
  }

  function normalizeShortAnswer(value) {
    return String(value === null || value === undefined ? '' : value)
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[−–—]/g, '-')
      .replace(/,/g, '.')
      .toUpperCase();
  }

  function acceptedShortAnswers(answerKey) {
    return String(answerKey).split('|').map(normalizeShortAnswer).filter(Boolean);
  }

  function calculateResult() {
    const mcDetails = currentExam.sections.multipleChoice.map(function scoreMc(question, index) {
      const key = String(question.answer).toUpperCase();
      const given = attempt.answers.mc[index];
      return { given: given, key: key, correct: given === key, points: given === key ? currentSubject.mcPoint : 0 };
    });
    const tfDetails = currentExam.sections.trueFalse.map(function scoreTf(question, questionIndex) {
      const given = attempt.answers.tf[questionIndex];
      const correctStatements = question.answers.reduce(function countCorrect(total, answer, statementIndex) {
        return total + (given[statementIndex] === answer ? 1 : 0);
      }, 0);
      return {
        given: given.slice(),
        key: question.answers.slice(),
        correctStatements: correctStatements,
        points: TF_POINT_TABLE[correctStatements]
      };
    });
    const shortDetails = currentExam.sections.shortAnswer.map(function scoreShort(question, index) {
      const given = attempt.answers.short[index] || '';
      const accepted = acceptedShortAnswers(question.answer);
      const correct = accepted.includes(normalizeShortAnswer(given));
      return { given: given, key: String(question.answer), correct: correct, points: correct ? currentSubject.shortPoint : 0 };
    });
    const mcScore = mcDetails.reduce(function sum(total, detail) { return total + detail.points; }, 0);
    const tfScore = tfDetails.reduce(function sum(total, detail) { return total + detail.points; }, 0);
    const shortScore = shortDetails.reduce(function sum(total, detail) { return total + detail.points; }, 0);
    return {
      mcScore: Number(mcScore.toFixed(2)),
      tfScore: Number(tfScore.toFixed(2)),
      shortScore: Number(shortScore.toFixed(2)),
      total: Number((mcScore + tfScore + shortScore).toFixed(2)),
      mcCorrect: mcDetails.filter(function correct(detail) { return detail.correct; }).length,
      shortCorrect: shortDetails.filter(function correct(detail) { return detail.correct; }).length,
      mcDetails: mcDetails,
      tfDetails: tfDetails,
      shortDetails: shortDetails
    };
  }

  function finishExam(reason) {
    if (!attempt || attempt.submittedAt || finishing) return;
    finishing = true;
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
    attempt.result = calculateResult();
    attempt.submittedAt = Date.now();
    attempt.submitReason = reason;
    persistAttempt();
    renderResult();
    announce(reason === 'timeout' ? 'Đã hết giờ. Bài của bạn được tự động nộp.' : 'Đã nộp bài và chấm điểm.');
    finishing = false;
  }

  function renderResult() {
    const app = document.getElementById('exam-app');
    if (!attempt.result) {
      attempt.result = calculateResult();
      persistAttempt();
    }
    const result = attempt.result;
    const reasonText = attempt.submitReason === 'timeout' ? 'Tự động nộp do hết giờ' : 'Nộp bài thành công';
    const hero = element('section', { className: 'result-hero' }, [
      element('span', { className: 'eyebrow', text: reasonText }),
      element('h1', { text: attempt.candidateName }),
      element('p', { className: 'result-exam-title', text: currentExam.title }),
      element('div', { className: 'score-circle' }, [
        element('strong', { text: formatScore(result.total) }),
        element('span', { text: '/ 10' })
      ])
    ]);
    const summary = element('div', { className: 'result-summary-grid' }, [
      resultSummaryCard('Phần I', formatScore(result.mcScore) + ' / ' + formatScore(currentSubject.mcMax), result.mcCorrect + '/' + currentSubject.mcCount + ' câu đúng'),
      resultSummaryCard('Phần II', formatScore(result.tfScore) + ' / ' + formatScore(currentSubject.tfMax), 'Chấm theo số ý đúng từng câu'),
      resultSummaryCard('Phần III', formatScore(result.shortScore) + ' / ' + formatScore(currentSubject.shortMax), result.shortCorrect + '/' + currentSubject.shortCount + ' câu đúng')
    ]);
    const actions = element('div', { className: 'result-actions' });
    const retry = element('button', { className: 'btn btn-secondary', type: 'button', text: 'Làm lại đề này' });
    retry.addEventListener('click', function retryExam() {
      if (!window.confirm('Xóa kết quả hiện tại và bắt đầu một lượt làm bài mới?')) return;
      localStorage.removeItem(stateKey);
      window.location.reload();
    });
    actions.append(element('a', { className: 'btn btn-primary', href: currentSubject.catalogPage, text: '← Về danh sách đề ' + currentSubject.label }), retry);

    const review = element('section', { className: 'answer-review' }, [element('h2', { text: 'Xem lại đáp án' })]);
    review.append(buildMcReview(result.mcDetails), buildTfReview(result.tfDetails), buildShortReview(result.shortDetails));
    app.replaceChildren(element('div', { className: 'container result-container' }, [hero, summary, actions, review]));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resultSummaryCard(title, score, detail) {
    return element('article', { className: 'result-summary-card' }, [
      element('span', { text: title }), element('strong', { text: score }), element('small', { text: detail })
    ]);
  }

  function buildReviewDetails(title, summaryText) {
    const details = element('details', { className: 'review-group' });
    details.append(element('summary', { text: title + ' · ' + summaryText }), element('div', { className: 'review-list' }));
    return details;
  }

  function reviewRow(number, isCorrect, userText, keyText, pointsText) {
    return element('article', { className: 'review-row ' + (isCorrect ? 'review-correct' : 'review-wrong') }, [
      element('strong', { text: 'Câu ' + number }),
      element('span', { text: isCorrect ? '✓ Đúng' : '✕ Chưa đúng' }),
      element('span', { text: 'Bạn chọn: ' + userText }),
      element('span', { text: 'Đáp án: ' + keyText }),
      element('b', { text: pointsText })
    ]);
  }

  function buildMcReview(detailsData) {
    const correctCount = detailsData.filter(function correct(detail) { return detail.correct; }).length;
    const details = buildReviewDetails('I. Trắc nghiệm', correctCount + '/' + currentSubject.mcCount + ' câu đúng');
    const list = details.querySelector('.review-list');
    detailsData.forEach(function addRow(detail, index) {
      list.append(reviewRow(index + 1, detail.correct, detail.given || 'Bỏ trống', detail.key, formatScore(detail.points) + ' điểm'));
    });
    return details;
  }

  function boolAnswer(value) {
    if (value === true) return 'Đ';
    if (value === false) return 'S';
    return '–';
  }

  function buildTfReview(detailsData) {
    const details = buildReviewDetails('II. Đúng – Sai', formatScore(attempt.result.tfScore) + '/' + formatScore(currentSubject.tfMax) + ' điểm');
    const list = details.querySelector('.review-list');
    detailsData.forEach(function addRow(detail, index) {
      const given = detail.given.map(boolAnswer).join(' · ');
      const key = detail.key.map(boolAnswer).join(' · ');
      list.append(reviewRow(index + 1, detail.correctStatements === 4, given, key, detail.correctStatements + '/4 ý · ' + formatScore(detail.points) + ' điểm'));
    });
    return details;
  }

  function buildShortReview(detailsData) {
    const correctCount = detailsData.filter(function correct(detail) { return detail.correct; }).length;
    const details = buildReviewDetails('III. Trả lời ngắn', correctCount + '/' + currentSubject.shortCount + ' câu đúng');
    const list = details.querySelector('.review-list');
    detailsData.forEach(function addRow(detail, index) {
      list.append(reviewRow(index + 1, detail.correct, detail.given || 'Bỏ trống', detail.key.split('|').join(' hoặc '), formatScore(detail.points) + ' điểm'));
    });
    return details;
  }

  window.addEventListener('beforeunload', function warnBeforeLeaving(event) {
    if (!attempt || attempt.submittedAt) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.addEventListener('storage', function syncSubmittedAttempt(event) {
    if (!stateKey || event.key !== stateKey || !event.newValue) return;
    try {
      const updated = JSON.parse(event.newValue);
      if (updated && updated.submittedAt) {
        attempt = updated;
        renderResult();
      }
    } catch (error) {
      // Ignore malformed state from another tab.
    }
  });

  document.addEventListener('DOMContentLoaded', function routePage() {
    const page = document.body.dataset.page;
    if (page === 'math' || page === 'physics' || page === 'catalog') initCatalogPage();
    if (page === 'exam') initExamPage();
  });
})();
