(function () {
  'use strict';

  const COUNTS = Object.freeze({ multipleChoice: 12, trueFalse: 4, shortAnswer: 6 });
  const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
  const MAX_IMAGE_EDGE = 1800;
  const DB_NAME = 'hana-exam-builder-v1';
  const DB_STORE = 'state';
  const DB_VERSION = 1;

  const state = {
    draft: null,
    catalog: [],
    deletedIds: new Set(),
    idWasEdited: false,
    storageAvailable: true,
    initialized: false,
    autosaveTimer: null,
    toastTimer: null
  };

  const dom = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheDom();
    bindStaticControls();

    const siteCatalog = Array.isArray(window.MATH_EXAMS)
      ? window.MATH_EXAMS.map(normalizeCatalogExam).filter(Boolean)
      : [];

    let savedCatalog = [];
    let savedDraft = null;
    try {
      const storedCatalog = await dbGet('catalog');
      const storedDraft = await dbGet('draft');
      const storedDeletedIds = await dbGet('deletedIds');
      if (Array.isArray(storedCatalog)) {
        savedCatalog = storedCatalog.map(normalizeCatalogExam).filter(Boolean);
      }
      if (storedDraft && typeof storedDraft === 'object') savedDraft = normalizeDraft(storedDraft);
      if (Array.isArray(storedDeletedIds)) state.deletedIds = new Set(storedDeletedIds.map(String));
    } catch (error) {
      disablePersistence();
    }

    state.catalog = mergeCatalogs(siteCatalog, savedCatalog)
      .filter((exam) => !state.deletedIds.has(exam.id));
    state.draft = savedDraft || createEmptyDraft();
    state.idWasEdited = Boolean(state.draft.id);

    fillMetadataForm();
    renderQuestionBuilders();
    renderCatalog();
    updateProgress();
    state.initialized = true;
  }

  function cacheDom() {
    dom.form = document.getElementById('exam-builder-form');
    dom.title = document.getElementById('exam-title');
    dom.id = document.getElementById('exam-id');
    dom.description = document.getElementById('exam-description');
    dom.publishLocal = document.getElementById('publish-local');
    dom.timeZone = document.getElementById('exam-timezone');
    dom.standardDuration = document.getElementById('standard-duration');
    dom.mcqBuilder = document.getElementById('mcq-builder');
    dom.tfBuilder = document.getElementById('tf-builder');
    dom.shortBuilder = document.getElementById('short-builder');
    dom.progressText = document.getElementById('builder-progress-text');
    dom.progressPercent = document.getElementById('builder-progress-percent');
    dom.progressBar = document.getElementById('builder-progress-bar');
    dom.progressMcq = document.getElementById('progress-mcq');
    dom.progressTf = document.getElementById('progress-tf');
    dom.progressShort = document.getElementById('progress-short');
    dom.autosaveStatus = document.getElementById('autosave-status');
    dom.saveButton = document.getElementById('save-exam-btn');
    dom.exportButton = document.getElementById('export-catalog-btn');
    dom.exportButtonBottom = document.getElementById('export-catalog-btn-bottom');
    dom.resetButton = document.getElementById('reset-draft-btn');
    dom.importButton = document.getElementById('import-catalog-btn');
    dom.importFile = document.getElementById('import-catalog-file');
    dom.catalogList = document.getElementById('catalog-list');
    dom.toast = document.getElementById('builder-toast');
  }

  function bindStaticControls() {
    const metadataBindings = [
      [dom.title, 'title'],
      [dom.id, 'id'],
      [dom.description, 'description'],
      [dom.publishLocal, 'publishLocal'],
      [dom.timeZone, 'timeZone'],
      [dom.standardDuration, 'standardDuration']
    ];

    metadataBindings.forEach(([control, key]) => {
      if (!control) return;
      const eventName = control.tagName === 'SELECT' ? 'change' : 'input';
      control.addEventListener(eventName, () => {
        if (!state.draft) return;
        state.draft[key] = key === 'standardDuration'
          ? Number(control.value || 90)
          : control.value;

        if (key === 'title' && !state.idWasEdited) {
          state.draft.id = slugify(control.value);
          dom.id.value = state.draft.id;
        }
        if (key === 'id') {
          state.idWasEdited = true;
          const cleaned = slugify(control.value);
          if (cleaned !== control.value) {
            control.value = cleaned;
            state.draft.id = cleaned;
          }
        }
        removeErrorSummary();
        queueDraftSave();
      });
    });

    dom.saveButton.addEventListener('click', () => saveCurrentExam());
    dom.exportButton.addEventListener('click', exportCatalog);
    dom.exportButtonBottom.addEventListener('click', exportCatalog);
    dom.resetButton.addEventListener('click', resetDraft);
    dom.importButton.addEventListener('click', () => dom.importFile.click());
    dom.importFile.addEventListener('change', importCatalogFile);
  }

  function createEmptyDraft() {
    return {
      id: '',
      title: '',
      description: '',
      publishLocal: defaultPublishLocal('Asia/Ho_Chi_Minh'),
      timeZone: 'Asia/Ho_Chi_Minh',
      standardDuration: 90,
      version: 0,
      demo: false,
      sections: {
        multipleChoice: Array.from({ length: COUNTS.multipleChoice }, () => ({ image: '', answer: '' })),
        trueFalse: Array.from({ length: COUNTS.trueFalse }, () => ({ image: '', answers: [null, null, null, null] })),
        shortAnswer: Array.from({ length: COUNTS.shortAnswer }, () => ({ image: '', answer: '' }))
      }
    };
  }

  function normalizeDraft(input) {
    const source = input && typeof input === 'object' ? input : {};
    const empty = createEmptyDraft();
    const timeZone = isSupportedTimeZone(source.timeZone) ? source.timeZone : empty.timeZone;
    return {
      id: slugify(source.id || ''),
      title: cleanText(source.title, 140),
      description: cleanText(source.description, 360),
      publishLocal: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(source.publishLocal || ''))
        ? String(source.publishLocal)
        : empty.publishLocal,
      timeZone,
      standardDuration: clampInteger(source.standardDuration, 5, 240, 90),
      version: clampInteger(source.version, 0, 999999, 0),
      demo: Boolean(source.demo),
      sections: normalizeSections(source.sections)
    };
  }

  function normalizeCatalogExam(input) {
    if (!input || typeof input !== 'object') return null;
    const id = slugify(input.id || '');
    const title = cleanText(input.title, 140);
    if (!id || !title) return null;
    const timeZone = isSupportedTimeZone(input.timeZone) ? input.timeZone : 'Asia/Ho_Chi_Minh';
    const publishAtDate = new Date(input.publishAt);
    if (Number.isNaN(publishAtDate.getTime())) return null;
    return {
      id,
      title,
      description: cleanText(input.description, 360),
      publishAt: publishAtDate.toISOString(),
      timeZone,
      standardDuration: clampInteger(input.standardDuration, 5, 240, 90),
      version: clampInteger(input.version, 1, 999999, 1),
      demo: Boolean(input.demo),
      sections: normalizeSections(input.sections)
    };
  }

  function normalizeSections(sections) {
    const source = sections && typeof sections === 'object' ? sections : {};
    const mcqSource = Array.isArray(source.multipleChoice) ? source.multipleChoice : [];
    const tfSource = Array.isArray(source.trueFalse) ? source.trueFalse : [];
    const shortSource = Array.isArray(source.shortAnswer) ? source.shortAnswer : [];
    return {
      multipleChoice: Array.from({ length: COUNTS.multipleChoice }, (_, index) => {
        const item = mcqSource[index] || {};
        const answer = String(item.answer || '').toUpperCase();
        return {
          image: safeImageString(item.image),
          answer: ['A', 'B', 'C', 'D'].includes(answer) ? answer : ''
        };
      }),
      trueFalse: Array.from({ length: COUNTS.trueFalse }, (_, index) => {
        const item = tfSource[index] || {};
        const answers = Array.isArray(item.answers) ? item.answers : [];
        return {
          image: safeImageString(item.image),
          answers: Array.from({ length: 4 }, (__, answerIndex) => {
            return answers[answerIndex] === true ? true : answers[answerIndex] === false ? false : null;
          })
        };
      }),
      shortAnswer: Array.from({ length: COUNTS.shortAnswer }, (_, index) => {
        const item = shortSource[index] || {};
        return {
          image: safeImageString(item.image),
          answer: cleanText(item.answer, 80)
        };
      })
    };
  }

  function fillMetadataForm() {
    dom.title.value = state.draft.title;
    dom.id.value = state.draft.id;
    dom.description.value = state.draft.description;
    dom.publishLocal.value = state.draft.publishLocal;
    dom.timeZone.value = state.draft.timeZone;
    dom.standardDuration.value = String(state.draft.standardDuration);
  }

  function renderQuestionBuilders() {
    dom.mcqBuilder.replaceChildren();
    dom.tfBuilder.replaceChildren();
    dom.shortBuilder.replaceChildren();

    state.draft.sections.multipleChoice.forEach((question, index) => {
      dom.mcqBuilder.appendChild(createMcqCard(question, index));
    });
    state.draft.sections.trueFalse.forEach((question, index) => {
      dom.tfBuilder.appendChild(createTrueFalseCard(question, index));
    });
    state.draft.sections.shortAnswer.forEach((question, index) => {
      dom.shortBuilder.appendChild(createShortCard(question, index));
    });
  }

  function createQuestionCard(section, index, title) {
    const card = createElement('article', 'builder-question-card');
    card.dataset.section = section;
    card.dataset.index = String(index);
    const heading = createElement('div', 'question-card-heading');
    const titleElement = createElement('h3', '', title);
    const status = createElement('span', 'question-complete-label', 'Chưa đủ dữ liệu');
    status.dataset.questionStatus = '';
    heading.append(titleElement, status);
    card.appendChild(heading);
    return card;
  }

  function createMcqCard(question, index) {
    const card = createQuestionCard('multipleChoice', index, `Câu ${index + 1}`);
    card.appendChild(createImageEditor('multipleChoice', index, `ảnh câu trắc nghiệm ${index + 1}`, question.image));

    const fieldset = document.createElement('fieldset');
    fieldset.className = 'answer-key-fieldset';
    const legend = document.createElement('legend');
    legend.textContent = 'Đáp án đối chiếu';
    fieldset.appendChild(legend);
    const options = createElement('div', 'answer-chip-row');
    ['A', 'B', 'C', 'D'].forEach((answer) => {
      const label = createElement('label', 'answer-chip');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `builder-mcq-${index}`;
      input.value = answer;
      input.checked = question.answer === answer;
      input.addEventListener('change', () => {
        state.draft.sections.multipleChoice[index].answer = answer;
        updateProgress();
        queueDraftSave();
      });
      const text = createElement('span', '', answer);
      label.append(input, text);
      options.appendChild(label);
    });
    fieldset.appendChild(options);
    card.appendChild(fieldset);
    return card;
  }

  function createTrueFalseCard(question, index) {
    const card = createQuestionCard('trueFalse', index, `Câu ${index + 1}`);
    card.appendChild(createImageEditor('trueFalse', index, `ảnh câu đúng sai ${index + 1}`, question.image));

    const fieldset = document.createElement('fieldset');
    fieldset.className = 'answer-key-fieldset';
    const legend = document.createElement('legend');
    legend.textContent = 'Đáp án đối chiếu cho từng ý';
    fieldset.appendChild(legend);
    const table = createElement('div', 'tf-key-grid');
    ['a', 'b', 'c', 'd'].forEach((letter, answerIndex) => {
      const row = createElement('div', 'tf-key-row');
      row.appendChild(createElement('strong', 'tf-letter', `${letter})`));
      [{ label: 'Đúng', value: true }, { label: 'Sai', value: false }].forEach((choice) => {
        const label = createElement('label', 'answer-chip tf-chip');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `builder-tf-${index}-${answerIndex}`;
        input.value = String(choice.value);
        input.checked = question.answers[answerIndex] === choice.value;
        input.addEventListener('change', () => {
          state.draft.sections.trueFalse[index].answers[answerIndex] = choice.value;
          updateProgress();
          queueDraftSave();
        });
        label.append(input, createElement('span', '', choice.label));
        row.appendChild(label);
      });
      table.appendChild(row);
    });
    fieldset.appendChild(table);
    card.appendChild(fieldset);
    return card;
  }

  function createShortCard(question, index) {
    const card = createQuestionCard('shortAnswer', index, `Câu ${index + 1}`);
    card.appendChild(createImageEditor('shortAnswer', index, `ảnh câu trả lời ngắn ${index + 1}`, question.image));

    const group = createElement('div', 'form-field short-key-field');
    const label = document.createElement('label');
    label.htmlFor = `short-key-${index}`;
    label.textContent = 'Đáp án đối chiếu';
    const input = document.createElement('input');
    input.id = `short-key-${index}`;
    input.type = 'text';
    input.value = question.answer;
    input.autocomplete = 'off';
    input.placeholder = 'Ví dụ: 1,5 hoặc 1,5|1.5';
    input.setAttribute('aria-describedby', `short-help-${index}`);
    const help = createElement('small', '', 'Mỗi đáp án tối đa 4 ký tự. Dùng dấu | để nhập nhiều đáp án tương đương.');
    help.id = `short-help-${index}`;
    input.addEventListener('input', () => {
      state.draft.sections.shortAnswer[index].answer = input.value;
      const validity = validateShortKey(input.value);
      input.classList.toggle('input-invalid', !validity.valid && input.value.trim().length > 0);
      input.setCustomValidity(validity.valid ? '' : validity.message);
      updateProgress();
      queueDraftSave();
    });
    group.append(label, input, help);
    card.appendChild(group);
    return card;
  }

  function createImageEditor(section, index, labelText, imageValue) {
    const wrapper = createElement('div', 'image-editor');
    const inputId = `image-${section}-${index}`;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = inputId;
    fileInput.className = 'visually-hidden';
    fileInput.accept = 'image/png,image/jpeg,image/webp';

    const dropZone = createElement('div', 'image-dropzone');
    dropZone.tabIndex = 0;
    dropZone.setAttribute('role', 'button');
    dropZone.setAttribute('aria-label', `Dán, kéo thả hoặc chọn ${labelText}`);
    if (imageValue) {
      dropZone.classList.add('has-image');
      const image = document.createElement('img');
      image.src = imageValue;
      image.alt = `Xem trước ${labelText}`;
      const overlay = createElement('span', 'image-change-overlay', 'Bấm để thay ảnh');
      dropZone.append(image, overlay);
    } else {
      dropZone.append(
        createElement('span', 'dropzone-icon', '＋'),
        createElement('strong', '', 'Dán ảnh vào đây'),
        createElement('span', '', 'Ctrl+V, kéo thả hoặc bấm để chọn PNG/JPEG/WebP')
      );
    }

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    dropZone.addEventListener('paste', (event) => handlePaste(event, section, index));
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('is-dragging');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-dragging');
      const file = Array.from(event.dataTransfer.files || []).find((item) => item.type.startsWith('image/'));
      if (!file) {
        showToast('Tệp được thả không phải là ảnh hợp lệ.', 'error');
        return;
      }
      processQuestionImage(file, section, index);
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) processQuestionImage(file, section, index);
      fileInput.value = '';
    });

    wrapper.append(dropZone, fileInput);
    if (imageValue) {
      const controls = createElement('div', 'image-editor-actions');
      const replaceButton = createButton('Thay ảnh', 'btn btn-small btn-secondary');
      replaceButton.addEventListener('click', () => fileInput.click());
      const removeButton = createButton('Xóa ảnh', 'btn btn-small btn-danger');
      removeButton.addEventListener('click', () => {
        if (!window.confirm('Xóa ảnh của câu này?')) return;
        getQuestion(section, index).image = '';
        renderQuestionBuilders();
        updateProgress();
        queueDraftSave();
      });
      controls.append(replaceButton, removeButton);
      wrapper.appendChild(controls);
    }
    return wrapper;
  }

  function handlePaste(event, section, index) {
    const items = Array.from((event.clipboardData && event.clipboardData.items) || []);
    const imageItem = items.find((item) => item.type && item.type.startsWith('image/'));
    if (!imageItem) {
      showToast('Clipboard chưa có ảnh. Hãy sao chép ảnh rồi thử lại.', 'error');
      return;
    }
    event.preventDefault();
    const file = imageItem.getAsFile();
    if (file) processQuestionImage(file, section, index);
  }

  async function processQuestionImage(file, section, index) {
    if (!ALLOWED_IMAGE_TYPES.has(String(file.type).toLowerCase())) {
      showToast('Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP. SVG không được hỗ trợ.', 'error');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      showToast('Ảnh lớn hơn 12 MB. Hãy cắt hoặc nén ảnh trước khi tải lên.', 'error');
      return;
    }

    const card = document.querySelector(`[data-section="${section}"][data-index="${index}"]`);
    if (card) card.classList.add('is-processing');
    showToast('Đang nén ảnh…', 'info', 0);
    try {
      const dataUrl = await compressImage(file);
      getQuestion(section, index).image = dataUrl;
      renderQuestionBuilders();
      updateProgress();
      await saveDraftNow();
      const sizeKb = Math.round((dataUrl.length * 0.75) / 1024);
      showToast(`Đã thêm và nén ảnh (khoảng ${sizeKb} KB).`, 'success');
    } catch (error) {
      showToast('Không thể đọc ảnh này. Hãy thử một ảnh PNG/JPEG/WebP khác.', 'error');
    } finally {
      if (card) card.classList.remove('is-processing');
    }
  }

  async function compressImage(file) {
    let source;
    let width;
    let height;
    let cleanup = function () {};

    if ('createImageBitmap' in window) {
      source = await createImageBitmap(file);
      width = source.width;
      height = source.height;
      cleanup = () => source.close && source.close();
    } else {
      const objectUrl = URL.createObjectURL(file);
      source = await loadImage(objectUrl);
      width = source.naturalWidth;
      height = source.naturalHeight;
      cleanup = () => URL.revokeObjectURL(objectUrl);
    }

    if (!width || !height) {
      cleanup();
      throw new Error('Invalid image dimensions');
    }
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d', { alpha: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, targetWidth, targetHeight);
    cleanup();

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Canvas export failed')), 'image/webp', 0.9);
    });
    return blobToDataUrl(blob);
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function getQuestion(section, index) {
    return state.draft.sections[section][index];
  }

  function updateProgress() {
    if (!state.draft) return;
    const mcqDone = state.draft.sections.multipleChoice.filter(isMcqComplete).length;
    const tfDone = state.draft.sections.trueFalse.filter(isTrueFalseComplete).length;
    const shortDone = state.draft.sections.shortAnswer.filter(isShortComplete).length;
    const totalDone = mcqDone + tfDone + shortDone;
    const percent = Math.round((totalDone / 22) * 100);
    dom.progressText.textContent = `${totalDone}/22 câu hoàn tất`;
    dom.progressPercent.textContent = `${percent}%`;
    dom.progressBar.style.width = `${percent}%`;
    dom.progressMcq.textContent = `${mcqDone}/12`;
    dom.progressTf.textContent = `${tfDone}/4`;
    dom.progressShort.textContent = `${shortDone}/6`;

    document.querySelectorAll('.builder-question-card').forEach((card) => {
      const question = getQuestion(card.dataset.section, Number(card.dataset.index));
      const isComplete = card.dataset.section === 'multipleChoice'
        ? isMcqComplete(question)
        : card.dataset.section === 'trueFalse'
          ? isTrueFalseComplete(question)
          : isShortComplete(question);
      card.classList.toggle('is-complete', isComplete);
      const label = card.querySelector('[data-question-status]');
      if (label) label.textContent = isComplete ? 'Đã hoàn tất' : 'Chưa đủ dữ liệu';
    });
  }

  function isMcqComplete(question) {
    return Boolean(question && question.image && ['A', 'B', 'C', 'D'].includes(question.answer));
  }

  function isTrueFalseComplete(question) {
    return Boolean(question && question.image && question.answers.every((value) => typeof value === 'boolean'));
  }

  function isShortComplete(question) {
    return Boolean(question && question.image && validateShortKey(question.answer).valid);
  }

  function validateShortKey(value) {
    const variants = String(value || '').split('|').map((item) => item.trim());
    if (!String(value || '').trim()) return { valid: false, message: 'Chưa nhập đáp án.' };
    if (variants.some((item) => !item)) return { valid: false, message: 'Không để trống đáp án giữa hai dấu |.' };
    if (variants.some((item) => Array.from(item).length > 4)) {
      return { valid: false, message: 'Mỗi đáp án chỉ được tối đa 4 ký tự.' };
    }
    return { valid: true, message: '' };
  }

  function validateDraft() {
    const errors = [];
    const id = slugify(state.draft.id);
    if (!state.draft.title.trim()) errors.push('Chưa nhập tiêu đề đề thi.');
    if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) errors.push('Mã đề không hợp lệ. Chỉ dùng chữ thường, số và dấu gạch ngang.');
    if (!state.draft.publishLocal) errors.push('Chưa chọn thời điểm công khai.');
    if (!isSupportedTimeZone(state.draft.timeZone)) errors.push('Múi giờ không hợp lệ.');
    if (!Number.isInteger(Number(state.draft.standardDuration)) || Number(state.draft.standardDuration) < 5 || Number(state.draft.standardDuration) > 240) {
      errors.push('Thời lượng gợi ý phải từ 5 đến 240 phút.');
    }

    let publishAt = '';
    if (state.draft.publishLocal && isSupportedTimeZone(state.draft.timeZone)) {
      try {
        publishAt = zonedLocalToIso(state.draft.publishLocal, state.draft.timeZone);
      } catch (error) {
        errors.push('Thời điểm công khai không tồn tại hoặc không hợp lệ trong múi giờ đã chọn.');
      }
    }

    state.draft.sections.multipleChoice.forEach((question, index) => {
      if (!question.image) errors.push(`Phần I – Câu ${index + 1}: chưa có ảnh.`);
      if (!['A', 'B', 'C', 'D'].includes(question.answer)) errors.push(`Phần I – Câu ${index + 1}: chưa chọn đáp án.`);
    });
    state.draft.sections.trueFalse.forEach((question, index) => {
      if (!question.image) errors.push(`Phần II – Câu ${index + 1}: chưa có ảnh.`);
      if (!question.answers.every((value) => typeof value === 'boolean')) errors.push(`Phần II – Câu ${index + 1}: chưa chọn đủ Đúng/Sai cho a, b, c, d.`);
    });
    state.draft.sections.shortAnswer.forEach((question, index) => {
      if (!question.image) errors.push(`Phần III – Câu ${index + 1}: chưa có ảnh.`);
      const result = validateShortKey(question.answer);
      if (!result.valid) errors.push(`Phần III – Câu ${index + 1}: ${result.message}`);
    });

    return { valid: errors.length === 0, errors, publishAt };
  }

  async function saveCurrentExam(options) {
    const config = Object.assign({ quiet: false }, options || {});
    syncMetadataFromForm();
    const validation = validateDraft();
    if (!validation.valid) {
      showErrorSummary(validation.errors);
      showToast(`Còn ${validation.errors.length} mục cần hoàn thiện trước khi lưu.`, 'error');
      return null;
    }
    removeErrorSummary();

    const existingIndex = state.catalog.findIndex((item) => item.id === state.draft.id);
    const previousVersion = existingIndex >= 0 ? state.catalog[existingIndex].version : state.draft.version;
    const exam = {
      id: state.draft.id,
      title: state.draft.title.trim(),
      description: state.draft.description.trim(),
      publishAt: validation.publishAt,
      timeZone: state.draft.timeZone,
      standardDuration: clampInteger(state.draft.standardDuration, 5, 240, 90),
      version: Math.max(1, Number(previousVersion || 0) + 1),
      demo: Boolean(state.draft.demo),
      sections: clone(state.draft.sections)
    };

    if (existingIndex >= 0) state.catalog.splice(existingIndex, 1, exam);
    else state.catalog.push(exam);
    state.deletedIds.delete(exam.id);
    state.draft.version = exam.version;
    await persistCatalog();
    await saveDraftNow();
    renderCatalog();
    if (!config.quiet) showToast(existingIndex >= 0 ? 'Đã cập nhật đề trong kho.' : 'Đã thêm đề vào kho.', 'success');
    return exam;
  }

  function syncMetadataFromForm() {
    state.draft.title = dom.title.value;
    state.draft.id = slugify(dom.id.value);
    state.draft.description = dom.description.value;
    state.draft.publishLocal = dom.publishLocal.value;
    state.draft.timeZone = dom.timeZone.value;
    state.draft.standardDuration = Number(dom.standardDuration.value);
    dom.id.value = state.draft.id;
  }

  async function exportCatalog() {
    syncMetadataFromForm();
    const validation = validateDraft();
    if (validation.valid && !isDraftAlreadySaved(validation.publishAt)) {
      const shouldSave = window.confirm('Đề đang soạn đã đủ dữ liệu nhưng chưa được lưu vào kho. Lưu đề này trước khi tải file?');
      if (shouldSave) {
        const saved = await saveCurrentExam({ quiet: true });
        if (!saved) return;
      }
    }
    if (!state.catalog.length) {
      showToast('Kho đề đang trống. Hãy lưu ít nhất một đề trước khi xuất file.', 'error');
      return;
    }
    const cleanCatalog = state.catalog.map(normalizeCatalogExam).filter(Boolean);
    const source = `window.MATH_EXAMS = ${JSON.stringify(cleanCatalog, null, 2)};\n`;
    const blob = new Blob([source], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'math-exams.js';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Đã tạo math-exams.js với ${cleanCatalog.length} đề.`, 'success');
  }

  function isDraftAlreadySaved(publishAt) {
    const existing = state.catalog.find((item) => item.id === state.draft.id);
    if (!existing) return false;
    const draftComparable = {
      id: state.draft.id,
      title: state.draft.title.trim(),
      description: state.draft.description.trim(),
      publishAt,
      timeZone: state.draft.timeZone,
      standardDuration: Number(state.draft.standardDuration),
      demo: Boolean(state.draft.demo),
      sections: state.draft.sections
    };
    const existingComparable = {
      id: existing.id,
      title: existing.title,
      description: existing.description,
      publishAt: existing.publishAt,
      timeZone: existing.timeZone,
      standardDuration: existing.standardDuration,
      demo: Boolean(existing.demo),
      sections: existing.sections
    };
    return JSON.stringify(draftComparable) === JSON.stringify(existingComparable);
  }

  async function importCatalogFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 80 * 1024 * 1024) {
      showToast('File dữ liệu quá lớn để nhập trong trình duyệt.', 'error');
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseCatalogSource(text);
      if (!Array.isArray(parsed)) throw new Error('Catalog is not an array');
      const normalized = parsed.map(normalizeCatalogExam).filter(Boolean);
      if (!normalized.length) throw new Error('No valid exam');
      const invalidCount = parsed.length - normalized.length;
      if (invalidCount > 0) throw new Error(`${invalidCount} invalid exam(s)`);
      state.catalog = mergeCatalogs(state.catalog, normalized);
      normalized.forEach((exam) => state.deletedIds.delete(exam.id));
      await persistCatalog();
      renderCatalog();
      showToast(`Đã nhập ${normalized.length} đề từ file.`, 'success');
    } catch (error) {
      showToast('Không thể nhập file. Hãy chọn file math-exams.js do công cụ này tạo.', 'error');
    }
  }

  function parseCatalogSource(source) {
    const trimmed = String(source || '').trim();
    if (trimmed.startsWith('[')) return JSON.parse(trimmed);
    const match = trimmed.match(/^window\.MATH_EXAMS\s*=\s*([\s\S]*?)\s*;?\s*$/);
    if (!match) throw new Error('Unexpected source format');
    return JSON.parse(match[1]);
  }

  function renderCatalog() {
    dom.catalogList.replaceChildren();
    if (!state.catalog.length) {
      const empty = createElement('div', 'empty-state compact-empty');
      empty.append(
        createElement('span', 'empty-state-icon', '🗂️'),
        createElement('h3', '', 'Kho đề đang trống'),
        createElement('p', '', 'Hoàn thiện đề đang soạn rồi nhấn “Lưu vào kho đề”.')
      );
      dom.catalogList.appendChild(empty);
      return;
    }

    const sorted = state.catalog.slice().sort((a, b) => new Date(b.publishAt) - new Date(a.publishAt));
    sorted.forEach((exam) => {
      const card = createElement('article', 'catalog-item');
      const copy = createElement('div', 'catalog-item-copy');
      const titleRow = createElement('div', 'catalog-title-row');
      titleRow.appendChild(createElement('h3', '', exam.title));
      if (exam.demo) titleRow.appendChild(createElement('span', 'badge badge-demo', 'Đề mẫu'));
      copy.appendChild(titleRow);
      const meta = createElement('p', 'catalog-meta');
      meta.append(
        createElement('code', '', exam.id),
        document.createTextNode(` · Mở ${formatExamDate(exam.publishAt, exam.timeZone)} · v${exam.version}`)
      );
      copy.appendChild(meta);
      if (exam.description) copy.appendChild(createElement('p', 'catalog-description', exam.description));

      const actions = createElement('div', 'catalog-item-actions');
      const editButton = createButton('Chỉnh sửa', 'btn btn-small btn-secondary');
      editButton.addEventListener('click', () => loadExamIntoDraft(exam.id));
      const deleteButton = createButton('Xóa', 'btn btn-small btn-danger');
      deleteButton.addEventListener('click', () => deleteExam(exam.id));
      actions.append(editButton, deleteButton);
      card.append(copy, actions);
      dom.catalogList.appendChild(card);
    });
  }

  async function loadExamIntoDraft(id) {
    const exam = state.catalog.find((item) => item.id === id);
    if (!exam) return;
    if (state.draft.title && !window.confirm(`Mở “${exam.title}” để chỉnh sửa? Bản nháp hiện tại sẽ được thay thế.`)) return;
    state.draft = examToDraft(exam);
    state.idWasEdited = true;
    fillMetadataForm();
    renderQuestionBuilders();
    updateProgress();
    removeErrorSummary();
    await saveDraftNow();
    document.querySelector('.metadata-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Đã mở đề để chỉnh sửa.', 'success');
  }

  async function deleteExam(id) {
    const exam = state.catalog.find((item) => item.id === id);
    if (!exam || !window.confirm(`Xóa “${exam.title}” khỏi file sẽ xuất?`)) return;
    state.catalog = state.catalog.filter((item) => item.id !== id);
    state.deletedIds.add(id);
    await persistCatalog();
    renderCatalog();
    showToast('Đã xóa đề khỏi kho trên thiết bị.', 'success');
  }

  async function resetDraft() {
    if (state.draft && hasDraftContent(state.draft) && !window.confirm('Tạo đề mới và xóa bản nháp hiện tại? Các đề đã lưu trong kho vẫn được giữ nguyên.')) return;
    state.draft = createEmptyDraft();
    state.idWasEdited = false;
    fillMetadataForm();
    renderQuestionBuilders();
    updateProgress();
    removeErrorSummary();
    await saveDraftNow();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('Đã tạo bản nháp mới.', 'success');
  }

  function hasDraftContent(draft) {
    if (!draft) return false;
    return Boolean(
      draft.title || draft.description || draft.sections.multipleChoice.some((q) => q.image || q.answer) ||
      draft.sections.trueFalse.some((q) => q.image || q.answers.some((a) => a !== null)) ||
      draft.sections.shortAnswer.some((q) => q.image || q.answer)
    );
  }

  function examToDraft(exam) {
    return normalizeDraft({
      id: exam.id,
      title: exam.title,
      description: exam.description,
      publishLocal: isoToZonedInput(exam.publishAt, exam.timeZone),
      timeZone: exam.timeZone,
      standardDuration: exam.standardDuration,
      version: exam.version,
      demo: exam.demo,
      sections: exam.sections
    });
  }

  function showErrorSummary(errors) {
    removeErrorSummary();
    const summary = createElement('section', 'error-summary');
    summary.id = 'builder-error-summary';
    summary.tabIndex = -1;
    summary.setAttribute('role', 'alert');
    summary.appendChild(createElement('h2', '', `Cần hoàn thiện ${errors.length} mục`));
    const intro = createElement('p', '', 'Kiểm tra các mục dưới đây rồi lưu lại:');
    summary.appendChild(intro);
    const list = document.createElement('ul');
    errors.slice(0, 14).forEach((message) => list.appendChild(createElement('li', '', message)));
    if (errors.length > 14) list.appendChild(createElement('li', '', `… và ${errors.length - 14} mục khác.`));
    summary.appendChild(list);
    dom.form.parentNode.insertBefore(summary, dom.form);
    summary.focus();
    summary.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function removeErrorSummary() {
    const summary = document.getElementById('builder-error-summary');
    if (summary) summary.remove();
  }

  function queueDraftSave() {
    if (!state.initialized) return;
    window.clearTimeout(state.autosaveTimer);
    dom.autosaveStatus.textContent = state.storageAvailable ? 'Đang chờ tự lưu…' : 'Tự lưu không khả dụng trong trình duyệt này.';
    state.autosaveTimer = window.setTimeout(saveDraftNow, 550);
  }

  async function saveDraftNow() {
    if (!state.storageAvailable || !state.draft) return;
    window.clearTimeout(state.autosaveTimer);
    try {
      await dbPut('draft', clone(state.draft));
      dom.autosaveStatus.textContent = `Đã tự lưu lúc ${new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())}.`;
    } catch (error) {
      disablePersistence();
    }
  }

  async function persistCatalog() {
    if (!state.storageAvailable) return;
    try {
      await dbPut('catalog', clone(state.catalog));
      await dbPut('deletedIds', Array.from(state.deletedIds));
    } catch (error) {
      disablePersistence();
    }
  }

  function disablePersistence() {
    state.storageAvailable = false;
    if (dom.autosaveStatus) dom.autosaveStatus.textContent = 'Không thể tự lưu trên thiết bị này; hãy xuất file trước khi đóng trang.';
  }

  let databasePromise;
  function openDatabase() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DB_STORE)) database.createObjectStore(DB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open database'));
    });
    return databasePromise;
  }

  async function dbGet(key) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DB_STORE, 'readonly');
      const request = transaction.objectStore(DB_STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Read failed'));
    });
  }

  async function dbPut(key, value) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DB_STORE, 'readwrite');
      transaction.objectStore(DB_STORE).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Write failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Write aborted'));
    });
  }

  function mergeCatalogs(base, overlay) {
    const map = new Map();
    base.forEach((exam) => map.set(exam.id, exam));
    overlay.forEach((exam) => {
      const current = map.get(exam.id);
      if (!current || Number(exam.version || 0) >= Number(current.version || 0)) {
        map.set(exam.id, exam);
      }
    });
    return Array.from(map.values());
  }

  function zonedLocalToIso(localValue, timeZone) {
    const match = String(localValue).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match || !isSupportedTimeZone(timeZone)) throw new Error('Invalid date');
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
    if (Number.isNaN(date.getTime())) return defaultPublishLocal(timeZone);
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

  function defaultPublishLocal(timeZone) {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    date.setUTCMinutes(Math.ceil(date.getUTCMinutes() / 5) * 5, 0, 0);
    return isoToZonedInputSafe(date, timeZone);
  }

  function isoToZonedInputSafe(date, timeZone) {
    try {
      const parts = zonedParts(date, timeZone);
      return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
    } catch (error) {
      return date.toISOString().slice(0, 16);
    }
  }

  function isSupportedTimeZone(timeZone) {
    if (!['Asia/Ho_Chi_Minh', 'Australia/Sydney', 'UTC'].includes(String(timeZone))) return false;
    try {
      new Intl.DateTimeFormat('en', { timeZone }).format();
      return true;
    } catch (error) {
      return false;
    }
  }

  function formatExamDate(isoValue, timeZone) {
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        timeZone,
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZoneName: 'short'
      }).format(new Date(isoValue));
    } catch (error) {
      return new Date(isoValue).toLocaleString('vi-VN');
    }
  }

  function showToast(message, type, duration) {
    window.clearTimeout(state.toastTimer);
    dom.toast.textContent = String(message);
    dom.toast.className = `toast toast-${type || 'info'}`;
    dom.toast.hidden = false;
    const delay = duration === 0 ? 0 : (duration || 4200);
    if (delay) state.toastTimer = window.setTimeout(() => { dom.toast.hidden = true; }, delay);
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function createButton(text, className) {
    const button = createElement('button', className, text);
    button.type = 'button';
    return button;
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[đĐ]/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 80);
  }

  function safeImageString(value) {
    const source = typeof value === 'string' ? value : '';
    if (/^data:image\/(?:png|jpeg|webp|gif|svg\+xml)(?:;[^,]*)?,/i.test(source)) return source;
    if (/^(?:https:\/\/|\.\.?\/|[a-zA-Z0-9_-]+\/)[^\s]+$/i.test(source)) return source.slice(0, 5000);
    return '';
  }

  function cleanText(value, maxLength) {
    return String(value || '').replace(/\u0000/g, '').slice(0, maxLength);
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
  }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }
})();
