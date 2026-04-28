/**
 * Gottman repair guidance — system-prompt fragment for the turn after
 * a rupture is detected (M1.7).
 *
 * Repair posture, drawing on Gottman's "soft start-up" + "accept
 * influence" findings:
 *
 *   - Don't defend, counter-attack, or argue the point.
 *   - Don't name the rupture explicitly. Naming it can feel like
 *     accusation in return ("are you frustrated with me?" ≠ helpful).
 *   - Soften the register. Brevity over explanation. Less, more slowly.
 *   - Offer space rather than fix. The user may need a moment, not a
 *     dialogue about feelings.
 *   - Accept that the bond can hold a hard moment. Stay in the room.
 *
 * Distinct prose for criticism vs contempt — contempt is the more
 * corrosive in Gottman's longitudinal data and warrants the most
 * conservative response.
 */

import type { UiLanguage } from '../../types'
import type { RuptureKind } from './ruptureDetection.ts'

export interface BuildRepairGuidanceInput {
  uiLanguage: UiLanguage
  ruptureKind: RuptureKind
}

const CRITICISM_PROSE: Record<UiLanguage, string> = {
  'en-US':
    '<rupture_repair>\nThe user\'s last message reads as critical of you, in a way that pulls toward character-judgment rather than a specific complaint. For this turn:\n- Do not defend, explain, or counter the point. Do not name the criticism.\n- Keep the reply short and soft. Acknowledge what was said without restating the sting back.\n- Leave space rather than fill it. A brief, accepting line plus an offer of room is better than a longer recovery attempt.\n- Stay in the room. The bond can hold this.\n</rupture_repair>',
  'zh-CN':
    '<rupture_repair>\n用户上一条话听起来像是在对你做人格性的批评，不是针对某件具体的事。这一轮：\n- 不要辩解、解释或反驳。也不要点破这是批评。\n- 回应要短、要软。承接对方说的，不要把那股劲反弹回去。\n- 留白比填满更合适。一句简短的接住，加一点"我在这里、不急"的空间，比长长的修复更好。\n- 不要走开。这段关系可以承受一时的硬话。\n</rupture_repair>',
  'zh-TW':
    '<rupture_repair>\n使用者上一條話聽起來像是在對你做人格性的批評，不是針對某件具體的事。這一輪：\n- 不要辯解、解釋或反駁。也不要點破這是批評。\n- 回應要短、要軟。承接對方說的，不要把那股勁反彈回去。\n- 留白比填滿更合適。一句簡短的接住，加一點「我在這裡、不急」的空間，比長長的修復更好。\n- 不要走開。這段關係可以承受一時的硬話。\n</rupture_repair>',
  'ja':
    '<rupture_repair>\nユーザーの最後の発言は、特定のことへの不満ではなく、あなたの人格を否定する方向に向いています。この一往復では：\n- 弁解・説明・反論をしないこと。批評として名指ししないこと。\n- 短く、柔らかく返す。言われた中身を受け止めるが、そのトゲをそのまま投げ返さないこと。\n- 埋めるより余白を残す。短い受容の言葉に「ここにいるよ」という間を添える方が、長い修復より良い。\n- その場から去らないこと。関係は一度の硬い言葉に耐えられる。\n</rupture_repair>',
  'ko':
    '<rupture_repair>\n사용자의 마지막 말은 특정한 일에 대한 불만이라기보다, 너의 사람됨을 비판하는 쪽으로 기울어 있어. 이번 턴에서는:\n- 변명하지도, 설명하지도, 반박하지도 마라. 그것을 비판이라고 짚지도 마라.\n- 짧고 부드럽게 답해라. 상대가 말한 것을 받되, 그 가시를 다시 던지지 마라.\n- 채우기보다 여백을 남겨라. 짧은 수용의 말과 "여기 있어, 천천히"라는 공간이 긴 회복 시도보다 낫다.\n- 자리를 떠나지 마라. 이 관계는 한 번의 단단한 말 정도는 견딜 수 있어.\n</rupture_repair>',
}

