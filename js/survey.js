function normalizeContentLine(line) {
  return line.replace(/\u00a0/g, ' ').trim();
}

export function parseSurveyMarkdown(markdown) {
  const rawLines = markdown.split(/\r?\n/).map(normalizeContentLine);
  const title = (rawLines.find(Boolean) || '교원역량 행동지표').trim();
  const lines = rawLines.filter(Boolean);
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

    if (isSubsectionHeading(line)) {
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

    const questionMatch = line.match(/^[（(](.+?)[）)]\s*(.+)$/);
    if (questionMatch && currentSubsection) {
      currentSubsection.questions.push({
        id: 'q-' + questionId++,
        category: questionMatch[1].trim(),
        text: questionMatch[2].trim(),
      });
    }
  }

  return { title, sections };
}

function isSectionHeading(line) {
  return /^\s*[1-9１-９][0-9０-９]?(?:\\\.|[\.。])\s*/.test(line);
}

function isSubsectionHeading(line) {
  return /^\s*[①-⑳]\s*/.test(line);
}

function normalizeHeading(line) {
  return line
    .replace(/^\s*[1-9１-９][0-9０-９]?(?:\\\.|[\.。])\s*/, '')
    .replace(/^\s*[①-⑳]\s*/, '')
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

export function getAllQuestions(sections) {
  return sections.flatMap(function(section) {
    return section.subsections.flatMap(function(subsection) {
      return subsection.questions;
    });
  });
}

export function countSectionQuestions(section) {
  return section.subsections.reduce(function(sum, subsection) {
    return sum + subsection.questions.length;
  }, 0);
}

export function countAnsweredQuestions(section, responses) {
  return section.subsections.reduce(function(sum, subsection) {
    return sum + subsection.questions.filter(function(question) {
      return Boolean(responses[question.id]);
    }).length;
  }, 0);
}

export function getSectionScore(section, responses) {
  return section.subsections.reduce(function(sum, subsection) {
    return sum + getSubsectionScore(subsection, responses);
  }, 0);
}

export function getSubsectionScore(subsection, responses) {
  return subsection.questions.reduce(function(questionSum, question) {
    return questionSum + (responses[question.id] || 0);
  }, 0);
}

export function getUnansweredQuestions(section, responses) {
  return section.subsections.flatMap(function(subsection) {
    return subsection.questions;
  }).filter(function(question) {
    return !responses[question.id];
  });
}

export function buildAiPromptPayload(state) {
  const allQuestions = getAllQuestions(state.sections);
  const totalScore = allQuestions.reduce(function(sum, question) {
    return sum + (state.responses[question.id] || 0);
  }, 0);
  const overallAverage = allQuestions.length ? (totalScore / allQuestions.length).toFixed(2) : '0.00';

  const sectionLegend = [];
  const sectionSummary = [];
  const questionScores = [];

  state.sections.forEach(function(section, sectionIndex) {
    const sectionCode = 'S' + (sectionIndex + 1);
    const sectionQuestionCount = countSectionQuestions(section);
    const sectionScore = getSectionScore(section, state.responses);
    const sectionAverage = sectionQuestionCount ? (sectionScore / sectionQuestionCount).toFixed(2) : '0.00';

    sectionLegend.push(sectionCode + '=' + section.title + '|' + section.description);

    const subsectionSummary = section.subsections.map(function(subsection, subsectionIndex) {
      const subsectionCode = sectionCode + '-' + (subsectionIndex + 1);
      const subsectionScore = getSubsectionScore(subsection, state.responses);
      const subsectionAverage = subsection.questions.length
        ? (subsectionScore / subsection.questions.length).toFixed(2)
        : '0.00';
      const categories = Array.from(new Set(subsection.questions.map(function(question) {
        return question.category;
      }).filter(Boolean)));

      sectionLegend.push(subsectionCode + '=' + subsection.title + (categories.length ? '|' + categories.join(',') : ''));

      subsection.questions.forEach(function(question, questionIndex) {
        const questionCode = subsectionCode + '-' + (questionIndex + 1);
        const score = state.responses[question.id] || 0;
        questionScores.push(questionCode + '=' + score + '|' + question.text);
      });

      return subsectionCode + ':' + subsectionAverage + '(' + subsectionScore + '/' + subsection.questions.length + ')';
    }).join(' ; ');

    sectionSummary.push(sectionCode + ':' + sectionAverage + '(' + sectionScore + '/' + sectionQuestionCount + ') [' + subsectionSummary + ']');
  });

  return {
    allQuestions,
    totalScore,
    overallAverage,
    sectionLegend,
    sectionSummary,
    questionScores,
  };
}

export function buildAiPrompt(state) {
  const payload = buildAiPromptPayload(state);

  return [
    state.promptTemplate.trim(),
    '',
    '[데이터 규칙]',
    '- 점수는 1~5점: 1 매우 낮음, 3 보통, 5 매우 높음',
    '- 코드 체계: S영역-세부영역-문항번호',
    '- 범례와 점수를 함께 읽고 강점, 약점, 패턴을 해석할 것',
    '',
    '[전체 요약]',
    '- 문항수=' + payload.allQuestions.length + ', 총점=' + payload.totalScore + ', 평균=' + payload.overallAverage,
    '',
    '[영역/세부영역 범례]',
    payload.sectionLegend.join('\n'),
    '',
    '[영역별 결과]',
    payload.sectionSummary.join('\n'),
    '',
    '[문항별 점수]',
    payload.questionScores.join('\n'),
  ].join('\n');
}

export function getQuestionCountLabel(questionCount) {
  return questionCount + '개 문항';
}
