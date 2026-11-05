// 모임 규칙 (순수 함수). 서버(src/worker.js)와 화면(app.js)이 같이 쓴다.

export const STAGES = [
  { min: 0, name: '아기 거북이' },
  { min: 30, name: '병아리' },
  { min: 50, name: '고양이' },
  { min: 70, name: '강아지' },
  { min: 100, name: '토끼' },
]

// 내림이라서 마지막 쪽까지 읽어야만 100% 가 된다.
export const pct = (read, total) => (total > 0 ? Math.min(100, Math.floor((read / total) * 100)) : 0)

export const stageOf = (percent) => STAGES.findLastIndex((s) => percent >= s.min)

export function phaseOf(cycle, today) {
  if (!cycle.title) return 'picking'
  if (!cycle.discussion_date) return 'scheduling'
  if (today < cycle.discussion_date) return 'reading'
  return today === cycle.discussion_date ? 'dday' : 'over'
}

// en-CA 로케일은 YYYY-MM-DD 로 찍는다.
export const todayKST = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)

// 전원이 확정하기 전에는 null, 확정했으면 모두가 고른 미래 날짜(없으면 빈 배열).
export function unanimous(avail, memberIds, today) {
  const mine = memberIds.map((id) => avail.find((a) => a.user_id === id))
  if (!mine.every((a) => a?.confirmed)) return null
  const sets = mine.map((a) => new Set(a.dates))
  return [...sets[0]].filter((d) => d > today && sets.every((s) => s.has(d))).sort()
}

// 가장 먼저 완독한 사람 = 이번 책의 왕관 주인.
export function crownOf(progress) {
  const done = progress.filter((p) => p.finished_at != null)
  return done.length ? done.reduce((a, b) => (b.finished_at < a.finished_at ? b : a)).user_id : null
}

export function nextPicker(users, currentId) {
  const order = [...users].sort((a, b) => a.ord - b.ord)
  const i = order.findIndex((u) => u.id === currentId)
  return order[(i + 1) % order.length].id
}

// 명예의 전당: 우승(가장 빨리 읽은) 횟수, 완독 권수(모임 도서 + 개인 책).
export const fame = (users, cycles, progress, books) =>
  users.map((u) => ({
    user_id: u.id,
    wins: cycles.filter((c) => c.winner_id === u.id).length,
    read:
      progress.filter((p) => p.user_id === u.id && p.finished_at != null).length +
      books.filter((b) => b.user_id === u.id && b.finished_at != null).length,
  }))
