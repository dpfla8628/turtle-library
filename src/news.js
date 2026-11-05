// 알림 문구. 무슨 일이 있었는지를 받아 { to, title, body, tag } 를 만든다 (보낼 게 없으면 null). 순수 함수.
// to 가 없으면 "나를 뺀 모두"에게 보낸다. tag 가 같은 알림은 폰에서 새것으로 바뀐다.
import { STAGES, pct, stageOf } from '../public/rules.js'

const day = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' })
export const fmtDate = (s) => day.format(new Date(`${s}T00:00:00Z`))

// 친구가 읽은 쪽수를 기록했을 때. first: 이번 책을 가장 먼저 다 읽었는지.
export function progressNews({ name, book, before, after, first }) {
  if (after <= before) return null
  const percent = pct(after, book.pages)
  const stage = stageOf(percent)
  const where = `『${book.title}』 ${after}쪽 · ${percent}%`
  if (percent === 100)
    return { tag: 'progress', title: first ? `👑 ${name}님이 가장 먼저 다 읽었어요!` : `🎉 ${name}님이 책을 다 읽었대요!`, body: `『${book.title}』 완독. 토끼가 됐어요.` }
  if (stage > stageOf(pct(before, book.pages))) return { tag: 'progress', title: `✨ ${name}님이 ${STAGES[stage].name}로 진화했어요`, body: where }
  return { tag: 'progress', title: `📖 ${name}님이 ${after}쪽까지 읽었어요`, body: where }
}

export const bookNews = ({ name, book }) => ({
  tag: 'book',
  title: '📚 이번 책이 정해졌어요',
  body: `${name}님의 선택: 『${book.title}』. 모일 수 있는 날을 골라 주세요.`,
})

// 누군가 가능한 날을 확정했을 때. 토론일이 정해졌으면 모두에게, 아니면 아직 안 고른 친구에게만 알린다.
export function datesNews({ name, me, book, users, avail, decided }) {
  const others = users.map((u) => u.id).filter((id) => id !== me)
  if (decided) return { to: others, tag: 'dates', title: '📅 토론일이 정해졌어요', body: `${fmtDate(decided)} · 『${book.title}』` }
  const waiting = others.filter((id) => !avail.find((a) => a.user_id === id)?.confirmed)
  if (!waiting.length) return null
  return { to: waiting, tag: 'dates', title: `🗓️ ${name}님이 가능한 날을 골랐어요`, body: '아직 안 골랐다면 달력에서 모일 수 있는 날을 골라 주세요.' }
}

export const rescheduleNews = ({ name }) => ({
  tag: 'dates',
  title: '🔄 토론일을 다시 정해요',
  body: `${name}님이 날짜를 다시 고르자고 했어요. 가능한 날을 다시 확정해 주세요.`,
})

export const questionNews = ({ name, text }) => ({
  tag: 'question',
  title: `💬 ${name}님이 토론 질문을 추가했어요`,
  body: text.split('\n')[0].slice(0, 90),
})

// 책이 넘어갔을 때: 새 타자에게는 "내 차례", 나머지에게는 누가 고르는지.
export function rolloverNews({ closed, winner, picker, users }) {
  const last = closed?.title ? `지난 책 『${closed.title}』${winner ? `의 빨리 읽기 왕은 ${winner.name}님!` : '을 마쳤어요.'} ` : ''
  return [
    { to: [picker.id], tag: 'turn', title: '📚 이번엔 내가 책을 고를 차례예요', body: `${last}다음에 함께 읽을 책을 골라 주세요.` },
    { to: users.map((u) => u.id).filter((id) => id !== picker.id), tag: 'turn', title: '🐢 다음 책 차례가 됐어요', body: `${last}이번엔 ${picker.name}님이 책을 골라요.` },
  ]
}

// 하루 한 번(아침) 보내는 알림: 토론 전날과 당일.
export function reminderNews(cycle, today) {
  if (!cycle?.discussion_date) return null
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400e3).toISOString().slice(0, 10)
  if (cycle.discussion_date === tomorrow)
    return { all: true, tag: 'dday', title: '⏰ 내일이 토론일이에요!', body: `『${cycle.title}』 · ${fmtDate(cycle.discussion_date)}. 어디까지 읽었나요?` }
  if (cycle.discussion_date === today)
    return { all: true, tag: 'dday', title: '🎉 오늘은 토론하는 날이에요!', body: `『${cycle.title}』 토론장에서 카드를 넘기며 이야기해요.` }
  return null
}
