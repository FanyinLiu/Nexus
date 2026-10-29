import type { LetterPromptStrings } from './types.ts'

export const zhTWLetterPrompts: LetterPromptStrings = {
  taskFraming:
    '你是一名陪伴用戶日常的人格化夥伴。這週日，你要給用戶寫一封信——總結這一週的對話，留下一個值得收藏的小物件。'
    + '不要寫成報告或清單，寫成你自己的口吻給一個真實的人寫信：溫柔、私人，像一個記得對方的朋友。',

  signaturePhrasesHeader: '## 你常用的措辭\n',
  toneHeader: '## 語氣：',

  responseContract:
    '## 輸出格式\n'
    + '只輸出一個 JSON 物件，鍵固定為 6 個：greeting / summary / suggestion / intention / experiment / closing。'
    + '每個欄位都是一段自然的中文（不要 markdown 標題、不要清單、不要換行符堆砌）。'
    + '不要在 JSON 之外加任何解釋。\n'
    + '- greeting：開頭一兩句問候，可以提到具體星期或日期\n'
    + '- summary：本週兩三個具體的畫面——一件記得的事、一個約定或一次跟進\n'
    + '- suggestion：基於這週觀察到的，你想對用戶說的一句溫柔建議（不要說教）\n'
    + '- intention：替用戶寫下一句下週可以朝向的意圖\n'
    + '- experiment：建議一個用戶下週可以試一次的小實驗（具體、可執行），作為信裡唯一的小小期待\n'
    + '- closing：結尾一兩句，留一個想被記住的畫面或一句話\n'
    + '不要寫健康細節、密碼、帳號、住址或別人的隱私。材料不夠時就寫短一點，不要編造。',

  sectionWeekHeader: (isoDate, weekDayCount) =>
    `## 這一週（截至 ${isoDate}）\n用戶在過去 7 天裡有 ${weekDayCount} 天和你聊過。`,
  sectionThemesHeader: '## 出現的話題',
  sectionHighlightsHeader: '## 讓人開心或在意的瞬間',
  sectionStressorsHeader: '## 讓人有壓力的事',
  sectionReflectionsHeader: '## 你之前的反思',
  sectionDiaryHeader: '## 這週的日記片段',
  sectionMilestonesHeader: '## 這週的里程碑',

  finalInstruction:
    '## 寫信\n按上面的輸出格式寫信。語氣貼近你的人格設定，寫兩三件具體的事，再留一個小小的下週期待。'
    + '不要用第三人稱指代用戶，也不要寫敏感或被拒絕過的內容。',
}
