// 독서토론 앱 API. 정적 파일(public/)은 Cloudflare 가 직접 내보내고, 여기는 /api/* 만 맡는다.
import { todayKST, unanimous, crownOf, nextPicker } from '../public/rules.js'
import { buildDeck, drawCard } from './deck.js'
import { hashPassword, verifyPassword, newToken, sha256 } from './auth.js'

const COLORS = ['peach', 'mint', 'sky', 'lemon', 'lilac', 'rose']
const GENRES = ['fiction', 'nonfiction', 'essay']
const KINDS = ['review', 'memo', 'quote']
const SESSION_MS = 90 * 86400e3
const MAX_FAILS = 10
const LOCK_MS = 10 * 60e3

class Oops extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })

const cookie = (value, maxAgeMs, secure) =>
  `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`

// ---- 입력 검증 ----
function text(v, max, what) {
  const s = String(v ?? '').trim()
  if (!s) throw new Oops(400, `${what}: 내용을 적어 주세요`)
  if (s.length > max) throw new Oops(400, `${what}: ${max}자까지 쓸 수 있어요`)
  return s
}
const optText = (v, max) => String(v ?? '').trim().slice(0, max) || null
function int(v, min, max, what) {
  const n = Number(v)
  if (v === '' || v == null || !Number.isInteger(n) || n < min || n > max)
    throw new Oops(400, `${what}: ${min}~${max} 사이 숫자로 적어 주세요`)
  return n
}
const optInt = (v, min, max, what) => (v === '' || v == null ? null : int(v, min, max, what))

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    try {
      if (!url.pathname.startsWith('/api/')) throw new Oops(404, '없는 주소예요')
      return await api(req, env, url)
    } catch (e) {
      if (e instanceof Oops) return json({ error: e.message }, e.status)
      console.error(e)
      return json({ error: '서버에서 문제가 생겼어요. 잠시 뒤에 다시 해 주세요' }, 500)
    }
  },
}

async function api(req, env, url) {
  const db = env.DB
  const now = Date.now()
  const today = todayKST(new Date(now))
  const path = url.pathname.slice('/api/'.length)
  const secure = url.protocol === 'https:'

  let body = {}
  if (req.method === 'POST') {
    // 쿠키로 인증하므로 다른 사이트가 대신 보낸 요청은 막는다 (CSRF).
    const origin = req.headers.get('origin')
    if (origin && origin !== url.origin) throw new Oops(403, '허용되지 않은 요청이에요')
    body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw new Oops(400, '잘못된 요청이에요')
  } else if (req.method !== 'GET') throw new Oops(405, '지원하지 않는 방식이에요')

  if (req.method === 'POST' && path === 'login') {
    const token = await login(db, body, now)
    return json({ ok: true }, 200, { 'set-cookie': cookie(token, SESSION_MS, secure) })
  }

  const me = await auth(req, db, now)

  if (req.method === 'POST' && path === 'logout') {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(me.token_hash).run()
    return json({ ok: true }, 200, { 'set-cookie': cookie('', 0, secure) })
  }

  await rollover(db, now, today)

  if (req.method === 'POST') {
    const handler = Object.hasOwn(POST, path) && POST[path]
    if (!handler) throw new Oops(404, '없는 주소예요')
    const cur = await db.prepare('SELECT * FROM cycles WHERE closed = 0').first()
    await handler({ db, me, body, now, today, cur })
  } else if (path !== 'state') throw new Oops(404, '없는 주소예요')

  // 모든 요청은 최신 전체 상태로 답한다. 화면은 받은 걸 그대로 다시 그린다.
  return json(await state(db, me, today))
}

// ---- 로그인 ----
async function login(db, body, now) {
  const username = String(body.username ?? '').trim().toLowerCase()
  const u = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first()
  const bad = new Oops(401, '아이디나 비밀번호가 맞지 않아요')
  if (!u) throw bad
  if (u.locked_until > now) throw new Oops(429, '여러 번 틀려서 잠시 잠겼어요. 10분 뒤에 다시 해 주세요')
  if (!(await verifyPassword(String(body.password ?? ''), u.pw_hash))) {
    const fails = u.fails + 1
    const lock = fails >= MAX_FAILS
    await db
      .prepare('UPDATE users SET fails = ?, locked_until = ? WHERE id = ?')
      .bind(lock ? 0 : fails, lock ? now + LOCK_MS : 0, u.id)
      .run()
    throw bad
  }
  const token = newToken()
  await db.batch([
    db.prepare('UPDATE users SET fails = 0, locked_until = 0 WHERE id = ?').bind(u.id),
    db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
    db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)')
      .bind(await sha256(token), u.id, now + SESSION_MS),
  ])
  return token
}

