const app = document.getElementById('app');
const STORAGE_KEY = 'surveyt-teacher-growth-state-v1';
const PROMPT_URL = '/prompt.txt';

const STATE = {
  title: '',
  sections: [],
  responses: {},
  pageIndex: 0,
  savedAt: null,
  promptTemplate: '',
  aiModalOpen: false,
};

boot();

async function boot() {
  try {
    const responses = await Promise.all([
      fetch('/survey-content.md', { cache: 'no-store' }),
      fetch(PROMPT_URL, { cache: 'no-store' }),
    ]);

    const surveyResponse = responses[0];
    const promptResponse = responses[1];

    if (!surveyResponse.ok) {
      throw new Error('설문 문항 파일을 불러오지 못했습니다.');
    }

    if (!promptResponse.ok) {
      throw new Error('AI 분석 프롬프트 파일을 불러오지 못했습니다.');
    }

    const markdown = await surveyResponse.text();
    STATE.promptTemplate = await promptResponse.text();
    const parsed = parseSurveyMarkdown(markdown);

    STATE.title = parsed.title;
    STATE.sections = parsed.sections;

    if (!STATE.sections.length) {
      throw new Error('설문 섹션을 해석하지 못했습니다.');
    }

    hydrateState();
    document.title = STATE.title + ' 설문';
    render();
  } catch (error) {
    app.innerHTML = '<div class="error-state">' + escapeHtml(error.message) + '</div>';
  }
}

function parseSurveyMarkdown(markdown) {
  const title = (markdown.split(/\r?\n/).find((line) => line.trim()) || '교원역량 행동지표').trim();
  const lines = markdown.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sections = [];

  let currentSection = null;
  let currentSubsection = null;
  let questionId = 1;

  for (const line of lines) {
    if (line === title) {
      continue;
    }

    if (isSectionHeading(line)) {
      currentSection = {
        id: 'section-' + (sections.length + 1),
        title: normalizeHeading(line),
        description: createSectionDescription(sections.length),
        subsections: [],
      };
      sections.push(currentSection);
      currentSubsection = null;
      continue;
    }

    if (/^[①-⑫]/.test(line)) {
      if (!currentSection) {
        continue;
      }

      currentSubsection = {
        id: 'subsection-' + sections.length + '-' + (currentSection.subsections.length + 1),
        title: normalizeHeading(line),
        questions: [],
      };
      currentSection.subsections.push(currentSubsection);
      continue;
    }

    if (/^（.+）/.test(line) && currentSubsection) {
      const match = line.match(/^（(.+?)）(.+)$/);
      const question = {
        id: 'q-' + questionId++,
        category: match ? match[1].trim() : '',
        text: match ? match[2].trim() : line,
      };
      currentSubsection.questions.push(question);
    }
  }

  return { title, sections };
}

function isSectionHeading(line) {
  return /^[1-4１-４][\.。]/.test(line) || /^[1-4１-４]\\\./.test(line);
}

function normalizeHeading(line) {
  return line
    .replace(/^[1-4１-４]\\\./, '')
    .replace(/^[1-4１-４][\.。]\s*/, '')
    .replace(/^[①-⑫]\s*/, '')
    .trim();
}

function createSectionDescription(index) {
  const descriptions = [
    '교수 역량 전반을 점검하는 영역입니다. 교육과정, 수업, 학습지원에 대한 자기진단으로 구성됩니다.',
    '생활교육 관련 실천 역량을 살피는 영역입니다. 학생 이해, 생활인성 지도, 진로지도 문항을 포함합니다.',
    '교육공동체와의 관계 및 협업 역량을 진단하는 영역입니다. 소통, 학교공동체 참여, 네트워크 활용을 다룹니다.',
    '자기개발과 전문성 유지 역량을 확인하는 영역입니다. 변화대응, 자기개발, 교직윤리 문항으로 구성됩니다.',
  ];

  return descriptions[index] || '해당 영역에 대한 자기진단 문항입니다.';
}

