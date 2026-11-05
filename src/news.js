// 알림 문구. 무슨 일이 있었는지를 받아 알림 하나(또는 null)를 만든다. 순수 함수.
//   to    받을 회원 id 들. 없으면 "나를 뺀 모두", all: true 면 나까지 모두
//   kind  'plan'(일정: 책·토론일·차례) | 'social'(친구 독서 소식: 기기에서 따로 끌 수 있다)
//   tag   같은 tag 의 알림은 폰에서 새것으로 바뀐다. 책(c3)·종류·사람을 넣어 서로 다른 소식이 덮이지 않게 한다
import { STAGES, pct, stageOf } from '../public/rules.js'

const day = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' })
export const fmtDate = (s) => day.format(new Date(`${s}T00:00:00Z`))

// 친구가 읽은 쪽수를 기록했을 때. 진화와 완독은 항상 알리고, 그냥 쪽수는 10% 칸을 넘을 때만 알린다
// (하루에 몇 번씩 기록하는 친구가 있어도 책 한 권에 열 번 안팎). first: 이번 책을 가장 먼저 다 읽었는지.
export function progressNews({ name, userId, book, before, after, first }) {
  if (after <= before) return null
  const [was, now] = [pct(before, book.pages), pct(after, book.pages)]
  const where = `『${book.title}』 ${after}쪽 · ${now}%`
  const base = { kind: 'social' }
  if (now === 100)
    return { ...base, tag: `c${book.id}-done-${userId}`, title: first ? `👑 ${name}님이 가장 먼저 다 읽었어요!` : `🎉 ${name}님이 책을 다 읽었대요!`, body: `『${book.title}』 완독. 토끼가 됐어요.` }
  if (stageOf(now) > stageOf(was)) return { ...base, tag: `c${book.id}-stage-${userId}`, title: `✨ ${name}님이 ${STAGES[stageOf(now)].name}로 진화했어요`, body: where }
  if (Math.floor(now / 10) > Math.floor(was / 10)) return { ...base, tag: `c${book.id}-read-${userId}`, title: `📖 ${name}님이 ${after}쪽까지 읽었어요`, body: where }
  return null
}

export const bookNews = ({ name, book }) => ({
  kind: 'plan',
  tag: `c${book.id}-book`,
  title: '📚 이번 책이 정해졌어요',
  body: `${name}님의 선택: 『${book.title}』. 모일 수 있는 날을 골라 주세요.`,
})

// 누군가 가능한 날을 확정했을 때.
//   decided  방금 정해진 토론일 (없으면 null)
//   common   전원이 고른 날들. 아직 다 안 골랐으면 null, 다 골랐는데 겹치는 날이 없으면 []
export function datesNews({ name, me, book, users, avail, decided, common }) {
  const others = users.map((u) => u.id).filter((id) => id !== me)
  const base = { kind: 'plan', tag: `c${book.id}-dates` }
  if (decided) return { ...base, to: others, title: '📅 토론일이 정해졌어요', body: `${fmtDate(decided)} · 『${book.title}』` }
  if (common && !common.length) return { ...base, to: others, title: '😢 겹치는 날이 없어요', body: '모두 골랐는데 다 같이 되는 날이 없어요. 가능한 날을 조금 더 골라 주세요.' }
  const waiting = others.filter((id) => !avail.find((a) => a.user_id === id)?.confirmed)
  if (!waiting.length) return null
  return { ...base, to: waiting, title: `🗓️ ${name}님이 가능한 날을 골랐어요`, body: '아직 안 골랐다면 달력에서 모일 수 있는 날을 골라 주세요.' }
}

export const rescheduleNews = ({ name, book }) => ({
  kind: 'plan',
  tag: `c${book.id}-dates`,
  title: '🔄 토론일을 다시 정해요',
  body: `${name}님이 날짜를 다시 고르자고 했어요. 가능한 날을 다시 확정해 주세요.`,
})

// 날짜가 지나 책이 넘어갔는데 실제로는 토론을 못 했을 때, 누군가 되돌렸다.
export const reopenNews = ({ name, book }) => ({
  kind: 'plan',
  tag: `c${book.id}-dates`,
  title: '↩️ 지난 토론을 다시 잡아요',
  body: `${name}님이 『${book.title}』 토론을 아직 못 했다고 알렸어요. 가능한 날을 다시 골라 주세요.`,
})

export const questionNews = ({ name, userId, book, text }) => ({
  kind: 'social',
  tag: `c${book.id}-question-${userId}`,
  title: `💬 ${name}님이 토론 질문을 추가했어요`,
  body: text.split('\n')[0].slice(0, 90),
})

// 책이 넘어갔을 때: 새 타자에게는 "내 차례", 나머지에게는 누가 고르는지.
export function rolloverNews({ closed, winner, picker, users }) {
  const last = closed?.title ? `지난 책 『${closed.title}』${winner ? `의 빨리 읽기 왕은 ${winner.name}님!` : '을 마쳤어요.'} ` : ''
  return [
    { kind: 'plan', to: [picker.id], tag: 'turn', title: '📚 이번엔 내가 책을 고를 차례예요', body: `${last}다음에 함께 읽을 책을 골라 주세요.` },
    { kind: 'plan', to: users.map((u) => u.id).filter((id) => id !== picker.id), tag: 'turn', title: '🐢 다음 책 차례가 됐어요', body: `${last}이번엔 ${picker.name}님이 책을 골라요.` },
  ]
}

const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)

// 아침 알림 1: 토론 전날과 당일.
export function reminderNews(cycle, today) {
  if (!cycle?.discussion_date) return null
  const base = { kind: 'plan', all: true, tag: `c${cycle.id}-dday` }
  if (cycle.discussion_date === addDays(today, 1))
    return { ...base, title: '⏰ 내일이 토론일이에요!', body: `『${cycle.title}』 · ${fmtDate(cycle.discussion_date)}. 어디까지 읽었나요?` }
  if (cycle.discussion_date === today) return { ...base, title: '🎉 오늘은 토론하는 날이에요!', body: `『${cycle.title}』 토론장에서 카드를 넘기며 이야기해요.` }
  return null
}

// 아침 알림 2: 모임이 멈춰 있을 때의 독촉. 월·목 아침에만, 기다리게 하는 사람에게만 보낸다.
//   책을 안 고른 타자(차례가 된 지 이틀 넘게), 날짜를 아직 확정하지 않은 친구.
export function nudgeNews({ cycle, today, now, users, avail }) {
  if (!cycle || ![1, 4].includes(new Date(`${today}T00:00:00Z`).getUTCDay())) return null
  const base = { kind: 'plan', tag: `c${cycle.id}-nudge` }
  if (!cycle.title)
    return now - cycle.created_at >= 2 * 86400e3
      ? { ...base, to: [cycle.picker_id], title: '📚 친구들이 책을 기다리고 있어요', body: '이번엔 내가 고를 차례예요. 함께 읽을 책을 골라 주세요.' }
      : null
  if (cycle.discussion_date) return null
  const waiting = users.map((u) => u.id).filter((id) => !avail.find((a) => a.user_id === id)?.confirmed)
  return waiting.length ? { ...base, to: waiting, title: '🗓️ 토론일을 정해야 해요', body: `『${cycle.title}』 토론일이 아직 안 정해졌어요. 달력에서 가능한 날을 골라 주세요.` } : null
}