async function auth(req, db, now) {
  const sid = req.headers.get('cookie')?.match(/(?:^|;\s*)sid=([0-9a-f]{64})/)?.[1]
  const token_hash = sid && (await sha256(sid))
  const me =
    token_hash &&
    (await db
      .prepare(
        'SELECT u.id, u.username, u.pw_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?',
      )
      .bind(token_hash, now)
      .first())
  if (!me) throw new Oops(401, '로그인이 필요해요')
  return { ...me, token_hash }
}

// ---- 사이클 넘기기 ----
// 토론 다음 날이 되면 이번 책을 마감하고(우승자 기록) 다음 타자의 새 사이클을 연다.
// ponytail: 크론 없이 누군가 접속할 때 처리한다. 아무도 안 들어오면 넘어가지 않지만, 그땐 볼 사람도 없다.
async function rollover(db, now, today) {
  const cur = await db.prepare('SELECT * FROM cycles WHERE closed = 0').first()
  if (cur && !(cur.discussion_date && cur.discussion_date < today)) return
  if (cur) {
    const { results } = await db.prepare('SELECT user_id, finished_at FROM progress WHERE cycle_id = ?').bind(cur.id).all()
    const done = await db
      .prepare('UPDATE cycles SET closed = 1, winner_id = ? WHERE id = ? AND closed = 0')
      .bind(crownOf(results), cur.id)
      .run()
    if (!done.meta.changes) return // 동시에 들어온 다른 요청이 이미 마감했다
  }
  const { results: users } = await db.prepare('SELECT id, ord FROM users').all()
  // 열린 사이클은 유니크 인덱스로 하나만 허용되므로, 경쟁에서 진 쪽은 조용히 무시된다.
  await db
    .prepare('INSERT OR IGNORE INTO cycles (picker_id, created_at) VALUES (?, ?)')
    .bind(nextPicker(users, cur?.picker_id ?? null), now)
    .run()
}

// ---- 전체 상태 ----
// ponytail: 모임 전체 데이터를 한 번에 내려준다(3명 × 한 달 한 권이면 수십 KB).
// 느려지면 지난 사이클의 메모·질문을 따로 불러오게 쪼갤 것.
async function state(db, me, today) {
  const q = (sql) => db.prepare(sql)
  const [users, cycles, avail, progress, questions, notes, books] = (
    await db.batch([
      q('SELECT id, name, color, ord FROM users ORDER BY ord'),
      q('SELECT * FROM cycles ORDER BY id'),
      q('SELECT a.* FROM availability a JOIN cycles c ON c.id = a.cycle_id WHERE c.closed = 0'),
      q('SELECT * FROM progress'),
      q('SELECT * FROM questions ORDER BY sec, id'),
      q('SELECT * FROM notes ORDER BY id'),
      q('SELECT * FROM books ORDER BY id'),
    ])
  ).map((r) => r.results)
  return {
    me: { id: me.id, username: me.username },
    today,
    users,
    cycles,
    avail: avail.map((a) => ({ ...a, dates: JSON.parse(a.dates) })),
    progress,
    questions,
    notes,
    books,
  }
}

const needBook = (cur) => {
  if (!cur?.title) throw new Oops(409, '아직 이번 책이 정해지지 않았어요')
}

