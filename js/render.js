import {
  buildAiPrompt,
  countAnsweredQuestions,
  countSectionQuestions,
  getAllQuestions,
  getSectionScore,
  getSubsectionScore,
} from './survey.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderApp(app, state) {
  const totalPages = state.sections.length + 1;
  const progress = Math.round(((state.pageIndex + 1) / totalPages) * 100);
  const mainMarkup = state.pageIndex < state.sections.length
    ? renderSectionPage(state, state.sections[state.pageIndex], state.pageIndex)
    : renderResultPage(state);
  const modalMarkup = state.aiModalOpen ? renderAiModal(state) : '';

  app.innerHTML = [
    '<div class="progress-strip">',
    '  <div class="progress-strip__bar">',
    '    <div class="progress-strip__fill" style="width: ' + progress + '%;"></div>',
    '  </div>',
    '  <div class="progress-strip__text">페이지 ' + (state.pageIndex + 1) + ' / ' + totalPages + '</div>',
    '</div>',
    mainMarkup,
    modalMarkup,
  ].join('');
}

function renderSectionPage(state, section, pageIndex) {
  const questionCount = countSectionQuestions(section);
  const answeredCount = countAnsweredQuestions(section, state.responses);
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
      subsection.questions.map(function(question) {
        return renderQuestionCard(state, question);
      }).join(''),
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
    '      <span class="save-hint">' + renderSaveHint(state.savedAt) + '</span>',
    '    </div>',
    '  </div>',
    subsectionMarkup,
    '  <div class="page-actions">',
    '    <div class="page-actions__hint">현재 응답 결과에만 사용되며, 별도 저장되지 않습니다.</div>',
    '    <div class="button-row">',
    '      <button class="btn btn--ghost" type="button" data-action="prev" ' + (pageIndex === 0 ? 'disabled' : '') + '>이전 페이지</button>',
    '      <button class="btn btn--primary" type="button" data-action="next">' + (pageIndex === state.sections.length - 1 ? '결과 보기' : '다음 페이지') + '</button>',
    '    </div>',
    '  </div>',
    '</section>',
  ].join('');
}

function renderQuestionCard(state, question) {
  const selected = state.responses[question.id];
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

function renderResultPage(state) {
  const summaries = state.sections.map(function(section) {
    const score = getSectionScore(section, state.responses);
    const questionCount = countSectionQuestions(section);
    const maxScore = questionCount * 5;
    const average = questionCount ? (score / questionCount).toFixed(2) : '0.00';
    const percent = maxScore ? Math.round((score / maxScore) * 100) : 0;
    const subsectionRows = section.subsections.map(function(subsection) {
      const subsectionScore = getSubsectionScore(subsection, state.responses);
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
      renderDonutChart(item.score, item.maxScore, item.percent),
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
    '      <h2 class="no-print">영역별 결과 보기</h2>',
    '      <h2 class="print-only">경남 교원 핵심역량 진단 결과</h2>',
    '      <p class="result-subtitle no-print">각 대영역의 합계를 파이차트로 시각화했습니다. 파란 영역은 현재 획득 점수, 회색 영역은 남은 최대 점수입니다.</p>',
    '      <p class="result-subtitle print-only">진단 일시: ' + renderDiagnosisDatetime(state.savedAt) + '</p>',
    '    </div>',
    '    <div class="section-meta no-print">',
    '      <span class="score-hint">총 응답 수</span>',
    '      <strong>' + Object.keys(state.responses).length + ' / ' + getAllQuestions(state.sections).length + '</strong>',
    '      <span class="save-hint">' + renderSaveHint(state.savedAt) + '</span>',
    '    </div>',
    '  </div>',
    '  <div class="result-grid">',
    summaryMarkup,
    '  </div>',
    '  <div class="result-footer">',
    '    <div class="button-row">',
    '      <button class="btn btn--ghost" type="button" data-action="prev">이전 페이지</button>',
    '      <button class="btn btn--primary" type="button" data-action="ai-analysis">AI결과 분석</button>',
    '      <button class="btn btn--ghost" type="button" data-action="print">인쇄 / PDF 저장</button>',
    '      <button class="btn btn--ghost" type="button" data-action="reset">응답 초기화</button>',
    '      <button class="btn btn--success" type="button" data-action="restart">처음으로 이동</button>',
    '    </div>',
    '  </div>',
    '</section>',
  ].join('');
}

function renderSaveHint(savedAt) {
  if (!savedAt) {
    return '저장 대기 중';
  }

  const savedDate = new Date(savedAt);
  if (Number.isNaN(savedDate.getTime())) {
    return '자동 저장됨';
  }

  const time = savedDate.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return time + ' 자동 저장';
}

function renderDonutChart(score, maxScore, percent) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const dash = (circumference * percent) / 100;
  const gap = circumference - dash;

  return [
    '<div class="chart" aria-label="점수 ' + score + ' / ' + maxScore + '">',
    '  <svg class="chart__svg" viewBox="0 0 120 120" aria-hidden="true">',
    '    <circle class="chart__track" cx="60" cy="60" r="46"></circle>',
    '    <circle class="chart__fill" cx="60" cy="60" r="46" stroke-dasharray="' + dash.toFixed(2) + ' ' + gap.toFixed(2) + '"></circle>',
    '  </svg>',
    '  <div class="chart__center">',
    '    <span class="chart__score">' + score + '</span>',
    '    <span class="chart__meta">/ ' + maxScore + '점</span>',
    '  </div>',
    '</div>',
  ].join('');
}

function renderDiagnosisDatetime(savedAt) {
  const base = savedAt ? new Date(savedAt) : new Date();
  const date = Number.isNaN(base.getTime()) ? new Date() : base;

  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderAiModal(state) {
  const promptText = buildAiPrompt(state);

  return [
    '<div class="modal-backdrop" data-action="close-modal"></div>',
    '<section class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">',
    '  <div class="modal-sheet__header">',
    '    <div>',
    '      <h3 id="ai-modal-title" class="modal-sheet__title">AI도구 활용 결과 분석</h3>',
    '      <p class="modal-sheet__subtext">아래 내용을 복사해서 AI 도구(ChatGPT, 제미나이 등)에 분석해보세요</p>',
    '    </div>',
    '    <div class="button-row">',
    '      <button class="btn btn--primary btn--compact" type="button" data-action="open-chatgpt">ChatGPT</button>',
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

export function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(function(element) {
    return !element.hasAttribute('disabled') && !element.getAttribute('aria-hidden');
  });
}