function hydrateState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const saved = JSON.parse(raw);
    const validQuestionIds = new Set(getAllQuestions().map(function(question) {
      return question.id;
    }));

    STATE.responses = Object.entries(saved.responses || {}).reduce(function(acc, entry) {
      const key = entry[0];
      const value = Number(entry[1]);
      if (validQuestionIds.has(key) && value >= 1 && value <= 5) {
        acc[key] = value;
      }
      return acc;
    }, {});

    STATE.pageIndex = Number.isInteger(saved.pageIndex)
      ? Math.min(Math.max(saved.pageIndex, 0), STATE.sections.length)
      : 0;
    STATE.savedAt = saved.savedAt || null;
  } catch (_error) {
    STATE.responses = {};
    STATE.pageIndex = 0;
    STATE.savedAt = null;
  }
}

function persistState() {
  STATE.savedAt = new Date().toISOString();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    responses: STATE.responses,
    pageIndex: STATE.pageIndex,
    savedAt: STATE.savedAt,
  }));
}

function clearSavedState() {
  STATE.responses = {};
  STATE.pageIndex = 0;
  STATE.savedAt = null;
  window.localStorage.removeItem(STORAGE_KEY);
}

function render() {
  const totalPages = STATE.sections.length + 1;
  const progress = Math.round(((STATE.pageIndex + 1) / totalPages) * 100);
  const mainMarkup = STATE.pageIndex < STATE.sections.length
    ? renderSectionPage(STATE.sections[STATE.pageIndex], STATE.pageIndex)
    : renderResultPage();
  const modalMarkup = STATE.aiModalOpen ? renderAiModal() : '';

  app.innerHTML = [
    '<div class="progress-strip">',
    '  <div class="progress-strip__bar">',
    '    <div class="progress-strip__fill" style="width: ' + progress + '%;"></div>',
    '  </div>',
    '  <div class="progress-strip__text">페이지 ' + (STATE.pageIndex + 1) + ' / ' + totalPages + '</div>',
    '</div>',
    mainMarkup,
    modalMarkup,
  ].join('');

  bindEvents();
}

function renderSectionPage(section, pageIndex) {
  const questionCount = countSectionQuestions(section);
  const answeredCount = countAnsweredQuestions(section);
  const subsectionMarkup = section.subsections.map(function(subsection, subsectionIndex) {
    return [
      '<article class="subsection-block">',
      '  <div class="subsection-header">',
      '    <div>',
      '      <p class="subsection-label">Dimension ' + (pageIndex + 1) + '.' + (subsectionIndex + 1) + '</p>',
      '      <h3 class="subsection-title">' + escapeHtml(subsection.title) + '</h3>',
      '    </div>',
      '    <span class="subsection-meta">' + subsection.questions.length + '개 문항</span>',
      '  </div>',
      subsection.questions.map(renderQuestionCard).join(''),
      '</article>',
    ].join('');
  }).join('');

  return [
    '<section class="section-page">',
    '  <div class="section-header">',
    '    <div>',
    '      <p class="page-label">Part ' + String(pageIndex + 1).padStart(2, '0') + '</p>',
    '      <h2>' + escapeHtml(section.title) + '</h2>',
    '      <p class="section-desc">' + escapeHtml(section.description) + '</p>',
    '    </div>',
    '    <div class="section-meta">',
    '      <span class="score-hint">응답 현황</span>',
    '      <strong>' + answeredCount + ' / ' + questionCount + '</strong>',
    '      <span class="save-hint">' + renderSaveHint() + '</span>',
    '    </div>',
    '  </div>',
    subsectionMarkup,
    '  <div class="page-actions">',
    '    <div class="page-actions__hint">현재 페이지의 응답은 자동 저장됩니다.</div>',
    '    <div class="button-row">',
    '      <button class="btn btn--ghost" type="button" data-action="prev" ' + (pageIndex === 0 ? 'disabled' : '') + '>이전 페이지</button>',
    '      <button class="btn btn--primary" type="button" data-action="next">' + (pageIndex === STATE.sections.length - 1 ? '결과 보기' : '다음 페이지') + '</button>',
    '    </div>',
    '  </div>',
    '</section>',
  ].join('');
}

