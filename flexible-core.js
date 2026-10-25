(function (root, factory) {
  'use strict';

  const api = factory();
  if (root) root.HanaFlexible = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const QUESTION_TYPES = Object.freeze([
    'multipleChoice',
    'trueFalse',
    'shortAnswer',
    'fillBlank',
    'essay'
  ]);
  const TYPE_LABELS = Object.freeze({
    multipleChoice: 'Trắc nghiệm',
    trueFalse: 'Đúng / Sai',
    shortAnswer: 'Trả lời ngắn',
    fillBlank: 'Đục lỗ',
    essay: 'Tự luận'
  });

  function asString(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  function round(value, digits) {
    const scale = Math.pow(10, Number.isInteger(digits) ? digits : 6);
    return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
  }

  function slugify(value) {
    return asString(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function uniqueId(prefix) {
    const safePrefix = slugify(prefix || 'item') || 'item';
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return safePrefix + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    }
    const seed = Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    return safePrefix + '-' + seed.slice(0, 16);
  }

  function normalizeDomain(value) {
    return asString(value)
      .trim()
      .toLowerCase()
      .replace(/^@+/, '')
      .replace(/\.+$/, '');
  }

  function isValidDomain(value) {
    const domain = normalizeDomain(value);
    return domain.length <= 253
      && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain);
  }

  function normalizeDomains(values) {
    const source = Array.isArray(values)
      ? values
      : asString(values).split(/[\n,;]+/);
    const seen = new Set();
    return source.reduce(function collect(result, item) {
      const domain = normalizeDomain(item);
      if (domain && !seen.has(domain)) {
        seen.add(domain);
        result.push(domain);
      }
      return result;
    }, []);
  }

  function emailDomain(email) {
    const normalized = asString(email).trim().toLowerCase();
    const at = normalized.lastIndexOf('@');
    if (at <= 0 || at === normalized.length - 1 || normalized.indexOf('@') !== at) return '';
    return normalizeDomain(normalized.slice(at + 1));
  }

  function emailMatchesDomains(email, domains) {
    const domain = emailDomain(email);
    if (!domain) return false;
    return normalizeDomains(domains).some(function exactMatch(allowed) {
      return domain === allowed;
    });
  }

  function normalizeImages(images) {
    if (!Array.isArray(images)) return [];
    return images
      .map(function imageToString(image) { return asString(image).trim(); })
      .filter(Boolean);
  }

  function normalizeAcceptedAnswers(values) {
    const source = Array.isArray(values) ? values : asString(values).split('|');
    const seen = new Set();
    return source.reduce(function collect(result, value) {
      const answer = asString(value).trim();
      if (answer && !seen.has(answer)) {
        seen.add(answer);
        result.push(answer);
      }
      return result;
    }, []);
  }

  function normalizeTextAnswer(value, options) {
    const settings = options || {};
    let normalized = asString(value);
    if (typeof normalized.normalize === 'function') normalized = normalized.normalize('NFKC');
    normalized = normalized
      .replace(/[\u2212\u2012\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(\d),(?=\d)/g, '$1.');
    if (!settings.caseSensitive) normalized = normalized.toLocaleLowerCase('vi');
    return normalized;
  }

  function answersMatch(given, acceptedAnswers, options) {
    const normalizedGiven = normalizeTextAnswer(given, options);
    if (!normalizedGiven) return false;
    return normalizeAcceptedAnswers(acceptedAnswers).some(function compare(accepted) {
      return normalizedGiven === normalizeTextAnswer(accepted, options);
    });
  }

  function normalizeBooleanAnswer(value) {
    if (value === true || value === false) return value;
    const normalized = normalizeTextAnswer(value);
    if (['true', '1', 'dung', 'đúng', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'sai', 'no'].includes(normalized)) return false;
    return null;
  }

  function defaultOptions() {
    return ['A', 'B', 'C', 'D'].map(function makeOption(id) {
      return { id: id, text: '' };
    });
  }

  function defaultStatements() {
    return ['a', 'b', 'c', 'd'].map(function makeStatement(id) {
      return { id: id, text: '', answer: null };
    });
  }

  function defaultBlanks() {
    return [{ id: 'b1', label: 'Ô trống 1', acceptedAnswers: [] }];
  }

  function validType(type) {
    return QUESTION_TYPES.includes(type) ? type : 'multipleChoice';
  }

  function createQuestion(type, overrides) {
    const questionType = validType(type);
    const base = {
      id: uniqueId('q'),
      type: questionType,
      points: 1,
      prompt: '',
      images: []
    };

    if (questionType === 'multipleChoice') {
      base.options = defaultOptions();
      base.correctOptionId = '';
    } else if (questionType === 'trueFalse') {
      base.statements = defaultStatements();
      base.scoringMode = 'proportional';
    } else if (questionType === 'shortAnswer') {
      base.acceptedAnswers = [];
      base.maxLength = 120;
      base.caseSensitive = false;
    } else if (questionType === 'fillBlank') {
      base.blanks = defaultBlanks();
      base.scoringMode = 'proportional';
      base.caseSensitive = false;
    } else if (questionType === 'essay') {
      base.maxLength = 5000;
    }

    return normalizeQuestion(Object.assign(base, overrides || {}));
  }

  function createExam(overrides) {
    const now = new Date(Date.now() + 60 * 60 * 1000);
    now.setSeconds(0, 0);
    return normalizeExam(Object.assign({
      schemaVersion: SCHEMA_VERSION,
      kind: 'flexible',
      id: '',
      title: '',
      description: '',
      publishAt: now.toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh',
      standardDuration: 45,
      version: 1,
      access: { allowedEmailDomains: [] },
      questions: []
    }, overrides || {}));
  }

  function normalizeOption(option, index) {
    const fallbackId = String.fromCharCode(65 + Math.min(index, 25));
    const source = option && typeof option === 'object' ? option : { id: option };
    return {
      id: asString(source.id || fallbackId).trim().slice(0, 24) || fallbackId,
      text: asString(source.text).trim().slice(0, 1000)
    };
  }

  function normalizeStatement(statement, index) {
    const fallbackId = String.fromCharCode(97 + Math.min(index, 25));
    const source = statement && typeof statement === 'object' ? statement : {};
    return {
      id: asString(source.id || fallbackId).trim().slice(0, 24) || fallbackId,
      text: asString(source.text).trim().slice(0, 3000),
      answer: normalizeBooleanAnswer(source.answer)
    };
  }

  function normalizeBlank(blank, index) {
    const source = blank && typeof blank === 'object' ? blank : {};
    return {
      id: asString(source.id || ('b' + (index + 1))).trim().slice(0, 24) || ('b' + (index + 1)),
      label: asString(source.label || ('Ô trống ' + (index + 1))).trim().slice(0, 180),
      acceptedAnswers: normalizeAcceptedAnswers(source.acceptedAnswers || source.answers || source.answer)
    };
  }

  function normalizeQuestion(question, index) {
    const source = question && typeof question === 'object' ? question : {};
    const type = validType(source.type);
    const normalized = {
      id: asString(source.id).trim().slice(0, 100) || uniqueId('q' + (Number(index) + 1 || '')),
      type: type,
      points: round(clampNumber(source.points, 0, 100000, 1), 6),
      prompt: asString(source.prompt !== undefined ? source.prompt : source.text).trim().slice(0, 20000),
      images: normalizeImages(source.images)
    };

    if (type === 'multipleChoice') {
      const options = Array.isArray(source.options) && source.options.length
        ? source.options
        : (Array.isArray(source.choices) && source.choices.length ? source.choices : defaultOptions());
      normalized.options = options.slice(0, 26).map(normalizeOption);
      normalized.correctOptionId = asString(source.correctOptionId !== undefined ? source.correctOptionId : source.answer).trim().slice(0, 24);
    } else if (type === 'trueFalse') {
      const statements = Array.isArray(source.statements) && source.statements.length
        ? source.statements
        : (Array.isArray(source.answers)
          ? source.answers.map(function fromAnswer(answer, statementIndex) {
            return { id: String.fromCharCode(97 + statementIndex), answer: answer };
          })
          : defaultStatements());
      normalized.statements = statements.slice(0, 26).map(normalizeStatement);
      normalized.scoringMode = source.scoringMode === 'allOrNothing' ? 'allOrNothing' : 'proportional';
    } else if (type === 'shortAnswer') {
      normalized.acceptedAnswers = normalizeAcceptedAnswers(source.acceptedAnswers || source.answers || source.answer);
      normalized.maxLength = Math.round(clampNumber(source.maxLength, 1, 5000, 120));
      normalized.caseSensitive = source.caseSensitive === true;
    } else if (type === 'fillBlank') {
      const blanks = Array.isArray(source.blanks) && source.blanks.length ? source.blanks : defaultBlanks();
      normalized.blanks = blanks.slice(0, 50).map(normalizeBlank);
      normalized.scoringMode = source.scoringMode === 'allOrNothing' ? 'allOrNothing' : 'proportional';
      normalized.caseSensitive = source.caseSensitive === true;
    } else {
      normalized.maxLength = Math.round(clampNumber(source.maxLength, 1, 50000, 5000));
    }

    return normalized;
  }

  function normalizeExam(exam) {
    const source = exam && typeof exam === 'object' ? exam : {};
    const access = source.access && typeof source.access === 'object' ? source.access : {};
    const domains = access.allowedEmailDomains || source.allowedEmailDomains || source.emailDomain || [];
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'flexible',
      id: slugify(source.id),
      title: asString(source.title).trim().slice(0, 180),
      description: asString(source.description).trim().slice(0, 2000),
      publishAt: asString(source.publishAt).trim(),
      timeZone: asString(source.timeZone || 'Asia/Ho_Chi_Minh').trim().slice(0, 80),
      standardDuration: Math.round(clampNumber(source.standardDuration, 5, 480, 45)),
      version: Math.max(1, Math.round(clampNumber(source.version, 1, 1000000, 1))),
      access: {
        allowedEmailDomains: normalizeDomains(domains)
      },
      questions: (Array.isArray(source.questions) ? source.questions : []).map(normalizeQuestion)
    };
  }

  function questionHasVisibleContent(question) {
    if (question.prompt || question.images.length) return true;
    if (question.type === 'multipleChoice') return question.options.some(function hasText(option) { return Boolean(option.text); });
    if (question.type === 'trueFalse') return question.statements.some(function hasText(statement) { return Boolean(statement.text); });
    return false;
  }

  function validateExam(exam, options) {
    const settings = Object.assign({ requireAnswerKeys: true, requireDomains: true }, options || {});
    const normalized = normalizeExam(exam);
    const errors = [];

    if (!normalized.title) errors.push('Cần nhập tiêu đề bài kiểm tra.');
    if (!normalized.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized.id)) errors.push('Mã bài kiểm tra chưa hợp lệ.');
    if (!normalized.publishAt || !Number.isFinite(Date.parse(normalized.publishAt))) errors.push('Thời điểm công khai chưa hợp lệ.');
    if (settings.requireDomains && !normalized.access.allowedEmailDomains.length) errors.push('Cần nhập ít nhất một tên miền email được chấp nhận.');
    normalized.access.allowedEmailDomains.forEach(function checkDomain(domain) {
      if (!isValidDomain(domain)) errors.push('Tên miền email không hợp lệ: ' + domain + '.');
    });
    if (!normalized.questions.length) errors.push('Cần thêm ít nhất một câu hỏi.');

    const ids = new Set();
    normalized.questions.forEach(function validateQuestion(question, questionIndex) {
      const label = 'Câu ' + (questionIndex + 1);
      if (ids.has(question.id)) errors.push(label + ' có mã bị trùng.');
      ids.add(question.id);
      if (!(question.points > 0)) errors.push(label + ' cần có số điểm lớn hơn 0.');
      if (!questionHasVisibleContent(question)) errors.push(label + ' chưa có nội dung chữ hoặc hình ảnh.');

      if (question.type === 'multipleChoice') {
        if (question.options.length < 2) errors.push(label + ' cần ít nhất 2 lựa chọn.');
        const optionIds = new Set(question.options.map(function optionId(option) { return option.id; }));
        if (optionIds.size !== question.options.length) errors.push(label + ' có mã lựa chọn bị trùng.');
        if (settings.requireAnswerKeys && !optionIds.has(question.correctOptionId)) errors.push(label + ' chưa chọn đáp án trắc nghiệm.');
      } else if (question.type === 'trueFalse') {
        if (!question.statements.length) errors.push(label + ' cần ít nhất một ý Đúng / Sai.');
        if (settings.requireAnswerKeys && question.statements.some(function missing(statement) { return statement.answer === null; })) {
          errors.push(label + ' chưa đặt đủ đáp án Đúng / Sai.');
        }
      } else if (question.type === 'shortAnswer') {
        if (settings.requireAnswerKeys && !question.acceptedAnswers.length) errors.push(label + ' chưa có đáp án trả lời ngắn.');
      } else if (question.type === 'fillBlank') {
        if (!question.blanks.length) errors.push(label + ' cần ít nhất một ô trống.');
        if (settings.requireAnswerKeys && question.blanks.some(function missing(blank) { return !blank.acceptedAnswers.length; })) {
          errors.push(label + ' chưa đặt đủ đáp án cho các ô trống.');
        }
      }
    });

    return errors;
  }

  function totals(exam) {
    const normalized = normalizeExam(exam);
    const byType = {};
    QUESTION_TYPES.forEach(function initialize(type) {
      byType[type] = { questions: 0, max: 0 };
    });
    normalized.questions.forEach(function add(question) {
      byType[question.type].questions += 1;
      byType[question.type].max = round(byType[question.type].max + question.points, 6);
    });
    const essayMax = byType.essay.max;
    const objectiveMax = round(QUESTION_TYPES.filter(function objective(type) { return type !== 'essay'; })
      .reduce(function sum(total, type) { return total + byType[type].max; }, 0), 6);
    return {
      questionCount: normalized.questions.length,
      objectiveMax: objectiveMax,
      essayMax: essayMax,
      totalMax: round(objectiveMax + essayMax, 6),
      byType: byType
    };
  }

  function answerForPart(container, id, index) {
    if (Array.isArray(container)) return container[index];
    if (container && typeof container === 'object') return container[id];
    return undefined;
  }

  function scoreQuestion(question, answer) {
    const points = question.points;
    if (question.type === 'essay') return 0;
    if (question.type === 'multipleChoice') {
      return asString(answer).trim() === question.correctOptionId ? points : 0;
    }
    if (question.type === 'shortAnswer') {
      return answersMatch(answer, question.acceptedAnswers, { caseSensitive: question.caseSensitive }) ? points : 0;
    }
    if (question.type === 'trueFalse') {
      const correct = question.statements.reduce(function count(total, statement, index) {
        const given = normalizeBooleanAnswer(answerForPart(answer, statement.id, index));
        return total + (given !== null && given === statement.answer ? 1 : 0);
      }, 0);
      if (question.scoringMode === 'allOrNothing') return correct === question.statements.length ? points : 0;
      return question.statements.length ? points * correct / question.statements.length : 0;
    }
    if (question.type === 'fillBlank') {
      const correct = question.blanks.reduce(function count(total, blank, index) {
        const given = answerForPart(answer, blank.id, index);
        return total + (answersMatch(given, blank.acceptedAnswers, { caseSensitive: question.caseSensitive }) ? 1 : 0);
      }, 0);
      if (question.scoringMode === 'allOrNothing') return correct === question.blanks.length ? points : 0;
      return question.blanks.length ? points * correct / question.blanks.length : 0;
    }
    return 0;
  }

  function scoreSubmission(exam, answers) {
    const normalized = normalizeExam(exam);
    const responseMap = answers && typeof answers === 'object' ? answers : {};
    const summary = totals(normalized);
    const byType = {};
    QUESTION_TYPES.forEach(function initialize(type) {
      byType[type] = {
        earned: 0,
        max: summary.byType[type].max,
        questions: summary.byType[type].questions
      };
    });

    normalized.questions.forEach(function grade(question) {
      if (question.type === 'essay') return;
      const earned = scoreQuestion(question, responseMap[question.id]);
      byType[question.type].earned = round(byType[question.type].earned + earned, 6);
    });

    const objectiveEarned = round(QUESTION_TYPES.filter(function objective(type) { return type !== 'essay'; })
      .reduce(function sum(total, type) { return total + byType[type].earned; }, 0), 6);

    return {
      objectiveEarned: objectiveEarned,
      objectiveMax: summary.objectiveMax,
      essayMax: summary.essayMax,
      totalMax: summary.totalMax,
      byType: byType
    };
  }

  function publicExam(exam) {
    const result = normalizeExam(exam);
    result.questions = result.questions.map(function stripKey(question) {
      const output = Object.assign({}, question);
      if (question.type === 'multipleChoice') {
        delete output.correctOptionId;
      } else if (question.type === 'trueFalse') {
        output.statements = question.statements.map(function publicStatement(statement) {
          return { id: statement.id, text: statement.text };
        });
      } else if (question.type === 'shortAnswer') {
        delete output.acceptedAnswers;
        delete output.caseSensitive;
      } else if (question.type === 'fillBlank') {
        output.blanks = question.blanks.map(function publicBlank(blank) {
          return { id: blank.id, label: blank.label };
        });
        delete output.caseSensitive;
      }
      return output;
    });
    return result;
  }

  function privateExamKey(exam) {
    const normalized = normalizeExam(exam);
    const summary = totals(normalized);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: normalized.id,
      title: normalized.title,
      version: normalized.version,
      allowedEmailDomains: normalized.access.allowedEmailDomains.slice(),
      objectiveMax: summary.objectiveMax,
      essayMax: summary.essayMax,
      questions: normalized.questions.map(function keyForQuestion(question) {
        const key = { id: question.id, type: question.type, points: question.points };
        if (question.type === 'multipleChoice') {
          key.correctOptionId = question.correctOptionId;
        } else if (question.type === 'trueFalse') {
          key.scoringMode = question.scoringMode;
          key.statements = question.statements.map(function statementKey(statement) {
            return { id: statement.id, answer: statement.answer };
          });
        } else if (question.type === 'shortAnswer') {
          key.acceptedAnswers = question.acceptedAnswers.slice();
          key.caseSensitive = question.caseSensitive;
        } else if (question.type === 'fillBlank') {
          key.scoringMode = question.scoringMode;
          key.caseSensitive = question.caseSensitive;
          key.blanks = question.blanks.map(function blankKey(blank) {
            return { id: blank.id, acceptedAnswers: blank.acceptedAnswers.slice() };
          });
        } else {
          key.maxLength = question.maxLength;
        }
        return key;
      })
    };
  }

  function publicCatalog(exams) {
    return (Array.isArray(exams) ? exams : []).map(publicExam);
  }

  function privateKeyCatalog(exams) {
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      exams: (Array.isArray(exams) ? exams : []).map(privateExamKey)
    };
  }

  function mergePublicWithPrivate(publicValue, privateValue) {
    const publicData = normalizeExam(publicValue);
    const keyData = privateValue && typeof privateValue === 'object' ? privateValue : {};
    if (keyData.id && keyData.id !== publicData.id) return publicData;
    if (Array.isArray(keyData.allowedEmailDomains)) {
      publicData.access.allowedEmailDomains = normalizeDomains(keyData.allowedEmailDomains);
    }
    const keyById = new Map((Array.isArray(keyData.questions) ? keyData.questions : []).map(function pair(question) {
      return [asString(question.id), question];
    }));
    publicData.questions = publicData.questions.map(function addKey(question) {
      const key = keyById.get(question.id);
      if (!key || key.type !== question.type) return question;
      const merged = Object.assign({}, question);
      if (question.type === 'multipleChoice') {
        merged.correctOptionId = asString(key.correctOptionId);
      } else if (question.type === 'shortAnswer') {
        merged.acceptedAnswers = normalizeAcceptedAnswers(key.acceptedAnswers);
        merged.caseSensitive = key.caseSensitive === true;
      } else if (question.type === 'trueFalse') {
        const statements = new Map((key.statements || []).map(function pair(statement) { return [asString(statement.id), statement]; }));
        merged.statements = question.statements.map(function addStatementKey(statement) {
          const statementKey = statements.get(statement.id);
          return Object.assign({}, statement, { answer: normalizeBooleanAnswer(statementKey && statementKey.answer) });
        });
        merged.scoringMode = key.scoringMode === 'allOrNothing' ? 'allOrNothing' : 'proportional';
      } else if (question.type === 'fillBlank') {
        const blanks = new Map((key.blanks || []).map(function pair(blank) { return [asString(blank.id), blank]; }));
        merged.blanks = question.blanks.map(function addBlankKey(blank) {
          const blankKey = blanks.get(blank.id);
          return Object.assign({}, blank, { acceptedAnswers: normalizeAcceptedAnswers(blankKey && blankKey.acceptedAnswers) });
        });
        merged.caseSensitive = key.caseSensitive === true;
        merged.scoringMode = key.scoringMode === 'allOrNothing' ? 'allOrNothing' : 'proportional';
      }
      return merged;
    });
    return normalizeExam(publicData);
  }

  return Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    QUESTION_TYPES: QUESTION_TYPES,
    TYPE_LABELS: TYPE_LABELS,
    slugify: slugify,
    uniqueId: uniqueId,
    normalizeDomain: normalizeDomain,
    normalizeDomains: normalizeDomains,
    isValidDomain: isValidDomain,
    emailDomain: emailDomain,
    emailMatchesDomains: emailMatchesDomains,
    normalizeAcceptedAnswers: normalizeAcceptedAnswers,
    normalizeTextAnswer: normalizeTextAnswer,
    answersMatch: answersMatch,
    normalizeBooleanAnswer: normalizeBooleanAnswer,
    createQuestion: createQuestion,
    createExam: createExam,
    normalizeQuestion: normalizeQuestion,
    normalizeExam: normalizeExam,
    validateExam: validateExam,
    totals: totals,
    scoreQuestion: scoreQuestion,
    scoreSubmission: scoreSubmission,
    publicExam: publicExam,
    privateExamKey: privateExamKey,
    publicCatalog: publicCatalog,
    privateKeyCatalog: privateKeyCatalog,
    mergePublicWithPrivate: mergePublicWithPrivate,
    round: round
  });
});
