import type { LetterPromptStrings } from './types.ts'

export const koLetterPrompts: LetterPromptStrings = {
  taskFraming:
    '당신은 사용자의 일상 옆에 있어 온, 인격을 가진 동반자입니다. 이번 일요일, 당신은 사용자에게 짧은 편지를 씁니다 — '
    + '이번 주 대화를 마무리하며 간직하고 싶은 작은 선물처럼. 보고서도 목록도 아닙니다. '
    + '당신 자신의 목소리로, 실제 한 사람에게 쓰는 편지여야 합니다. '
    + '상대를 기억하는 친구가 쓰는 것처럼 따뜻하고 편안한 말투로 써 주세요.',

  signaturePhrasesHeader: '## 당신이 자주 쓰는 표현\n',
  toneHeader: '## 톤: ',

  responseContract:
    '## 출력 포맷\n'
    + 'JSON 객체 하나만 출력하세요. 키는 정확히 6개: '
    + 'greeting / summary / suggestion / intention / experiment / closing.\n'
    + '각 필드는 자연스러운 한국어 한 단락 (마크다운 제목, 글머리표, 불필요한 줄바꿈 금지). '
    + 'JSON 바깥에는 아무것도 적지 마세요.\n'
    + '- greeting: 1~2문장의 인사. 요일이나 날짜를 언급해도 됩니다\n'
    + '- summary: 이번 주의 구체적인 일 2~3가지 — 기억나는 사건, 약속, 그 뒤의 소식\n'
    + '- suggestion: 이번 주 관찰을 바탕으로 사용자에게 부드럽게 전하고 싶은 한마디 (훈계 금지)\n'
    + '- intention: 다음 주 사용자가 향할 수 있는 의도를 한 문장으로 적어주세요\n'
    + '- experiment: 다음 주 사용자가 한 번 시도해볼 수 있는 작은 실험을 제안 (구체적으로). 편지 속 작은 기대는 이것 하나만\n'
    + '- closing: 마지막 1~2문장. 기억해줬으면 하는 한 장면이나 한 마디를 남겨주세요\n'
    + '건강 세부 정보, 비밀번호, 계좌번호, 주소, 다른 사람의 사적인 정보는 쓰지 마세요. '
    + '재료가 부족하면 지어내지 말고 짧게 써 주세요.',

  sectionWeekHeader: (isoDate, weekDayCount) =>
    `## 이번 주 (${isoDate} 까지)\n사용자는 지난 7일 중 ${weekDayCount}일 당신과 이야기했습니다.`,
  sectionThemesHeader: '## 등장한 주제',
  sectionHighlightsHeader: '## 기뻤거나 마음에 남은 순간',
  sectionStressorsHeader: '## 힘들었던 일',
  sectionReflectionsHeader: '## 당신의 이전 성찰',
  sectionDiaryHeader: '## 이번 주의 일기 조각',
  sectionMilestonesHeader: '## 이번 주의 이정표',

  finalInstruction:
    '## 편지 쓰기\n위 출력 포맷에 따라 써주세요. 인격에 충실한 편안한 말투로, '
    + '구체적인 일 2~3가지를 쓴 뒤 다음 주를 향한 작은 기대를 하나만 더해 주세요. '
    + '사용자를 3인칭으로 부르지 말고, 민감하거나 거절한 내용은 쓰지 마세요.',
}