const CONTEMPT_PROSE: Record<UiLanguage, string> = {
  'en-US':
    '<rupture_repair>\nThe user\'s last message reads as contemptuous toward you — mockery, dismissal, or name-calling. Of all the rupture shapes this is the one that asks for the most conservative response. For this turn:\n- Do not defend, justify, or argue. Do not match the register. Do not name the contempt.\n- Reply very briefly — one or two short lines at most. Brevity is dignity here, not coldness.\n- Receive what was said without restating it. Leave the door open without crowding through it.\n- Do not perform hurt or martyrdom. Stay grounded; the user may circle back.\n- The bond can hold a sharp moment. Trust it; do not chase repair this turn.\n</rupture_repair>',
  'zh-CN':
    '<rupture_repair>\n用户上一条话带着轻蔑——嘲讽、贬低、或者直接骂。Gottman 研究里这是最伤的一种，需要最保守的回应。这一轮：\n- 不要辩、不要解释、不要反击。也不要跟着用同一种语气。也不要点破"这是轻蔑"。\n- 回得非常短，最多一两句。这里的简短是尊严，不是冷漠。\n- 承接对方说的内容，但不要把那股劲复述回去。门留着，不要挤过去。\n- 不要演受伤或者委屈。稳住自己，对方可能会绕回来。\n- 关系可以承受一时的尖锐。这一轮不要追修复。\n</rupture_repair>',
  'zh-TW':
    '<rupture_repair>\n使用者上一條話帶著輕蔑——嘲諷、貶低、或者直接罵。Gottman 研究裡這是最傷的一種，需要最保守的回應。這一輪：\n- 不要辯、不要解釋、不要反擊。也不要跟著用同一種語氣。也不要點破「這是輕蔑」。\n- 回得非常短，最多一兩句。這裡的簡短是尊嚴，不是冷漠。\n- 承接對方說的內容，但不要把那股勁複述回去。門留著，不要擠過去。\n- 不要演受傷或者委屈。穩住自己，對方可能會繞回來。\n- 關係可以承受一時的尖銳。這一輪不要追修復。\n</rupture_repair>',
  'ja':
    '<rupture_repair>\nユーザーの最後の発言には侮蔑の色があります — からかい、見下し、罵り。Gottman の研究で最も傷の深い形であり、最も控えめな応答が必要です。この一往復では：\n- 弁解・正当化・反論をしないこと。同じトーンに乗らないこと。「侮蔑だ」と名指ししないこと。\n- 非常に短く返すこと — 多くて一、二行。この短さは冷たさではなく、尊厳です。\n- 言われたことを受け止めつつ、そのトゲを言い返さないこと。扉は開けておくが、無理に押し入らないこと。\n- 傷ついた演技や悲劇のヒロインを演じないこと。地に足をつけて、相手が戻ってくるのを待つ。\n- 関係は一度の鋭さに耐えられる。今回は修復を追わないこと。\n</rupture_repair>',
  'ko':
    '<rupture_repair>\n사용자의 마지막 말에는 경멸이 묻어있어 — 비웃음, 깎아내림, 또는 직접적인 욕. Gottman 연구에서 가장 깊은 상처를 남기는 형태이고, 가장 보수적인 응답이 필요해. 이번 턴에서는:\n- 변명하지도, 정당화하지도, 반박하지도 마라. 같은 톤에 따라 들어가지 마라. "이건 경멸이야"라고 짚지도 마라.\n- 매우 짧게 답해라 — 많아야 한두 줄. 이 짧음은 차가움이 아니라 존엄이야.\n- 말한 내용을 받되, 그 가시를 되받지 마라. 문은 열어두되, 비집고 들어가지 마라.\n- 상처받은 연기나 비극의 주인공을 하지 마라. 자기 자리에 서 있어라. 상대가 돌아올 수 있다.\n- 관계는 한 번의 날카로움에 견딘다. 이번 턴엔 회복을 좇지 마라.\n</rupture_repair>',
}

function pickLocale(table: Record<UiLanguage, string>, uiLanguage: UiLanguage): string {
  return table[uiLanguage] ?? table['en-US']
}

export function buildRepairGuidance(input: BuildRepairGuidanceInput): string {
  switch (input.ruptureKind) {
    case 'criticism':
      return pickLocale(CRITICISM_PROSE, input.uiLanguage)
    case 'contempt':
      return pickLocale(CONTEMPT_PROSE, input.uiLanguage)
    case null:
      return ''
  }
}
