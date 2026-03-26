import {
  buildAiPrompt,
  getAllQuestions,
  getQuestionCountLabel,
  getUnansweredQuestions,
  parseSurveyMarkdown,
} from './js/survey.js';
import {
  clearSavedState,
  hydrateState,
  persistState,
} from './js/storage.js';
import {
  getFocusableElements,
  renderApp,
} from './js/render.js';

const app = document.getElementById('app');
const questionCountChip = document.getElementById('question-count-chip');
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

let lastFocusedElement = null;

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

    hydrateState(STATE, STORAGE_KEY, getAllQuestions(STATE.sections));
    updateQuestionCountChip();
    document.title = STATE.title + ' 설문';
    render();
  } catch (error) {
    app.innerHTML = '<div class="error-state">' + escapeHtml(error.message) + '</div>';
    if (questionCountChip) {
      questionCountChip.textContent = '문항 수 확인 필요';
    }
  }
}

function render() {
  renderApp(app, STATE);
  bindEvents();
  syncModalAccessibility();
}

function bindEvents() {
  app.querySelectorAll('input[type="radio"]').forEach(function(input) {
    input.addEventListener('change', handleAnswerChange);
  });

  app.querySelectorAll('[data-action]').forEach(function(button) {
    button.addEventListener('click', handleAction);
  });
}

function handleAnswerChange(event) {
  const questionId = event.target.dataset.questionId;
  const value = Number(event.target.value);

  STATE.responses[questionId] = value;
  persistState(STATE, STORAGE_KEY);
  render();
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;

  if (action === 'prev') {
    STATE.pageIndex = Math.max(0, STATE.pageIndex - 1);
    persistState(STATE, STORAGE_KEY);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (action === 'next') {
    const currentSection = STATE.sections[STATE.pageIndex];
    const unanswered = getUnansweredQuestions(currentSection, STATE.responses);

    if (unanswered.length) {
      window.alert('현재 페이지에 미응답 문항이 ' + unanswered.length + '개 있습니다. 모두 응답한 뒤 다음으로 이동해 주세요.');
      return;
    }

    STATE.pageIndex = Math.min(STATE.sections.length, STATE.pageIndex + 1);
    persistState(STATE, STORAGE_KEY);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (action === 'restart') {
    STATE.pageIndex = 0;
    persistState(STATE, STORAGE_KEY);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (action === 'ai-analysis') {
    lastFocusedElement = event.currentTarget;
    STATE.aiModalOpen = true;
    render();
    return;
  }

  if (action === 'close-modal') {
    closeModal();
    return;
  }

  if (action === 'copy-ai-prompt') {
    copyAiPrompt();
    return;
  }

  if (action === 'open-chatgpt') {
    openChatGptPrompt();
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

    clearSavedState(STATE, STORAGE_KEY);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function closeModal() {
  STATE.aiModalOpen = false;
  render();

  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
}

function copyAiPrompt() {
  const promptText = buildAiPrompt(STATE);

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

function openChatGptPrompt() {
  const openedWindow = window.open('https://chatgpt.com', '_blank', 'noopener,noreferrer');
  if (!openedWindow) {
    window.alert('새 창을 열지 못했습니다. 브라우저 팝업 차단 설정을 확인해 주세요.');
  }
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

function syncModalAccessibility() {
  document.removeEventListener('keydown', handleDocumentKeydown);

  if (!STATE.aiModalOpen) {
    return;
  }

  const modal = app.querySelector('.modal-sheet');
  if (!modal) {
    return;
  }

  document.addEventListener('keydown', handleDocumentKeydown);

  const focusableElements = getFocusableElements(modal);
  const firstFocusable = focusableElements[0];

  if (firstFocusable) {
    firstFocusable.focus();
  } else {
    modal.setAttribute('tabindex', '-1');
    modal.focus();
  }

  const modalPrompt = modal.querySelector('.modal-prompt');
  if (modalPrompt) {
    modalPrompt.scrollTop = 0;
  }
}

function handleDocumentKeydown(event) {
  if (!STATE.aiModalOpen) {
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal();
    return;
  }

  if (event.key !== 'Tab') {
    return;
  }

  const modal = app.querySelector('.modal-sheet');
  if (!modal) {
    return;
  }

  const focusableElements = getFocusableElements(modal);
  if (!focusableElements.length) {
    event.preventDefault();
    modal.focus();
    return;
  }

  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstFocusable) {
    event.preventDefault();
    lastFocusable.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === lastFocusable) {
    event.preventDefault();
    firstFocusable.focus();
  }
}

function updateQuestionCountChip() {
  if (!questionCountChip) {
    return;
  }

  questionCountChip.textContent = getQuestionCountLabel(getAllQuestions(STATE.sections).length);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