function renderQuestionCard(question) {
  const selected = STATE.responses[question.id];
  const optionsMarkup = [1, 2, 3, 4, 5].map(function(value) {
    return [
      '<label class="scale-option">',
      '  <input type="radio" name="' + question.id + '" value="' + value + '" ' + (selected === value ? 'checked' : '') + ' data-question-id="' + question.id + '">',
      '  <span>' + value + '</span>',
      '</label>',
    ].join('');
  }).join('');

  return [
    '<div class="question-card">',
    '  <p class="question-text"><strong>[' + escapeHtml(question.category) + ']</strong> ' + escapeHtml(question.text) + '</p>',
    '  <div class="scale-legend"><span>아니다</span><span>그렇다</span></div>',
    '  <div class="scale-row" role="radiogroup" aria-label="' + escapeHtml(question.text) + '">',
    optionsMarkup,
    '  </div>',
    '</div>',
  ].join('');
}

function renderResultPage() {
  const summaries = STATE.sections.map(function(section) {
    const score = getSectionScore(section);
    const questionCount = countSectionQuestions(section);
    const maxScore = questionCount * 5;
    const average = questionCount ? (score / questionCount).toFixed(2) : '0.00';
    const percent = maxScore ? Math.round((score / maxScore) * 100) : 0;
    const subsectionRows = section.subsections.map(function(subsection) {
      const subsectionScore = getSubsectionScore(subsection);
      const subsectionMax = subsection.questions.length * 5;
      const subsectionAverage = subsection.questions.length
        ? (subsectionScore / subsection.questions.length).toFixed(2)
        : '0.00';

      return [
        '<tr>',
        '  <td>' + escapeHtml(subsection.title) + '</td>',
        '  <td>' + subsection.questions.length + '</td>',
        '  <td>' + subsectionScore + ' / ' + subsectionMax + '</td>',
        '  <td>' + subsectionAverage + '</td>',
        '</tr>',
      ].join('');
    }).join('');

    return { section, score, questionCount, maxScore, average, percent, subsectionRows };
  });

  const summaryMarkup = summaries.map(function(item) {
    return [
      '<article class="summary-card">',
      '  <div class="summary-card__head">',
      '    <div>',
      '      <p class="chart-label">' + escapeHtml(item.section.title) + '</p>',
      '      <h3>' + escapeHtml(item.section.description) + '</h3>',
      '    </div>',
      '    <span class="meta-chip">' + item.percent + '%</span>',
      '  </div>',
      '  <div class="chart" style="--value: ' + item.percent + ';">',
      '    <div class="chart__center">',
      '      <span class="chart__score">' + item.score + '</span>',
      '      <span class="chart__meta">/ ' + item.maxScore + '점</span>',
      '    </div>',
      '  </div>',
      '  <div class="summary-stats">',
      '    <div class="summary-stat"><strong>' + item.questionCount + '개</strong><span>문항 수</span></div>',
      '    <div class="summary-stat"><strong>' + item.average + '</strong><span>평균 점수</span></div>',
      '    <div class="summary-stat"><strong>' + item.percent + '%</strong><span>달성 비율</span></div>',
      '  </div>',
      '  <div class="detail-table-wrap">',
      '    <table class="detail-table">',
      '      <thead><tr><th>세부영역</th><th>문항</th><th>합계</th><th>평균</th></tr></thead>',
      '      <tbody>' + item.subsectionRows + '</tbody>',
      '    </table>',
      '  </div>',
      '</article>',
    ].join('');
  }).join('');

  return [
    '<section class="result-page">',
    '  <div class="result-header">',
    '    <div>',
    '      <p class="page-label">Results</p>',
    '      <h2>영역별 결과 보기</h2>',
    '      <p class="result-subtitle">각 대영역의 합계를 파이차트로 시각화했습니다. 파란 영역은 현재 획득 점수, 회색 영역은 남은 최대 점수입니다.</p>',
    '    </div>',
    '    <div class="section-meta">',
    '      <span class="score-hint">총 응답 수</span>',
    '      <strong>' + Object.keys(STATE.responses).length + ' / ' + getAllQuestions().length + '</strong>',
    '      <span class="save-hint">' + renderSaveHint() + '</span>',
    '    </div>',
    '  </div>',
    '  <div class="result-grid">',
    summaryMarkup,
    '  </div>',
    '  <div class="result-footer">',
    '    <p class="result-note">영역별 파이차트 아래에는 세부영역 점수표를 추가해 결과를 더 세밀하게 비교할 수 있게 했습니다.</p>',
    '    <div class="button-row">',
    '      <button class="btn btn--ghost" type="button" data-action="prev">이전 페이지</button>',
    '      <button class="btn btn--ghost" type="button" data-action="print">인쇄 / PDF 저장</button>',
    '      <button class="btn btn--ghost" type="button" data-action="reset">응답 초기화</button>',
    '      <button class="btn btn--success" type="button" data-action="restart">처음으로 이동</button>',
    '    </div>',
    '  </div>',
    '</section>',
  ].join('');
}

