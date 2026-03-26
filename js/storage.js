export function hydrateState(state, storageKey, allQuestions) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return;
    }

    const saved = JSON.parse(raw);
    const validQuestionIds = new Set(allQuestions.map(function(question) {
      return question.id;
    }));

    state.responses = Object.entries(saved.responses || {}).reduce(function(acc, entry) {
      const key = entry[0];
      const value = Number(entry[1]);

      if (validQuestionIds.has(key) && value >= 1 && value <= 5) {
        acc[key] = value;
      }

      return acc;
    }, {});

    state.pageIndex = Number.isInteger(saved.pageIndex)
      ? Math.min(Math.max(saved.pageIndex, 0), state.sections.length)
      : 0;
    state.savedAt = saved.savedAt || null;
  } catch (_error) {
    state.responses = {};
    state.pageIndex = 0;
    state.savedAt = null;
  }
}

export function persistState(state, storageKey) {
  state.savedAt = new Date().toISOString();
  window.localStorage.setItem(storageKey, JSON.stringify({
    responses: state.responses,
    pageIndex: state.pageIndex,
    savedAt: state.savedAt,
  }));
}

export function clearSavedState(state, storageKey) {
  state.responses = {};
  state.pageIndex = 0;
  state.savedAt = null;
  state.aiModalOpen = false;
  window.localStorage.removeItem(storageKey);
}
