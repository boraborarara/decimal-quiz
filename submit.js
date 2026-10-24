/**
 * 소수 계산 퀴즈 챔피언 - 상태 관리 및 채점/제출 스크립트 (submit.js)
 * 
 * [교사용 안내]
 * - Google Apps Script 웹앱 URL (https://script.google.com/macros/s/.../exec)을
 *   아래 SUBMISSION_ENDPOINT 에 넣으면 학생들의 결과가 자동 전송됩니다.
 * - 주소가 빈 문자열('')인 경우 일체의 외부 네트워크 요청을 보내지 않습니다.
 * - 외부 전송을 사용할 경우 학교의 개인정보 처리 지침(수집 목적, 열람 권한, 보유 기간 및 폐기)을 사전에 확인하세요.
 */

const SUBMISSION_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwX04UKLkteclYNgIfl4XuAV89HNt45qw7opj1fC1JuI84j43jJTJajlgX3_-a93toRQw/exec';

(function (root) {
  'use strict';

  // 퀴즈 런타임 상태 (오직 메모리에만 유지되며 영구 저장되지 않음)
  const state = {
    classNumber: null,
    studentNumber: null,
    currentIndex: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    answers: [],           // [{ questionId, selectedIndex, isCorrect }]
    hasAnsweredCurrent: false,
    isSubmitted: false
  };

  /**
   * 반, 번호 입력값 유효성 검사 (1~99 사이의 정수만 허용)
   */
  function validateClassAndNumber(rawClass, rawNum) {
    const classStr = String(rawClass || '').trim();
    const numStr = String(rawNum || '').trim();

    if (!classStr) {
      return { valid: false, field: 'class', message: '반을 입력해 주세요! (1~99)' };
    }
    const classVal = Number(classStr);
    if (!Number.isInteger(classVal) || classVal < 1 || classVal > 99) {
      return { valid: false, field: 'class', message: '반은 1부터 99까지의 숫자로 적어 주세요.' };
    }

    if (!numStr) {
      return { valid: false, field: 'num', message: '번호를 입력해 주세요! (1~99)' };
    }
    const numVal = Number(numStr);
    if (!Number.isInteger(numVal) || numVal < 1 || numVal > 99) {
      return { valid: false, field: 'num', message: '번호는 1부터 99까지의 숫자로 적어 주세요.' };
    }

    return { valid: true, classNumber: classVal, studentNumber: numVal };
  }

  /**
   * 누적 정답 수에 따른 레벨 계산
   * 0~2개: Lv.1, 3~5개: Lv.2, 6~8개: Lv.3, 9개 이상: Lv.4
   */
  function calculateLevel(correctCount) {
    if (correctCount >= 9) return 4;
    if (correctCount >= 6) return 3;
    if (correctCount >= 3) return 2;
    return 1;
  }

  /**
   * 정답률에 따른 챔피언 등급 계산
   * 0~39% 도전자, 40~59% 성장 중, 60~79% 실버, 80~99% 골드, 100% 챔피언
   */
  function calculateGrade(accuracy) {
    if (accuracy === 100) return '챔피언';
    if (accuracy >= 80) return '골드';
    if (accuracy >= 60) return '실버';
    if (accuracy >= 40) return '성장 중';
    return '도전자';
  }

  /**
   * 퀴즈 시작 초기화
   */
  function startQuiz(classNumber, studentNumber) {
    state.classNumber = classNumber;
    state.studentNumber = studentNumber;
    state.currentIndex = 0;
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.answers = [];
    state.hasAnsweredCurrent = false;
    state.isSubmitted = false;
  }

  /**
   * 현재 문제 답변 처리 및 점수/콤보 계산
   */
  function submitAnswer(selectedIndex) {
    const questions = (root.QUIZ_DATA && root.QUIZ_DATA.questions) || [];
    const currentQ = questions[state.currentIndex];
    if (!currentQ || state.hasAnsweredCurrent) {
      return null; // 중복 클릭 차단 또는 문항 없음
    }

    state.hasAnsweredCurrent = true;
    const isCorrect = selectedIndex === currentQ.answer;
    let earnedScore = 0;
    let bonusScore = 0;

    if (isCorrect) {
      state.combo += 1;
      if (state.combo > state.maxCombo) {
        state.maxCombo = state.combo;
      }
      // 기본 100점 + 2연속부터 min(콤보, 5) * 20점 보너스
      bonusScore = state.combo >= 2 ? Math.min(state.combo, 5) * 20 : 0;
      earnedScore = 100 + bonusScore;
      state.score += earnedScore;
    } else {
      state.combo = 0;
    }

    const answerRecord = {
      questionId: currentQ.id,
      selectedIndex: selectedIndex,
      isCorrect: isCorrect
    };
    state.answers.push(answerRecord);

    const correctCount = state.answers.filter(a => a.isCorrect).length;
    const currentLevel = calculateLevel(correctCount);

    return {
      isCorrect: isCorrect,
      selectedIndex: selectedIndex,
      correctIndex: currentQ.answer,
      earnedScore: earnedScore,
      bonusScore: bonusScore,
      combo: state.combo,
      totalScore: state.score,
      level: currentLevel,
      explanation: currentQ.explanation,
      hint: currentQ.hint || '',
      question: currentQ
    };
  }

  /**
   * 다음 문제로 이동 준비
   */
  function nextQuestion() {
    const questions = (root.QUIZ_DATA && root.QUIZ_DATA.questions) || [];
    state.currentIndex += 1;
    state.hasAnsweredCurrent = false;

    if (state.currentIndex >= questions.length) {
      return { isFinished: true, results: getResultsSummary() };
    }
    return {
      isFinished: false,
      question: questions[state.currentIndex],
      questionNumber: state.currentIndex + 1,
      totalQuestions: questions.length
    };
  }

  /**
   * 결과 집계 요약 생성
   */
  function getResultsSummary() {
    const questions = (root.QUIZ_DATA && root.QUIZ_DATA.questions) || [];
    const totalQuestions = questions.length;
    const correctCount = state.answers.filter(a => a.isCorrect).length;
    const accuracy = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const grade = calculateGrade(accuracy);
    const level = calculateLevel(correctCount);

    return {
      quizTitle: (root.QUIZ_DATA && root.QUIZ_DATA.title) || '소수 계산 퀴즈 챔피언',
      classNumber: state.classNumber,
      studentNumber: state.studentNumber,
      score: state.score,
      correctCount: correctCount,
      totalQuestions: totalQuestions,
      accuracy: accuracy,
      maxCombo: state.maxCombo,
      grade: grade,
      level: level,
      answers: state.answers.slice()
    };
  }

  /**
   * AGENTS.md 7장 규격과 정확히 일치하는 제출 페이로드 생성
   * 반·번호가 유효하지 않으면 생성을 차단함
   */
  function buildSubmissionPayload() {
    if (!state.classNumber || !state.studentNumber) {
      return null;
    }
    const summary = getResultsSummary();
    return {
      quizTitle: summary.quizTitle,
      classNumber: summary.classNumber,
      studentNumber: summary.studentNumber,
      score: summary.score,
      correctCount: summary.correctCount,
      totalQuestions: summary.totalQuestions,
      accuracy: summary.accuracy,
      maxCombo: summary.maxCombo,
      grade: summary.grade,
      answers: summary.answers
    };
  }

  /**
   * 선택적 외부 전송 (Google Apps Script)
   */
  function sendSubmissionIfConfigured(onStatusUpdate) {
    if (!SUBMISSION_ENDPOINT || typeof SUBMISSION_ENDPOINT !== 'string' || !SUBMISSION_ENDPOINT.trim()) {
      // 엔드포인트가 비어 있으면 전송하지 않음
      if (typeof onStatusUpdate === 'function') {
        onStatusUpdate('none');
      }
      return Promise.resolve({ sent: false, reason: 'empty_endpoint' });
    }

    if (state.isSubmitted) {
      return Promise.resolve({ sent: false, reason: 'already_submitted' });
    }

    const payload = buildSubmissionPayload();
    if (!payload) {
      if (typeof onStatusUpdate === 'function') {
        onStatusUpdate('error');
      }
      return Promise.resolve({ sent: false, reason: 'invalid_payload' });
    }

    state.isSubmitted = true;
    if (typeof onStatusUpdate === 'function') {
      onStatusUpdate('sending'); // 기록 중...
    }

    return fetch(SUBMISSION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Network error: ' + response.status);
        }
        return response.json();
      })
      .then(data => {
        if (data && data.ok === true) {
          if (typeof onStatusUpdate === 'function') {
            onStatusUpdate('success'); // 기록 완료
          }
          return { sent: true, success: true };
        } else {
          throw new Error('Server returned false');
        }
      })
      .catch(err => {
        if (typeof onStatusUpdate === 'function') {
          onStatusUpdate('error'); // 기록하지 못했어요. 선생님께 알려 주세요
        }
        return { sent: true, success: false, error: err };
      });
  }

  /**
   * 오답 복습용 데이터 추출
   */
  function getIncorrectQuestions() {
    const questions = (root.QUIZ_DATA && root.QUIZ_DATA.questions) || [];
    const questionMap = {};
    questions.forEach(q => { questionMap[q.id] = q; });

    return state.answers
      .filter(a => !a.isCorrect)
      .map(a => {
        const q = questionMap[a.questionId];
        return {
          question: q,
          selectedIndex: a.selectedIndex,
          selectedText: q ? q.options[a.selectedIndex] : '',
          correctIndex: q ? q.answer : null,
          correctText: q ? q.options[q.answer] : '',
          explanation: q ? q.explanation : ''
        };
      });
  }

  /**
   * 전체 초기화 (처음부터 다시 하기)
   */
  function resetAll() {
    state.classNumber = null;
    state.studentNumber = null;
    state.currentIndex = 0;
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.answers = [];
    state.hasAnsweredCurrent = false;
    state.isSubmitted = false;
  }

  // 외부 노출 객체
  const QuizEngine = {
    getState: function () {
      return {
        classNumber: state.classNumber,
        studentNumber: state.studentNumber,
        currentIndex: state.currentIndex,
        score: state.score,
        combo: state.combo,
        maxCombo: state.maxCombo,
        hasAnsweredCurrent: state.hasAnsweredCurrent,
        isSubmitted: state.isSubmitted
      };
    },
    validateClassAndNumber: validateClassAndNumber,
    calculateLevel: calculateLevel,
    calculateGrade: calculateGrade,
    startQuiz: startQuiz,
    submitAnswer: submitAnswer,
    nextQuestion: nextQuestion,
    getResultsSummary: getResultsSummary,
    buildSubmissionPayload: buildSubmissionPayload,
    sendSubmissionIfConfigured: sendSubmissionIfConfigured,
    getIncorrectQuestions: getIncorrectQuestions,
    resetAll: resetAll,
    getEndpoint: function () { return SUBMISSION_ENDPOINT; }
  };

  root.QuizEngine = QuizEngine;

  // Node.js 환경 테스트 호환용
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuizEngine;
  }
})(typeof window !== 'undefined' ? window : global);