function renderSaveHint() {
  if (!STATE.savedAt) {
    return '저장 대기 중';
  }

  const savedDate = new Date(STATE.savedAt);
  if (Number.isNaN(savedDate.getTime())) {
    return '자동 저장됨';
  }

  const time = savedDate.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return time + ' 자동 저장';
}

function renderAiModal() {
  const promptText = buildAiPrompt();

  return [
    '<div class="modal-backdrop" data-action="close-modal"></div>',
    '<section class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">',
    '  <div class="modal-sheet__header">',
    '    <div>',
    '      <h3 id="ai-modal-title" class="modal-sheet__title">AI도구 활용 결과 분석</h3>',
    '      <p class="modal-sheet__subtext">아래 내용을 복사해서 AI 도구(ChatGPT, 제미나이 등)에 분석해보세요</p>',
    '    </div>',
    '    <div class="button-row">',
    '      <button class="btn btn--ghost btn--compact" type="button" data-action="copy-ai-prompt">복사하기</button>',
    '      <button class="btn btn--ghost btn--compact" type="button" data-action="close-modal">닫기</button>',
    '    </div>',
    '  </div>',
    '  <div class="modal-sheet__body">',
    '    <textarea class="modal-prompt" readonly>' + escapeHtml(promptText) + '</textarea>',
    '  </div>',
    '</section>',
  ].join('');
}

function buildAiPrompt() {
  const allQuestions = getAllQuestions();
  const totalScore = allQuestions.reduce(function(sum, question) {
    return sum + (STATE.responses[question.id] || 0);
  }, 0);
  const overallAverage = allQuestions.length ? (totalScore / allQuestions.length).toFixed(2) : '0.00';

  const sectionSummary = STATE.sections.map(function(section) {
    const questionCount = countSectionQuestions(section);
    const score = getSectionScore(section);
    const average = questionCount ? (score / questionCount).toFixed(2) : '0.00';
    const subsectionLines = section.subsections.map(function(subsection) {
      const subsectionScore = getSubsectionScore(subsection);
      const subsectionAverage = subsection.questions.length
        ? (subsectionScore / subsection.questions.length).toFixed(2)
        : '0.00';

      return '- 세부영역: ' + subsection.title + ' | 합계: ' + subsectionScore + ' | 평균: ' + subsectionAverage;
    }).join('\n');

    return [
      '[영역] ' + section.title,
      '- 영역 설명: ' + section.description,
      '- 문항 수: ' + questionCount,
      '- 합계 점수: ' + score,
      '- 평균 점수: ' + average,
      subsectionLines,
    ].join('\n');
  }).join('\n\n');

  const questionSummary = STATE.sections.map(function(section) {
    return section.subsections.map(function(subsection) {
      return subsection.questions.map(function(question, index) {
        return '- ' + section.title + ' > ' + subsection.title + ' > 문항 ' + (index + 1) + ': ' + question.text + ' = ' + (STATE.responses[question.id] || 0) + '점';
      }).join('\n');
    }).join('\n');
  }).join('\n');

  return [
    STATE.promptTemplate.trim(),
    '',
    '[응답 결과 요약]',
    '- 전체 문항 수: ' + allQuestions.length,
    '- 총합 점수: ' + totalScore,
    '- 전체 평균 점수: ' + overallAverage,
    '',
    '[영역별 결과]',
    sectionSummary,
    '',
    '[문항별 점수]',
    questionSummary,
  ].join('\n');
}