// ---- 변경 요청 ----
const POST = {
  // 이번 타자가 책을 등록(또는 수정)한다.
  async book({ db, me, body, now, cur }) {
    if (cur.picker_id !== me.id) throw new Oops(403, '이번 책은 다른 친구가 고를 차례예요')
    const title = text(body.title, 100, '책 제목')
    const pages = int(body.pages, 1, 5000, '전체 쪽수')
    const genre = GENRES.includes(body.genre) ? body.genre : 'fiction'
    const stmts = [
      db
        .prepare('UPDATE cycles SET title = ?, author = ?, pages = ?, genre = ? WHERE id = ?')
        .bind(title, optText(body.author, 60), pages, genre, cur.id),
      // 쪽수를 고쳤다면 이미 기록된 진행도를 새 쪽수에 맞춘다.
      db
        .prepare(
          `UPDATE progress SET pages_read = MIN(pages_read, ?1),
             finished_at = CASE WHEN MIN(pages_read, ?1) >= ?1 THEN COALESCE(finished_at, ?2) ELSE NULL END
           WHERE cycle_id = ?3`,
        )
        .bind(pages, now, cur.id),
    ]
    if (!cur.title)
      for (const c of buildDeck(genre))
        stmts.push(
          db.prepare('INSERT INTO questions (cycle_id, sec, cat, body) VALUES (?, ?, ?, ?)').bind(cur.id, c.sec, c.cat, c.body),
        )
    await db.batch(stmts)
  },

  // 가능한 날짜를 저장한다. 전원이 확정했고 겹치는 날이 있으면 그중 하루를 뽑아 토론일로 정한다.
  async dates({ db, me, body, today, cur }) {
    needBook(cur)
    if (cur.discussion_date) throw new Oops(409, '토론일이 이미 정해졌어요')
    const ok = Array.isArray(body.dates) && body.dates.length <= 120 && body.dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    if (!ok) throw new Oops(400, '날짜 형식이 올바르지 않아요')
    const dates = [...new Set(body.dates)].sort()
    const confirmed = body.confirmed ? 1 : 0
    if (confirmed && !dates.some((d) => d > today)) throw new Oops(400, '가능한 날짜를 하루 이상 골라 주세요')
    await db
      .prepare(
        `INSERT INTO availability (cycle_id, user_id, dates, confirmed) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (cycle_id, user_id) DO UPDATE SET dates = ?3, confirmed = ?4`,
      )
      .bind(cur.id, me.id, JSON.stringify(dates), confirmed)
      .run()

    const [users, avail] = (
      await db.batch([
        db.prepare('SELECT id FROM users'),
        db.prepare('SELECT * FROM availability WHERE cycle_id = ?').bind(cur.id),
      ])
    ).map((r) => r.results)
    const common = unanimous(
      avail.map((a) => ({ ...a, dates: JSON.parse(a.dates) })),
      users.map((u) => u.id),
      today,
    )
    if (common?.length)
      await db
        .prepare('UPDATE cycles SET discussion_date = ? WHERE id = ? AND discussion_date IS NULL')
        .bind(common[Math.floor(Math.random() * common.length)], cur.id)
        .run()
  },

  // 정해진 토론일을 취소하고 다시 고른다. 골라 둔 날짜는 남기고 확정만 푼다.
  async reschedule({ db, cur }) {
    await db.batch([
      db.prepare('UPDATE cycles SET discussion_date = NULL WHERE id = ?').bind(cur.id),
      db.prepare('UPDATE availability SET confirmed = 0 WHERE cycle_id = ?').bind(cur.id),
    ])
  },

  // 모임 도서를 어디까지 읽었는지. 지난 모임 책도 서재에서 이어서 기록할 수 있다(우승자는 안 바뀐다).
  async progress({ db, me, body, now, cur }) {
    const cycle =
      body.cycle_id == null
        ? cur
        : await db.prepare('SELECT * FROM cycles WHERE id = ?').bind(int(body.cycle_id, 1, 1e9, '책')).first()
    needBook(cycle)
    const pages = int(body.pages, 0, cycle.pages, '읽은 쪽수')
    await db
      .prepare(
        `INSERT INTO progress (cycle_id, user_id, pages_read, finished_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (cycle_id, user_id) DO UPDATE SET pages_read = ?3,
           finished_at = CASE WHEN ?4 IS NULL THEN NULL ELSE COALESCE(progress.finished_at, ?4) END`,
      )
      .bind(cycle.id, me.id, pages, pages >= cycle.pages ? now : null)
      .run()
  },

  async question({ db, me, body, cur }) {
    needBook(cur)
    await db
      .prepare("INSERT INTO questions (cycle_id, user_id, sec, cat, body) VALUES (?, ?, 1, '우리의 질문', ?)")
      .bind(cur.id, me.id, text(body.body, 300, '질문'))
      .run()
  },

  // 기본 카드는 책에 안 맞으면 누구나 뺄 수 있고, 친구가 쓴 카드는 쓴 사람만 지운다.
  async 'question/delete'({ db, me, body, cur }) {
    await db
      .prepare('DELETE FROM questions WHERE id = ? AND cycle_id = ? AND (user_id IS NULL OR user_id = ?)')
      .bind(int(body.id, 1, 1e9, '질문'), cur.id, me.id)
      .run()
  },

  async 'question/draw'({ db, cur }) {
    needBook(cur)
    const { results } = await db.prepare('SELECT body FROM questions WHERE cycle_id = ?').bind(cur.id).all()
    const card = drawCard(cur.genre, new Set(results.map((r) => r.body)))
    if (!card) throw new Oops(409, '준비된 질문 카드를 모두 뽑았어요. 직접 질문을 추가해 보세요')
    await db
      .prepare('INSERT INTO questions (cycle_id, sec, cat, body) VALUES (?, 1, ?, ?)')
      .bind(cur.id, card.cat, card.body)
      .run()
  },

  // 한줄평 · 메모 · 구절을 쓰거나(id 없음) 고친다(id 있음).
  async note({ db, me, body, now }) {
    if (!KINDS.includes(body.kind)) throw new Oops(400, '메모 종류가 올바르지 않아요')
    const kind = body.kind
    const content = text(body.body, kind === 'review' ? 200 : 5000, kind === 'review' ? '한줄평' : '내용')
    const rating = kind === 'review' ? optInt(body.rating, 1, 5, '별점') : null
    let page = optInt(body.page, 1, 5000, '쪽수')

    if (body.id != null) {
      const done = await db
        .prepare('UPDATE notes SET body = ?, page = COALESCE(?, page), rating = ? WHERE id = ? AND user_id = ?')
        .bind(content, page, rating, int(body.id, 1, 1e9, '메모'), me.id)
        .run()
      if (!done.meta.changes) throw new Oops(404, '고칠 메모를 찾지 못했어요')
      return
    }

    let cycle_id = null
    let book_id = null
    if (body.cycle_id != null) {
      cycle_id = int(body.cycle_id, 1, 1e9, '책')
      const row = await db
        .prepare(
          'SELECT c.title, p.pages_read FROM cycles c LEFT JOIN progress p ON p.cycle_id = c.id AND p.user_id = ? WHERE c.id = ?',
        )
        .bind(me.id, cycle_id)
        .first()
      needBook(row)
      // 쪽수를 안 적으면 지금 읽고 있는 쪽으로 남긴다. 덜 읽은 친구에게는 이 쪽수 기준으로 가려진다.
      page ??= row.pages_read || null
    } else {
      book_id = int(body.book_id, 1, 1e9, '책')
      const mine = await db.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?').bind(book_id, me.id).first()
      if (!mine) throw new Oops(404, '내 서재에 없는 책이에요')
    }

    const stmts = []
    if (kind === 'review')
      // 한줄평은 책마다 하나. 새로 쓰면 예전 것을 바꾼다.
      stmts.push(
        db
          .prepare("DELETE FROM notes WHERE user_id = ? AND kind = 'review' AND cycle_id IS ? AND book_id IS ?")
          .bind(me.id, cycle_id, book_id),
      )
    stmts.push(
      db
        .prepare('INSERT INTO notes (user_id, cycle_id, book_id, kind, body, page, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(me.id, cycle_id, book_id, kind, content, page, rating, now),
    )
    await db.batch(stmts)
  },

  async 'note/delete'({ db, me, body }) {
    await db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').bind(int(body.id, 1, 1e9, '메모'), me.id).run()
  },

  // 나의 서재: 개인 책 등록(id 없음) 또는 수정·진행도 기록(id 있음).
  async shelf({ db, me, body, now }) {
    const title = text(body.title, 100, '책 제목')
    const author = optText(body.author, 60)
    const pages = int(body.pages, 1, 5000, '전체 쪽수')
    const read = int(body.pages_read ?? 0, 0, pages, '읽은 쪽수')
    const done = read >= pages ? now : null
    if (body.id == null) {
      await db
        .prepare('INSERT INTO books (user_id, title, author, pages, pages_read, finished_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(me.id, title, author, pages, read, done, now)
        .run()
      return
    }
    const res = await db
      .prepare(
        `UPDATE books SET title = ?1, author = ?2, pages = ?3, pages_read = ?4,
           finished_at = CASE WHEN ?5 IS NULL THEN NULL ELSE COALESCE(finished_at, ?5) END
         WHERE id = ?6 AND user_id = ?7`,
      )
      .bind(title, author, pages, read, done, int(body.id, 1, 1e9, '책'), me.id)
      .run()
    if (!res.meta.changes) throw new Oops(404, '내 서재에 없는 책이에요')
  },

  async 'shelf/delete'({ db, me, body }) {
    const id = int(body.id, 1, 1e9, '책')
    await db.batch([
      db.prepare('DELETE FROM notes WHERE book_id IN (SELECT id FROM books WHERE id = ? AND user_id = ?)').bind(id, me.id),
      db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').bind(id, me.id),
    ])
  },

  async profile({ db, me, body }) {
    if (!COLORS.includes(body.color)) throw new Oops(400, '고를 수 없는 색이에요')
    await db.prepare('UPDATE users SET name = ?, color = ? WHERE id = ?').bind(text(body.name, 8, '이름'), body.color, me.id).run()
  },

  async password({ db, me, body }) {
    if (!(await verifyPassword(String(body.old ?? ''), me.pw_hash))) throw new Oops(403, '지금 비밀번호가 맞지 않아요')
    const next = String(body.next ?? '')
    if (next.length < 6 || next.length > 100) throw new Oops(400, '새 비밀번호는 6자 이상으로 정해 주세요')
    await db.batch([
      db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').bind(await hashPassword(next), me.id),
      // 다른 기기에 남아 있던 로그인은 모두 끊는다.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(me.id, me.token_hash),
    ])
  },
}
