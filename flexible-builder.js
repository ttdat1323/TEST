(function () {
  'use strict';

  const Core = window.HanaFlexible || {};
  const DB_NAME = 'hana-flexible-builder-v1';
  const DB_STORE = 'workspace';
  const DB_KEY = 'current';
  const FALLBACK_KEY = 'hana-flexible-builder-workspace-v1';
  const PREVIEW_KEY = 'hana-flexible-exam-preview';
  const TYPE_LABELS = Object.assign({
    multipleChoice: 'Trắc nghiệm',
    trueFalse: 'Đúng / Sai',
    shortAnswer: 'Trả lời ngắn',
    fillBlank: 'Đục lỗ',
    essay: 'Tự luận'
  }, Core.TYPE_LABELS || {});
  const TYPES = Object.keys(TYPE_LABELS).filter((type) => ['multipleChoice', 'trueFalse', 'shortAnswer', 'fillBlank', 'essay'].includes(type));

  const state = {
    draft: null,
    catalog: [],
    deletedIds: new Set(),
    saveTimer: 0,
    toastTimer: 0,
    db: null
  };

  const dom = {};

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID().slice(0, 8)}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function defaultPublishAt() {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    date.setMinutes(0, 0, 0);
    return date.toISOString();
  }

  function fallbackQuestion(type) {
    const base = { id: uid('q'), type, points: 1, prompt: '', images: [] };
    if (type === 'multipleChoice') {
      base.options = ['A', 'B', 'C', 'D'].map((id) => ({ id, text: '' }));
      base.correctOptionId = '';
    } else if (type === 'trueFalse') {
      base.statements = ['a', 'b', 'c', 'd'].map((id) => ({ id, text: '', answer: null }));
      base.scoringMode = 'proportional';
    } else if (type === 'shortAnswer') {
      base.acceptedAnswers = [''];
      base.maxLength = 120;
      base.caseSensitive = false;
    } else if (type === 'fillBlank') {
      base.blanks = [{ id: 'b1', label: 'Ô trống 1', acceptedAnswers: [''] }];
      base.scoringMode = 'proportional';
    } else if (type === 'essay') {
      base.maxLength = 5000;
    }
    return base;
  }

  function newQuestion(type) {
    const safeType = TYPES.includes(type) ? type : 'multipleChoice';
    let question;
    try {
      question = typeof Core.createQuestion === 'function' ? Core.createQuestion(safeType) : null;
    } catch (_) {
      question = null;
    }
    return ensureQuestion(question || fallbackQuestion(safeType));
  }

  function fallbackExam() {
    return {
      schemaVersion: 1,
      kind: 'flexible',
      id: '',
      title: '',
      description: '',
      publishAt: defaultPublishAt(),
      timeZone: 'Australia/Sydney',
      standardDuration: 45,
      version: 1,
      access: { allowedEmailDomains: ['ad.unsw.edu.au'] },
      questions: []
    };
  }

  function newExam() {
    let exam;
    try {
      exam = typeof Core.createExam === 'function' ? Core.createExam({ timeZone: 'Australia/Sydney' }) : null;
    } catch (_) {
      exam = null;
    }
    const value = Object.assign(fallbackExam(), exam || {});
    if (!value.publishAt) value.publishAt = defaultPublishAt();
    return ensureExam(value);
  }

  function ensureQuestion(input) {
    const type = TYPES.includes(input && input.type) ? input.type : 'multipleChoice';
    const template = fallbackQuestion(type);
    const question = Object.assign(template, clone(input || {}), { type });
    question.id = String(question.id || uid('q'));
    question.points = Number(question.points);
    if (!Number.isFinite(question.points)) question.points = 1;
    else question.points = Math.max(0, question.points);
    question.prompt = String(question.prompt || question.text || '');
    question.images = Array.isArray(question.images) ? question.images.filter((item) => typeof item === 'string' && item) : [];

    if (type === 'multipleChoice') {
      question.options = Array.isArray(question.options) && question.options.length >= 2
        ? question.options.slice(0, 8).map((option, index) => ({
          id: String(option && option.id || String.fromCharCode(65 + index)),
          text: String(option && option.text || '')
        }))
        : template.options;
      question.correctOptionId = String(question.correctOptionId || question.answer || '');
    } else if (type === 'trueFalse') {
      question.statements = Array.isArray(question.statements) && question.statements.length
        ? question.statements.slice(0, 8).map((statement, index) => ({
          id: String(statement && statement.id || String.fromCharCode(97 + index)),
          text: String(statement && statement.text || ''),
          answer: statement && typeof statement.answer === 'boolean' ? statement.answer : null
        }))
        : template.statements;
      question.scoringMode = 'proportional';
    } else if (type === 'shortAnswer') {
      question.acceptedAnswers = Array.isArray(question.acceptedAnswers)
        ? question.acceptedAnswers.map(String)
        : String(question.answer || '').split('|');
      if (!question.acceptedAnswers.length) question.acceptedAnswers = [''];
      question.maxLength = clampInt(question.maxLength, 1, 1000, 120);
      question.caseSensitive = Boolean(question.caseSensitive);
    } else if (type === 'fillBlank') {
      question.blanks = Array.isArray(question.blanks) && question.blanks.length
        ? question.blanks.slice(0, 10).map((blank, index) => ({
          id: String(blank && blank.id || `b${index + 1}`),
          label: String(blank && blank.label || `Ô trống ${index + 1}`),
          acceptedAnswers: Array.isArray(blank && blank.acceptedAnswers)
            ? blank.acceptedAnswers.map(String)
            : String(blank && blank.answer || '').split('|')
        }))
        : template.blanks;
      question.scoringMode = 'proportional';
    } else if (type === 'essay') {
      question.maxLength = clampInt(question.maxLength, 100, 20000, 5000);
    }
    return question;
  }

  function ensureExam(input) {
    let normalized = input;
    try {
      if (typeof Core.normalizeExam === 'function') normalized = Core.normalizeExam(input);
    } catch (_) {
      normalized = input;
    }
    const exam = Object.assign(fallbackExam(), clone(normalized || input || {}));
    exam.schemaVersion = 1;
    exam.kind = 'flexible';
    exam.id = String(exam.id || '');
    exam.title = String(exam.title || '');
    exam.description = String(exam.description || '');
    exam.publishAt = String(exam.publishAt || defaultPublishAt());
    exam.timeZone = String(exam.timeZone || 'Australia/Sydney');
    exam.standardDuration = clampInt(exam.standardDuration, 5, 360, 45);
    exam.version = clampInt(exam.version, 1, 1000000, 1);
    exam.access = exam.access && typeof exam.access === 'object' ? exam.access : {};
    const domains = exam.access.allowedEmailDomains || exam.allowedEmailDomains || [];
    exam.access.allowedEmailDomains = normalizeDomains(Array.isArray(domains) ? domains.join(',') : String(domains));
    exam.questions = Array.isArray(exam.questions) ? exam.questions.map(ensureQuestion) : [];
    return exam;
  }

  function clampInt(value, min, max, fallback) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function normalizeDomains(value) {
    return String(value || '')
      .split(/[;,\s]+/)
      .map((item) => item.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, ''))
      .filter((item, index, all) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(item) && item.includes('.') && all.indexOf(item) === index);
  }

  function formatNumber(value) {
    const number = Math.round((Number(value) || 0) * 100) / 100;
    return number.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  }

  function localTotals(exam) {
    return (exam.questions || []).reduce((totals, question) => {
      const points = Math.max(0, Number(question.points) || 0);
      if (question.type === 'essay') totals.essayMax += points;
      else totals.objectiveMax += points;
      totals.totalMax += points;
      return totals;
    }, { objectiveMax: 0, essayMax: 0, totalMax: 0 });
  }

  function getTotals(exam) {
    let totals;
    try {
      if (typeof Core.totals === 'function') totals = Core.totals(exam);
      else if (typeof Core.getTotals === 'function') totals = Core.getTotals(exam);
      else if (typeof Core.examTotals === 'function') totals = Core.examTotals(exam);
    } catch (_) {
      totals = null;
    }
    if (!totals) return localTotals(exam);
    return {
      objectiveMax: Number(totals.objectiveMax != null ? totals.objectiveMax : totals.autoMax) || 0,
      essayMax: Number(totals.essayMax) || 0,
      totalMax: Number(totals.totalMax) || ((Number(totals.objectiveMax) || 0) + (Number(totals.essayMax) || 0))
    };
  }

  function el(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function button(text, className) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
  }

  async function init() {
    cacheDom();
    bindStaticEvents();
    const workspace = await readWorkspace();
    const deployed = Array.isArray(window.FLEXIBLE_EXAMS) ? window.FLEXIBLE_EXAMS.map(ensureExam) : [];
    state.deletedIds = new Set(Array.isArray(workspace && workspace.deletedIds) ? workspace.deletedIds.map(String) : []);
    const merged = new Map();
    deployed.forEach((exam) => {
      if (!state.deletedIds.has(exam.id)) merged.set(exam.id, exam);
    });
    if (workspace && Array.isArray(workspace.catalog)) {
      workspace.catalog.map(ensureExam).forEach((exam) => {
        const current = merged.get(exam.id);
        if (!current || Number(exam.version || 0) >= Number(current.version || 0)) merged.set(exam.id, exam);
      });
    }
    state.catalog = Array.from(merged.values());
    state.draft = workspace && workspace.draft ? ensureExam(workspace.draft) : newExam();
    populateMetadata();
    renderQuestions();
    renderCatalog();
    updateSummary();
  }

  function cacheDom() {
    dom.form = document.getElementById('flex-builder-form');
    dom.title = document.getElementById('flex-title');
    dom.id = document.getElementById('flex-id');
    dom.duration = document.getElementById('flex-duration');
    dom.publish = document.getElementById('flex-publish');
    dom.timeZone = document.getElementById('flex-timezone');
    dom.domains = document.getElementById('flex-domains');
    dom.description = document.getElementById('flex-description');
    dom.questionList = document.getElementById('flex-question-list');
    dom.catalogList = document.getElementById('flex-catalog-list');
    dom.errorSummary = document.getElementById('flex-error-summary');
    dom.toast = document.getElementById('flex-toast');
    dom.autosave = document.getElementById('flex-autosave-status');
    dom.questionCount = document.getElementById('flex-question-count');
    dom.completion = document.getElementById('flex-completion');
    dom.progressBar = document.getElementById('flex-progress-bar');
    dom.objectiveTotal = document.getElementById('flex-objective-total');
    dom.essayTotal = document.getElementById('flex-essay-total');
    dom.allTotal = document.getElementById('flex-all-total');
    dom.importFile = document.getElementById('flex-import-file');
  }

  function bindStaticEvents() {
    [dom.title, dom.id, dom.duration, dom.publish, dom.timeZone, dom.domains, dom.description].forEach((input) => {
      input.addEventListener('input', syncMetadataFromForm);
      input.addEventListener('change', syncMetadataFromForm);
    });
    document.querySelectorAll('[data-add-question]').forEach((control) => {
      control.addEventListener('click', () => addQuestion(control.dataset.addQuestion));
    });
    document.getElementById('flex-save-btn').addEventListener('click', saveExam);
    document.getElementById('flex-preview-btn').addEventListener('click', previewExam);
    document.getElementById('flex-new-btn').addEventListener('click', resetDraft);
    document.getElementById('flex-export-public-btn').addEventListener('click', exportPublicCatalog);
    document.getElementById('flex-export-keys-btn').addEventListener('click', exportAnswerKeys);
    document.getElementById('flex-export-backup-btn').addEventListener('click', exportBackup);
    document.getElementById('flex-import-btn').addEventListener('click', () => dom.importFile.click());
    dom.importFile.addEventListener('change', importBackup);
  }

  function syncMetadataFromForm() {
    state.draft.title = dom.title.value.trim();
    state.draft.id = dom.id.value.trim().toLowerCase();
    state.draft.standardDuration = clampInt(dom.duration.value, 5, 360, 45);
    state.draft.timeZone = dom.timeZone.value;
    state.draft.description = dom.description.value.trim();
    state.draft.access.allowedEmailDomains = normalizeDomains(dom.domains.value);
    try {
      state.draft.publishAt = dom.publish.value ? zonedLocalToIso(dom.publish.value, state.draft.timeZone) : '';
    } catch (_) {
      state.draft.publishAt = '';
    }
    scheduleSave();
    updateSummary();
  }

  function populateMetadata() {
    dom.title.value = state.draft.title || '';
    dom.id.value = state.draft.id || '';
    dom.duration.value = String(state.draft.standardDuration || 45);
    dom.publish.value = isoToZonedInput(state.draft.publishAt || defaultPublishAt(), state.draft.timeZone || 'Australia/Sydney');
    dom.timeZone.value = state.draft.timeZone || 'Australia/Sydney';
    dom.domains.value = (state.draft.access.allowedEmailDomains || []).join(', ');
    dom.description.value = state.draft.description || '';
  }

  function zonedLocalToIso(localValue, timeZone) {
    const match = String(localValue).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match || !isSupportedTimeZone(timeZone)) throw new Error('Invalid zoned date');
    const desired = {
      year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
      hour: Number(match[4]), minute: Number(match[5]), second: 0
    };
    const desiredAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, 0);
    let guess = desiredAsUtc;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const observed = zonedParts(new Date(guess), timeZone);
      const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
      const difference = desiredAsUtc - observedAsUtc;
      if (difference === 0) break;
      guess += difference;
    }
    const finalParts = zonedParts(new Date(guess), timeZone);
    if (finalParts.year !== desired.year || finalParts.month !== desired.month || finalParts.day !== desired.day || finalParts.hour !== desired.hour || finalParts.minute !== desired.minute) {
      throw new Error('Nonexistent zoned time');
    }
    return new Date(guess).toISOString();
  }

  function isoToZonedInput(isoValue, timeZone) {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime()) || !isSupportedTimeZone(timeZone)) return '';
    const parts = zonedParts(date, timeZone);
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
  }

  function zonedParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    });
    const parts = {};
    formatter.formatToParts(date).forEach((part) => {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    });
    return parts;
  }

  function isSupportedTimeZone(timeZone) {
    if (!['Asia/Ho_Chi_Minh', 'Australia/Sydney', 'UTC'].includes(String(timeZone))) return false;
    try {
      new Intl.DateTimeFormat('en', { timeZone }).format();
      return true;
    } catch (_) {
      return false;
    }
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function addQuestion(type) {
    state.draft.questions.push(newQuestion(type));
    renderQuestions();
    updateSummary();
    scheduleSave();
    const cards = dom.questionList.querySelectorAll('.flex-question-card');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderQuestions() {
    dom.questionList.replaceChildren();
    if (!state.draft.questions.length) {
      const empty = el('div', 'empty-state compact-empty');
      empty.append(el('span', 'empty-state-icon', '＋'), el('h3', '', 'Chưa có câu hỏi'), el('p', '', 'Chọn một dạng câu ở phía trên để bắt đầu.'));
      dom.questionList.append(empty);
      return;
    }
    state.draft.questions.forEach((question, index) => dom.questionList.append(createQuestionCard(question, index)));
  }

  function createQuestionCard(question, index) {
    const card = el('article', 'builder-question-card flex-question-card');
    card.dataset.questionId = question.id;
    card.id = `flex-question-${question.id}`;

    const heading = el('div', 'question-card-heading flex-question-toolbar');
    const titleWrap = el('div', 'flex-question-heading-copy');
    titleWrap.append(el('span', 'flex-type-badge', `Câu ${index + 1}`), el('h3', '', TYPE_LABELS[question.type] || question.type));

    const toolbar = el('div', 'inline-actions flex-question-actions');
    const up = button('↑', 'btn btn-small btn-secondary');
    up.title = 'Đưa câu lên';
    up.disabled = index === 0;
    up.addEventListener('click', () => moveQuestion(index, -1));
    const down = button('↓', 'btn btn-small btn-secondary');
    down.title = 'Đưa câu xuống';
    down.disabled = index === state.draft.questions.length - 1;
    down.addEventListener('click', () => moveQuestion(index, 1));
    const duplicate = button('Nhân bản', 'btn btn-small btn-secondary');
    duplicate.addEventListener('click', () => duplicateQuestion(index));
    const remove = button('Xóa', 'btn btn-small btn-danger');
    remove.addEventListener('click', () => removeQuestion(index));
    toolbar.append(up, down, duplicate, remove);
    heading.append(titleWrap, toolbar);
    card.append(heading);

    const basics = el('div', 'form-grid two-columns flex-question-basics');
    const typeField = el('div', 'form-field');
    const typeLabel = el('label', '', 'Dạng câu');
    const typeSelect = el('select');
    TYPES.forEach((type) => {
      const option = el('option', '', TYPE_LABELS[type]);
      option.value = type;
      option.selected = type === question.type;
      typeSelect.append(option);
    });
    typeSelect.addEventListener('change', () => changeQuestionType(index, typeSelect.value));
    typeField.append(typeLabel, typeSelect);

    const pointsField = el('div', 'form-field flex-points-field');
    const pointsLabel = el('label', '', question.type === 'essay' ? 'Điểm tự luận' : 'Điểm tự chấm');
    const points = el('input');
    points.type = 'number';
    points.min = '0.01';
    points.max = '1000';
    points.step = '0.05';
    points.value = String(question.points);
    points.addEventListener('input', () => {
      const value = Number(points.value);
      question.points = points.value !== '' && Number.isFinite(value) && value > 0
        ? Math.round(value * 100) / 100
        : 0;
      updateSummary();
      scheduleSave();
    });
    pointsField.append(pointsLabel, points);
    basics.append(typeField, pointsField);
    card.append(basics);

    const promptField = el('div', 'form-field full-width');
    const promptLabel = el('label', '', question.type === 'fillBlank' ? 'Nội dung câu hỏi (có thể dùng {{1}}, {{2}} để đánh dấu ô)' : 'Nội dung câu hỏi (không bắt buộc nếu đã có ảnh)');
    const prompt = el('textarea');
    prompt.rows = 3;
    prompt.maxLength = 4000;
    prompt.value = question.prompt;
    prompt.placeholder = question.type === 'fillBlank' ? 'Ví dụ: Công thức của nước là {{1}}.' : 'Nhập nội dung hoặc hướng dẫn cho câu này...';
    prompt.addEventListener('input', () => {
      question.prompt = prompt.value;
      updateSummary();
      scheduleSave();
    });
    promptField.append(promptLabel, prompt);
    card.append(promptField, createImageEditor(question), createTypeConfig(question, index));
    return card;
  }

  function createImageEditor(question) {
    const wrapper = el('section', 'image-editor flex-image-editor');
    const heading = el('div', 'image-editor-heading');
    heading.append(el('strong', '', 'Hình ảnh câu hỏi'), el('span', '', `${question.images.length} ảnh`));
    wrapper.append(heading);

    if (question.images.length) {
      const gallery = el('div', 'builder-image-gallery flex-image-gallery');
      question.images.forEach((source, imageIndex) => {
        const item = el('figure', 'builder-image-item flex-image-item');
        const frame = el('div', 'builder-image-preview flex-image-frame');
        const image = el('img');
        image.src = source;
        image.alt = `Ảnh ${imageIndex + 1} của câu hỏi`;
        frame.append(image);
        const actions = el('figcaption', 'builder-image-actions flex-image-actions');
        actions.append(el('span', 'builder-image-number', `Ảnh ${imageIndex + 1}`));
        const earlier = button('←', 'btn btn-small btn-secondary');
        earlier.disabled = imageIndex === 0;
        earlier.title = 'Đưa ảnh sang trước';
        earlier.addEventListener('click', () => moveImage(question, imageIndex, -1));
        const later = button('→', 'btn btn-small btn-secondary');
        later.disabled = imageIndex === question.images.length - 1;
        later.title = 'Đưa ảnh ra sau';
        later.addEventListener('click', () => moveImage(question, imageIndex, 1));
        const remove = button('Xóa', 'btn btn-small btn-danger');
        remove.addEventListener('click', () => {
          question.images.splice(imageIndex, 1);
          renderQuestions();
          updateSummary();
          scheduleSave();
        });
        actions.append(earlier, later, remove);
        item.append(frame, actions);
        gallery.append(item);
      });
      wrapper.append(gallery);
    }

    const fileInput = el('input', 'visually-hidden');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    const dropZone = el('div', 'image-dropzone');
    dropZone.tabIndex = 0;
    dropZone.setAttribute('role', 'button');
    dropZone.setAttribute('aria-label', 'Dán, kéo thả hoặc chọn hình ảnh cho câu hỏi');
    dropZone.append(
      el('span', 'dropzone-icon', '＋'),
      el('strong', '', question.images.length ? 'Thêm hình ảnh khác' : 'Dán hoặc chọn hình ảnh'),
      el('span', '', 'Ctrl+V, kéo thả hoặc bấm để chọn nhiều ảnh')
    );
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.add('is-dragging');
    }));
    ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-dragging');
    }));
    dropZone.addEventListener('drop', (event) => addImageFiles(question, Array.from(event.dataTransfer.files || [])));
    dropZone.addEventListener('paste', (event) => {
      const files = Array.from(event.clipboardData && event.clipboardData.items || [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (files.length) {
        event.preventDefault();
        addImageFiles(question, files);
      }
    });
    fileInput.addEventListener('change', () => {
      addImageFiles(question, Array.from(fileInput.files || []));
      fileInput.value = '';
    });
    wrapper.append(fileInput, dropZone);
    return wrapper;
  }

  function moveImage(question, index, delta) {
    const destination = index + delta;
    if (destination < 0 || destination >= question.images.length) return;
    const temporary = question.images[index];
    question.images[index] = question.images[destination];
    question.images[destination] = temporary;
    renderQuestions();
    scheduleSave();
  }

  async function addImageFiles(question, files) {
    const images = files.filter((file) => file && String(file.type || '').startsWith('image/'));
    if (!images.length) {
      showToast('Chỉ có thể thêm file hình ảnh.', true);
      return;
    }
    showToast(`Đang xử lý ${images.length} ảnh…`, false, 0);
    try {
      for (const image of images) {
        if (image.size > 20 * 1024 * 1024) throw new Error(`Ảnh “${image.name || 'không tên'}” lớn hơn 20 MB.`);
        question.images.push(await compressImage(image));
      }
      renderQuestions();
      updateSummary();
      scheduleSave();
      showToast(`Đã thêm ${images.length} ảnh.`);
    } catch (error) {
      showToast(error && error.message ? error.message : 'Không thể xử lý ảnh này.', true);
    }
  }

  async function compressImage(file) {
    let source;
    let width;
    let height;
    let objectUrl = '';
    try {
      if ('createImageBitmap' in window) {
        source = await createImageBitmap(file);
        width = source.width;
        height = source.height;
      } else {
        objectUrl = URL.createObjectURL(file);
        source = await loadImage(objectUrl);
        width = source.naturalWidth;
        height = source.naturalHeight;
      }
      const limit = 1600;
      const scale = Math.min(1, limit / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Không thể nén ảnh.')), 'image/webp', 0.88);
      });
      return await blobToDataUrl(blob);
    } finally {
      if (source && typeof source.close === 'function') source.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Không thể đọc ảnh.'));
      image.src = url;
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Không thể đọc ảnh.'));
      reader.readAsDataURL(blob);
    });
  }

  function createTypeConfig(question, index) {
    const config = el('section', 'flex-question-config');
    if (question.type === 'multipleChoice') return createMultipleChoiceConfig(config, question, index);
    if (question.type === 'trueFalse') return createTrueFalseConfig(config, question, index);
    if (question.type === 'shortAnswer') return createShortAnswerConfig(config, question);
    if (question.type === 'fillBlank') return createFillBlankConfig(config, question, index);
    return createEssayConfig(config, question);
  }

  function createMultipleChoiceConfig(config, question, questionIndex) {
    const heading = el('div', 'config-heading');
    heading.append(el('h4', '', 'Lựa chọn và đáp án'), el('small', '', 'Chọn đúng một đáp án đối chiếu.'));
    config.append(heading);
    const list = el('div', 'flex-option-list');
    question.options.forEach((option, optionIndex) => {
      const row = el('div', 'form-field flex-option-row');
      const key = el('label', 'answer-chip flex-option-key');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = `correct-${question.id}`;
      radio.value = option.id;
      radio.checked = question.correctOptionId === option.id;
      radio.addEventListener('change', () => {
        question.correctOptionId = option.id;
        updateSummary();
        scheduleSave();
      });
      key.append(radio, el('span', '', option.id));
      const text = el('input');
      text.type = 'text';
      text.maxLength = 1000;
      text.value = option.text;
      text.placeholder = `Nội dung lựa chọn ${option.id} (có thể để trống nếu nằm trong ảnh)`;
      text.setAttribute('aria-label', `Nội dung lựa chọn ${option.id} câu ${questionIndex + 1}`);
      text.addEventListener('input', () => {
        option.text = text.value;
        updateSummary();
        scheduleSave();
      });
      row.append(key, text);
      if (question.options.length > 2) {
        const remove = button('Xóa', 'btn btn-small btn-danger');
        remove.addEventListener('click', () => {
          question.options.splice(optionIndex, 1);
          relabelOptions(question);
          renderQuestions();
          updateSummary();
          scheduleSave();
        });
        row.append(remove);
      }
      list.append(row);
    });
    config.append(list);
    if (question.options.length < 8) {
      const add = button('＋ Thêm lựa chọn', 'btn btn-small btn-secondary');
      add.addEventListener('click', () => {
        question.options.push({ id: String.fromCharCode(65 + question.options.length), text: '' });
        renderQuestions();
        scheduleSave();
      });
      config.append(add);
    }
    return config;
  }

  function relabelOptions(question) {
    const previousCorrect = question.correctOptionId;
    let newCorrect = '';
    question.options.forEach((option, index) => {
      if (option.id === previousCorrect) newCorrect = String.fromCharCode(65 + index);
      option.id = String.fromCharCode(65 + index);
    });
    question.correctOptionId = newCorrect;
  }

  function createTrueFalseConfig(config, question, questionIndex) {
    const heading = el('div', 'config-heading');
    heading.append(el('h4', '', 'Các ý Đúng / Sai'), el('small', '', 'Điểm câu được chia đều theo số ý đúng.'));
    config.append(heading);
    const list = el('div', 'tf-key-grid flex-tf-list');
    question.statements.forEach((statement, statementIndex) => {
      const row = el('div', 'tf-key-row flex-tf-row');
      row.append(el('strong', 'tf-letter', `${statement.id})`));
      const text = el('input');
      text.type = 'text';
      text.maxLength = 3000;
      text.value = statement.text;
      text.placeholder = 'Nội dung ý (có thể để trống nếu nằm trong ảnh)';
      text.setAttribute('aria-label', `Nội dung ý ${statement.id} câu ${questionIndex + 1}`);
      text.addEventListener('input', () => {
        statement.text = text.value;
        updateSummary();
        scheduleSave();
      });
      row.append(text);
      [{ value: true, label: 'Đúng' }, { value: false, label: 'Sai' }].forEach((choice) => {
        const label = el('label', 'answer-chip tf-chip');
        const input = el('input');
        input.type = 'radio';
        input.name = `tf-${question.id}-${statement.id}`;
        input.checked = statement.answer === choice.value;
        input.addEventListener('change', () => {
          statement.answer = choice.value;
          updateSummary();
          scheduleSave();
        });
        label.append(input, el('span', '', choice.label));
        row.append(label);
      });
      if (question.statements.length > 1) {
        const remove = button('Xóa', 'btn btn-small btn-danger');
        remove.addEventListener('click', () => {
          question.statements.splice(statementIndex, 1);
          relabelStatements(question);
          renderQuestions();
          updateSummary();
          scheduleSave();
        });
        row.append(remove);
      }
      list.append(row);
    });
    config.append(list);
    if (question.statements.length < 8) {
      const add = button('＋ Thêm ý', 'btn btn-small btn-secondary');
      add.addEventListener('click', () => {
        question.statements.push({ id: String.fromCharCode(97 + question.statements.length), text: '', answer: null });
        renderQuestions();
        scheduleSave();
      });
      config.append(add);
    }
    return config;
  }

  function relabelStatements(question) {
    question.statements.forEach((statement, index) => { statement.id = String.fromCharCode(97 + index); });
  }

  function createShortAnswerConfig(config, question) {
    config.append(el('h4', '', 'Đáp án trả lời ngắn'));
    const grid = el('div', 'form-grid two-columns');
    const acceptedField = el('div', 'form-field full-width');
    const acceptedLabel = el('label', '', 'Các đáp án được chấp nhận');
    const accepted = el('input');
    accepted.type = 'text';
    accepted.value = question.acceptedAnswers.join(' | ');
    accepted.placeholder = 'Ví dụ: 1,5 | 1.5';
    accepted.addEventListener('input', () => {
      question.acceptedAnswers = accepted.value.split('|').map((value) => value.trim());
      updateSummary();
      scheduleSave();
    });
    acceptedField.append(acceptedLabel, accepted, el('small', '', 'Dùng dấu | để nhập nhiều đáp án tương đương.'));
    const lengthField = el('div', 'form-field');
    const lengthLabel = el('label', '', 'Số ký tự tối đa');
    const length = el('input');
    length.type = 'number';
    length.min = '1';
    length.max = '1000';
    length.value = String(question.maxLength);
    length.addEventListener('input', () => {
      question.maxLength = clampInt(length.value, 1, 1000, 120);
      scheduleSave();
    });
    lengthField.append(lengthLabel, length);
    const caseField = el('label', 'form-field checkbox-field');
    const caseInput = el('input');
    caseInput.type = 'checkbox';
    caseInput.checked = question.caseSensitive;
    caseInput.addEventListener('change', () => {
      question.caseSensitive = caseInput.checked;
      scheduleSave();
    });
    caseField.append(caseInput, el('span', '', 'Phân biệt chữ hoa / chữ thường'));
    grid.append(acceptedField, lengthField, caseField);
    config.append(grid);
    return config;
  }

  function createFillBlankConfig(config, question, questionIndex) {
    const heading = el('div', 'config-heading');
    heading.append(el('h4', '', 'Các ô đục lỗ'), el('small', '', 'Điểm câu được chia đều theo số ô đúng.'));
    config.append(heading);
    const list = el('div', 'flex-blank-list');
    question.blanks.forEach((blank, blankIndex) => {
      const row = el('div', 'form-grid flex-blank-row');
      const labelField = el('div', 'form-field');
      const labelLabel = el('label', '', `Tên ô ${blankIndex + 1}`);
      const label = el('input');
      label.type = 'text';
      label.maxLength = 180;
      label.value = blank.label;
      label.addEventListener('input', () => {
        blank.label = label.value;
        scheduleSave();
      });
      labelField.append(labelLabel, label);
      const answerField = el('div', 'form-field');
      const answerLabel = el('label', '', 'Đáp án chấp nhận');
      const answer = el('input');
      answer.type = 'text';
      answer.value = blank.acceptedAnswers.join(' | ');
      answer.placeholder = 'Đáp án 1 | đáp án tương đương';
      answer.setAttribute('aria-label', `Đáp án ô ${blankIndex + 1} câu ${questionIndex + 1}`);
      answer.addEventListener('input', () => {
        blank.acceptedAnswers = answer.value.split('|').map((value) => value.trim());
        updateSummary();
        scheduleSave();
      });
      answerField.append(answerLabel, answer);
      row.append(labelField, answerField);
      if (question.blanks.length > 1) {
        const remove = button('Xóa ô', 'btn btn-small btn-danger');
        remove.addEventListener('click', () => {
          question.blanks.splice(blankIndex, 1);
          relabelBlanks(question);
          renderQuestions();
          updateSummary();
          scheduleSave();
        });
        row.append(remove);
      }
      list.append(row);
    });
    config.append(list);
    if (question.blanks.length < 10) {
      const add = button('＋ Thêm ô trống', 'btn btn-small btn-secondary');
      add.addEventListener('click', () => {
        const number = question.blanks.length + 1;
        question.blanks.push({ id: `b${number}`, label: `Ô trống ${number}`, acceptedAnswers: [''] });
        renderQuestions();
        scheduleSave();
      });
      config.append(add);
    }
    const caseField = el('label', 'form-field checkbox-field');
    const caseInput = el('input');
    caseInput.type = 'checkbox';
    caseInput.checked = Boolean(question.caseSensitive);
    caseInput.addEventListener('change', () => {
      question.caseSensitive = caseInput.checked;
      scheduleSave();
    });
    caseField.append(caseInput, el('span', '', 'Phân biệt chữ hoa / chữ thường'));
    config.append(caseField);
    return config;
  }

  function relabelBlanks(question) {
    question.blanks.forEach((blank, index) => {
      blank.id = `b${index + 1}`;
      if (!blank.label) blank.label = `Ô trống ${index + 1}`;
    });
  }

  function createEssayConfig(config, question) {
    config.append(el('h4', '', 'Thiết lập tự luận'), el('p', '', 'Câu này không được chấm tự động. Nội dung người làm nhập sẽ được lưu trong file JSON trên Drive để chấm sau.'));
    const field = el('div', 'form-field');
    const label = el('label', '', 'Số ký tự tối đa');
    const input = el('input');
    input.type = 'number';
    input.min = '100';
    input.max = '20000';
    input.step = '100';
    input.value = String(question.maxLength);
    input.addEventListener('input', () => {
      question.maxLength = clampInt(input.value, 100, 20000, 5000);
      scheduleSave();
    });
    field.append(label, input);
    config.append(field);
    return config;
  }

  function moveQuestion(index, delta) {
    const destination = index + delta;
    if (destination < 0 || destination >= state.draft.questions.length) return;
    const temporary = state.draft.questions[index];
    state.draft.questions[index] = state.draft.questions[destination];
    state.draft.questions[destination] = temporary;
    renderQuestions();
    scheduleSave();
  }

  function duplicateQuestion(index) {
    const copy = clone(state.draft.questions[index]);
    copy.id = uid('q');
    state.draft.questions.splice(index + 1, 0, ensureQuestion(copy));
    renderQuestions();
    updateSummary();
    scheduleSave();
  }

  function removeQuestion(index) {
    const question = state.draft.questions[index];
    if (!question || !window.confirm(`Xóa câu ${index + 1} (${TYPE_LABELS[question.type]})?`)) return;
    state.draft.questions.splice(index, 1);
    renderQuestions();
    updateSummary();
    scheduleSave();
  }

  function changeQuestionType(index, nextType) {
    const current = state.draft.questions[index];
    if (!current || current.type === nextType) return;
    if (!window.confirm(`Đổi từ “${TYPE_LABELS[current.type]}” sang “${TYPE_LABELS[nextType]}”? Cấu hình đáp án cũ của câu này sẽ bị xóa.`)) {
      renderQuestions();
      return;
    }
    const replacement = newQuestion(nextType);
    replacement.id = current.id;
    replacement.points = current.points;
    replacement.prompt = current.prompt;
    replacement.images = current.images.slice();
    state.draft.questions[index] = replacement;
    renderQuestions();
    updateSummary();
    scheduleSave();
  }

  function questionErrors(question, index) {
    const label = `Câu ${index + 1}`;
    const errors = [];
    if (!(Number(question.points) > 0)) errors.push(`${label}: điểm phải lớn hơn 0.`);
    const hasText = Boolean(String(question.prompt || '').trim());
    const hasImages = Array.isArray(question.images) && question.images.length > 0;
    const hasChoiceText = question.type === 'multipleChoice' && question.options.some((option) => String(option.text || '').trim());
    const hasStatementText = question.type === 'trueFalse' && question.statements.some((statement) => String(statement.text || '').trim());
    if (!hasText && !hasImages && !hasChoiceText && !hasStatementText) errors.push(`${label}: cần nội dung chữ hoặc ít nhất một ảnh.`);
    if (question.type === 'multipleChoice') {
      if (!question.options || question.options.length < 2) errors.push(`${label}: cần ít nhất 2 lựa chọn.`);
      if (!question.options.some((option) => option.id === question.correctOptionId)) errors.push(`${label}: chưa chọn đáp án trắc nghiệm.`);
    } else if (question.type === 'trueFalse') {
      if (!question.statements || !question.statements.length) errors.push(`${label}: cần ít nhất một ý Đúng / Sai.`);
      if (question.statements.some((statement) => typeof statement.answer !== 'boolean')) errors.push(`${label}: chưa đặt đủ đáp án Đúng / Sai.`);
    } else if (question.type === 'shortAnswer') {
      if (!question.acceptedAnswers.some((answer) => String(answer).trim())) errors.push(`${label}: chưa nhập đáp án trả lời ngắn.`);
    } else if (question.type === 'fillBlank') {
      if (!question.blanks || !question.blanks.length) errors.push(`${label}: cần ít nhất một ô trống.`);
      if (question.blanks.some((blank) => !blank.acceptedAnswers.some((answer) => String(answer).trim()))) errors.push(`${label}: chưa nhập đủ đáp án cho các ô trống.`);
    }
    return errors;
  }

  function validateDraft() {
    syncMetadataFromForm();
    const errors = [];
    if (!state.draft.title) errors.push('Cần nhập tiêu đề bài kiểm tra.');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.draft.id)) errors.push('Mã bài chỉ được dùng chữ thường không dấu, số và dấu gạch ngang.');
    if (!state.draft.publishAt || Number.isNaN(Date.parse(state.draft.publishAt))) errors.push('Thời điểm công khai chưa hợp lệ.');
    if (!state.draft.access.allowedEmailDomains.length) errors.push('Cần nhập ít nhất một tên miền email được nhận mã.');
    if (!state.draft.questions.length) errors.push('Cần thêm ít nhất một câu hỏi.');
    const ids = new Set();
    state.draft.questions.forEach((question, index) => {
      if (ids.has(question.id)) errors.push(`Câu ${index + 1}: mã câu bị trùng.`);
      ids.add(question.id);
      errors.push(...questionErrors(question, index));
    });

    if (typeof Core.validateExam === 'function') {
      try {
        Core.validateExam(state.draft, { requireAnswerKeys: true, requireDomains: true }).forEach((message) => {
          if (!errors.includes(String(message))) errors.push(String(message));
        });
      } catch (_) {
        // The local validation remains the source of feedback if an older core is used.
      }
    }
    return errors;
  }

  function showErrors(errors) {
    if (!errors.length) {
      dom.errorSummary.hidden = true;
      dom.errorSummary.replaceChildren();
      return;
    }
    const heading = el('h2', '', `Cần hoàn thiện ${errors.length} mục`);
    const list = el('ul');
    errors.slice(0, 20).forEach((message) => list.append(el('li', '', message)));
    if (errors.length > 20) list.append(el('li', '', `… và ${errors.length - 20} mục khác.`));
    dom.errorSummary.replaceChildren(heading, list);
    dom.errorSummary.hidden = false;
    dom.errorSummary.focus();
    dom.errorSummary.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function updateSummary() {
    const totals = getTotals(state.draft);
    const count = state.draft.questions.length;
    const complete = state.draft.questions.reduce((total, question, index) => total + (questionErrors(question, index).length ? 0 : 1), 0);
    const percent = count ? Math.round(complete / count * 100) : 0;
    dom.questionCount.textContent = `${count} câu`;
    dom.completion.textContent = `${percent}%`;
    dom.progressBar.style.width = `${percent}%`;
    dom.objectiveTotal.textContent = formatNumber(totals.objectiveMax);
    dom.essayTotal.textContent = formatNumber(totals.essayMax);
    dom.allTotal.textContent = formatNumber(totals.totalMax);
  }

  async function saveExam() {
    const errors = validateDraft();
    showErrors(errors);
    if (errors.length) return;
    const saved = ensureExam(state.draft);
    const existingIndex = state.catalog.findIndex((exam) => exam.id === saved.id);
    if (existingIndex >= 0) {
      const existing = state.catalog[existingIndex];
      if (existing !== state.draft && !window.confirm(`Thay thế bài “${existing.title}” trong kho?`)) return;
      saved.version = Math.max(Number(existing.version) || 1, Number(saved.version) || 1) + 1;
      state.catalog[existingIndex] = saved;
    } else {
      saved.version = Math.max(1, Number(saved.version) || 1);
      state.catalog.push(saved);
    }
    state.deletedIds.delete(saved.id);
    state.draft = clone(saved);
    populateMetadata();
    renderQuestions();
    renderCatalog();
    updateSummary();
    await saveWorkspaceNow();
    showToast('Đã lưu bài kiểm tra vào kho trên thiết bị.');
  }

  function previewExam() {
    const errors = validateDraft();
    showErrors(errors);
    if (errors.length) return;
    try {
      const previewData = JSON.stringify(ensureExam(state.draft));
      sessionStorage.setItem(PREVIEW_KEY, previewData);
      const url = `test.html?preview=1&id=${encodeURIComponent(state.draft.id || 'preview')}`;
      const previewWindow = window.open('about:blank', '_blank');
      if (!previewWindow) throw new Error('Trình duyệt đang chặn cửa sổ xem thử.');
      previewWindow.sessionStorage.setItem(PREVIEW_KEY, previewData);
      previewWindow.opener = null;
      previewWindow.location.replace(url);
    } catch (_) {
      showToast('Không thể mở tab xem thử. Hãy cho phép cửa sổ bật lên hoặc giảm số ảnh trong bài.', true);
    }
  }

  function resetDraft() {
    const hasContent = state.draft.title || state.draft.questions.length;
    if (hasContent && !window.confirm('Tạo bài mới? Bản nháp hiện tại sẽ được thay thế; các bài đã lưu trong kho vẫn được giữ.')) return;
    state.draft = newExam();
    populateMetadata();
    renderQuestions();
    updateSummary();
    showErrors([]);
    scheduleSave();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderCatalog() {
    dom.catalogList.replaceChildren();
    if (!state.catalog.length) {
      const empty = el('div', 'empty-state compact-empty');
      empty.append(el('span', 'empty-state-icon', '🗂️'), el('h3', '', 'Kho bài đang trống'), el('p', '', 'Hoàn thiện bài đang soạn rồi nhấn “Lưu vào kho”.'));
      dom.catalogList.append(empty);
      return;
    }
    state.catalog.slice().sort((a, b) => String(b.publishAt).localeCompare(String(a.publishAt))).forEach((exam) => {
      const item = el('article', 'catalog-item');
      const copyNode = el('div', 'catalog-item-copy');
      const totals = getTotals(exam);
      copyNode.append(el('h3', '', exam.title || exam.id), el('p', 'catalog-meta', `${exam.questions.length} câu · ${formatNumber(totals.objectiveMax)} điểm tự chấm · ${formatNumber(totals.essayMax)} điểm tự luận · v${exam.version}`));
      if (exam.description) copyNode.append(el('p', 'catalog-description', exam.description));
      const actions = el('div', 'catalog-item-actions');
      const edit = button('Chỉnh sửa', 'btn btn-small btn-secondary');
      edit.addEventListener('click', () => editCatalogExam(exam.id));
      const remove = button('Xóa', 'btn btn-small btn-danger');
      remove.addEventListener('click', () => deleteCatalogExam(exam.id));
      actions.append(edit, remove);
      item.append(copyNode, actions);
      dom.catalogList.append(item);
    });
  }

  function editCatalogExam(examId) {
    const exam = state.catalog.find((item) => item.id === examId);
    if (!exam) return;
    if ((state.draft.title || state.draft.questions.length) && !window.confirm(`Mở “${exam.title}” để chỉnh sửa? Bản nháp hiện tại sẽ được thay thế.`)) return;
    state.draft = ensureExam(exam);
    populateMetadata();
    renderQuestions();
    updateSummary();
    showErrors([]);
    scheduleSave();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function deleteCatalogExam(examId) {
    const index = state.catalog.findIndex((item) => item.id === examId);
    if (index < 0) return;
    const exam = state.catalog[index];
    if (!window.confirm(`Xóa “${exam.title}” khỏi các file sẽ xuất?`)) return;
    state.catalog.splice(index, 1);
    state.deletedIds.add(examId);
    renderCatalog();
    scheduleSave();
  }

  function catalogErrors() {
    const errors = [];
    if (!state.catalog.length) return ['Kho bài kiểm tra đang trống.'];
    state.catalog.forEach((exam) => {
      let messages = [];
      try {
        if (typeof Core.validateExam === 'function') messages = Core.validateExam(exam, { requireAnswerKeys: true, requireDomains: true });
        else messages = validateStandalone(exam);
      } catch (_) {
        messages = validateStandalone(exam);
      }
      messages.forEach((message) => errors.push(`“${exam.title || exam.id}”: ${message}`));
    });
    return errors;
  }

  function validateStandalone(exam) {
    const previous = state.draft;
    state.draft = ensureExam(exam);
    const errors = [];
    if (!state.draft.title || !state.draft.id) errors.push('thiếu tiêu đề hoặc mã bài.');
    state.draft.questions.forEach((question, index) => errors.push(...questionErrors(question, index)));
    state.draft = previous;
    return errors;
  }

  function publicCatalog() {
    if (typeof Core.publicCatalog === 'function') return Core.publicCatalog(state.catalog);
    return state.catalog.map(stripAnswerKeys);
  }

  function stripAnswerKeys(exam) {
    const output = ensureExam(exam);
    output.questions = output.questions.map((question) => {
      const publicQuestion = clone(question);
      if (question.type === 'multipleChoice') delete publicQuestion.correctOptionId;
      if (question.type === 'trueFalse') publicQuestion.statements = question.statements.map((statement) => ({ id: statement.id, text: statement.text }));
      if (question.type === 'shortAnswer') {
        delete publicQuestion.acceptedAnswers;
        delete publicQuestion.caseSensitive;
      }
      if (question.type === 'fillBlank') {
        publicQuestion.blanks = question.blanks.map((blank) => ({ id: blank.id, label: blank.label }));
        delete publicQuestion.caseSensitive;
      }
      return publicQuestion;
    });
    return output;
  }

  function keyCatalog() {
    if (typeof Core.privateKeyCatalog === 'function') return Core.privateKeyCatalog(state.catalog);
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      exams: state.catalog.map((exam) => typeof Core.privateExamKey === 'function' ? Core.privateExamKey(exam) : fallbackPrivateKey(exam))
    };
  }

  function fallbackPrivateKey(exam) {
    const totals = getTotals(exam);
    return {
      schemaVersion: 1,
      id: exam.id,
      title: exam.title,
      version: exam.version,
      allowedEmailDomains: exam.access.allowedEmailDomains.slice(),
      objectiveMax: totals.objectiveMax,
      essayMax: totals.essayMax,
      questions: exam.questions.map((question) => {
        const key = { id: question.id, type: question.type, points: question.points };
        if (question.type === 'multipleChoice') key.correctOptionId = question.correctOptionId;
        else if (question.type === 'trueFalse') {
          key.scoringMode = 'proportional';
          key.statements = question.statements.map((statement) => ({ id: statement.id, answer: statement.answer }));
        } else if (question.type === 'shortAnswer') {
          key.acceptedAnswers = question.acceptedAnswers.filter((answer) => String(answer).trim());
          key.caseSensitive = question.caseSensitive;
        } else if (question.type === 'fillBlank') {
          key.scoringMode = 'proportional';
          key.caseSensitive = question.caseSensitive;
          key.blanks = question.blanks.map((blank) => ({ id: blank.id, acceptedAnswers: blank.acceptedAnswers.filter((answer) => String(answer).trim()) }));
        } else key.maxLength = question.maxLength;
        return key;
      })
    };
  }

  function exportPublicCatalog() {
    const errors = catalogErrors();
    if (errors.length) {
      showCatalogExportErrors(errors);
      return;
    }
    const source = `window.FLEXIBLE_EXAMS = ${JSON.stringify(publicCatalog(), null, 2)};\n`;
    downloadText('flexible-exams.js', source, 'text/javascript;charset=utf-8');
    showToast('Đã tải flexible-exams.js. File này không chứa đáp án.');
  }

  function exportAnswerKeys() {
    const errors = catalogErrors();
    if (errors.length) {
      showCatalogExportErrors(errors);
      return;
    }
    downloadText('flexible-answer-keys.json', JSON.stringify(keyCatalog(), null, 2) + '\n', 'application/json;charset=utf-8');
    showToast('Đã tải file đáp án riêng. Không upload file này lên GitHub.', false, 6500);
  }

  function exportBackup() {
    const backup = {
      schemaVersion: 1,
      kind: 'hana-flexible-builder-backup',
      generatedAt: new Date().toISOString(),
      exams: state.catalog.map((exam) => ensureExam(exam)),
      draft: ensureExam(state.draft),
      deletedIds: Array.from(state.deletedIds)
    };
    downloadText('flexible-builder-backup.json', JSON.stringify(backup, null, 2) + '\n', 'application/json;charset=utf-8');
    showToast('Đã tải bản sao đầy đủ để chỉnh sửa sau này.');
  }

  function showCatalogExportErrors(errors) {
    const messages = errors.slice(0, 20);
    showErrors(messages);
    showToast('Chưa thể xuất: có bài trong kho thiếu nội dung hoặc đáp án.', true, 6000);
  }

  function downloadText(fileName, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function importBackup() {
    const file = dom.importFile.files && dom.importFile.files[0];
    dom.importFile.value = '';
    if (!file) return;
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error('File bản sao lớn hơn 80 MB.');
      const parsed = JSON.parse(await file.text());
      if (!parsed || parsed.kind !== 'hana-flexible-builder-backup' || !Array.isArray(parsed.exams)) {
        throw new Error('Đây không phải file flexible-builder-backup.json hợp lệ.');
      }
      const exams = parsed.exams.map(ensureExam);
      const invalid = [];
      exams.forEach((exam) => {
        const messages = typeof Core.validateExam === 'function'
          ? Core.validateExam(exam, { requireAnswerKeys: true, requireDomains: true })
          : validateStandalone(exam);
        messages.forEach((message) => invalid.push(`“${exam.title || exam.id}”: ${message}`));
      });
      if (invalid.length) throw new Error(`Bản sao có ${invalid.length} lỗi. Lỗi đầu tiên: ${invalid[0]}`);
      if (!window.confirm(`Nhập ${exams.length} bài? Kho và bản nháp hiện tại trên thiết bị sẽ được thay thế.`)) return;
      state.catalog = exams;
      state.draft = parsed.draft ? ensureExam(parsed.draft) : newExam();
      state.deletedIds = new Set(Array.isArray(parsed.deletedIds) ? parsed.deletedIds.map(String) : []);
      populateMetadata();
      renderQuestions();
      renderCatalog();
      updateSummary();
      showErrors([]);
      await saveWorkspaceNow();
      showToast(`Đã nhập ${exams.length} bài kiểm tra.`);
    } catch (error) {
      showToast(error && error.message ? error.message : 'Không thể đọc file bản sao.', true, 7000);
    }
  }

  function scheduleSave() {
    window.clearTimeout(state.saveTimer);
    dom.autosave.textContent = 'Đang chờ tự lưu…';
    state.saveTimer = window.setTimeout(saveWorkspaceNow, 600);
  }

  async function saveWorkspaceNow() {
    window.clearTimeout(state.saveTimer);
    const workspace = {
      schemaVersion: 1,
      draft: ensureExam(state.draft),
      catalog: state.catalog.map(ensureExam),
      deletedIds: Array.from(state.deletedIds),
      savedAt: new Date().toISOString()
    };
    try {
      await writeWorkspace(workspace);
      dom.autosave.textContent = `Đã tự lưu lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.`;
    } catch (_) {
      dom.autosave.textContent = 'Không thể tự lưu; hãy tải bản sao để tránh mất dữ liệu.';
    }
  }

  async function openDatabase() {
    if (state.db) return state.db;
    if (!('indexedDB' in window)) throw new Error('IndexedDB unavailable');
    state.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DB_STORE)) database.createObjectStore(DB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Không thể mở bộ nhớ.'));
    });
    return state.db;
  }

  async function readWorkspace() {
    try {
      const database = await openDatabase();
      const value = await new Promise((resolve, reject) => {
        const request = database.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      if (value) return value;
    } catch (_) {
      // Fall through to localStorage for browsers where IndexedDB is blocked.
    }
    try {
      return JSON.parse(localStorage.getItem(FALLBACK_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  async function writeWorkspace(workspace) {
    try {
      const database = await openDatabase();
      await new Promise((resolve, reject) => {
        const request = database.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(workspace, DB_KEY);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      return;
    } catch (_) {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(workspace));
    }
  }

  function showToast(message, isError, delay) {
    window.clearTimeout(state.toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.toggle('is-error', Boolean(isError));
    dom.toast.hidden = false;
    const timeout = delay === undefined ? 3500 : delay;
    if (timeout) state.toastTimer = window.setTimeout(() => { dom.toast.hidden = true; }, timeout);
  }

  window.addEventListener('beforeunload', () => {
    if (state.saveTimer) saveWorkspaceNow();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();