function bindEvents() {
  app.querySelectorAll('input[type="radio"]').forEach(function(input) {
    input.addEventListener('change', handleAnswerChange);
  });

  app.querySelectorAll('[data-action]').forEach(function(button) {
    button.addEventListener('click', handleAction);
  });

  const modalPrompt = app.querySelector('.modal-prompt');
  if (modalPrompt) {
    modalPrompt.scrollTop = 0;
  }
}

function handleAnswerChange(event) {
  const questionId = event.target.dataset.questionId;
  const value = Number(event.target.value);
  STATE.responses[questionId] = value;
  persistState();
  render();
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;

  if (action === 'prev') {
    STATE.pageIndex = Math.max(0, STATE.pageIndex - 1);
    persistState();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (action === 'next') {
    const currentSection = STATE.sections[STATE.pageIndex];
    const unanswered = getUnansweredQuestions(currentSection);

    if (unanswered.length) {
      window.alert('현재 페이지에 미응답 문항이 ' + unanswered.length + '개 있습니다. 모두 응답한 뒤 다음으로 이동해 주세요.');
      return;
    }

    STATE.pageIndex = Math.min(STATE.sections.length, STATE.pageIndex + 1);
    persistState();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (action === 'restart') {
    STATE.pageIndex = 0;
    persistState();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (action === 'ai-analysis') {
    STATE.aiModalOpen = true;
    render();
    return;
  }

  if (action === 'close-modal') {
    STATE.aiModalOpen = false;
    render();
    return;
  }

  if (action === 'copy-ai-prompt') {
    copyAiPrompt();
    return;
  }

  if (action === 'print') {
    window.print();
    return;
  }

  if (action === 'reset') {
    const confirmed = window.confirm('저장된 응답을 모두 초기화하시겠습니까?');
    if (!confirmed) {
      return;
    }

    clearSavedState();
    STATE.aiModalOpen = false;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function copyAiPrompt() {
  const promptText = buildAiPrompt();

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(promptText).then(function() {
      window.alert('AI 분석 프롬프트를 복사했습니다.');
    }).catch(function() {
      fallbackCopy(promptText);
    });
    return;
  }

  fallbackCopy(promptText);
}

function fallbackCopy(value) {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  window.alert('AI 분석 프롬프트를 복사했습니다.');
}

function getAllQuestions() {
  return STATE.sections.flatMap(function(section) {
    return section.subsections.flatMap(function(subsection) {
      return subsection.questions;
    });
  });
}

function countSectionQuestions(section) {
  return section.subsections.reduce(function(sum, subsection) {
    return sum + subsection.questions.length;
  }, 0);
}

function countAnsweredQuestions(section) {
  return section.subsections.reduce(function(sum, subsection) {
    return sum + subsection.questions.filter(function(question) {
      return Boolean(STATE.responses[question.id]);
    }).length;
  }, 0);
}

function getSectionScore(section) {
  return section.subsections.reduce(function(sum, subsection) {
    return sum + getSubsectionScore(subsection);
  }, 0);
}

function getSubsectionScore(subsection) {
  return subsection.questions.reduce(function(questionSum, question) {
    return questionSum + (STATE.responses[question.id] || 0);
  }, 0);
}

function getUnansweredQuestions(section) {
  return section.subsections.flatMap(function(subsection) {
    return subsection.questions;
  }).filter(function(question) {
    return !STATE.responses[question.id];
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
