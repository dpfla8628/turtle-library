// 독서토론 앱 API. 정적 파일(public/)은 Cloudflare 가 직접 내보내고, 여기는 /api/* 만 맡는다.
import { todayKST, unanimous, crownOf, nextPicker } from '../public/rules.js'
import { buildDeck, drawCard } from './deck.js'
import { askBook, BOOK_CAT, INTRO_CAT } from './ask.js'
import { hashPassword, verifyPassword, newToken, sha256 } from './auth.js'
import { searchBooks, lookupBook, bookIntro } from './books.js'
import { newVapidKeys, sendPush, isPushEndpoint } from './push.js'
import { progressNews, bookNews, datesNews, rescheduleNews, reopenNews, questionNews, rolloverNews, reminderNews, nudgeNews } from './news.js'

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
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    try {
      if (!url.pathname.startsWith('/api/')) throw new Oops(404, '없는 주소예요')
      return await api(req, env, url, ctx)
    } catch (e) {
      if (e instanceof Oops) return json({ error: e.message }, e.status)
      console.error(e)
      return json({ error: '서버에서 문제가 생겼어요. 잠시 뒤에 다시 해 주세요' }, 500)
    }
  },

  // 매일 아침(한국 시간 9시, wrangler.jsonc 의 crons): 넘길 책이 있으면 넘기고, 토론 전날과 당일을 알린다.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(daily(env.DB))
  },
}

async function daily(db) {
  const now = Date.now()
  const today = todayKST(new Date(now))
  const news = (await rollover(db, now, today)) ?? []
  const [[cur], users, avail] = (
    await db.batch([
      db.prepare('SELECT * FROM cycles WHERE closed = 0'),
      db.prepare('SELECT id FROM users'),
      db.prepare('SELECT a.user_id, a.confirmed FROM availability a JOIN cycles c ON c.id = a.cycle_id WHERE c.closed = 0'),
    ])
  ).map((r) => r.results)
  await notify(db, null, [...news, reminderNews(cur, today), nudgeNews({ cycle: cur, today, now, users, avail })])
}

async function api(req, env, url, ctx) {
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
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(me.token_hash),
      // 이 기기로 가던 알림도 끊는다 (기기가 자기 구독 주소를 같이 보내 준다).
      db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(String(body.endpoint ?? ''), me.id),
    ])
    return json({ ok: true }, 200, { 'set-cookie': cookie('', 0, secure) })
  }

  // 책 찾기는 모임 상태와 상관없으니 여기서 바로 답한다.
  if (req.method === 'GET' && (path === 'search' || path === 'lookup'))
    return json(await findBooks(env.YES24_API_KEY, path, url.searchParams))

  // 친구들에게 알릴 소식을 모은다. 책이 넘어갔으면 그 소식부터.
  const news = (await rollover(db, now, today)) ?? []

  if (req.method === 'POST') {
    const handler = Object.hasOwn(POST, path) && POST[path]
    if (!handler) throw new Oops(404, '없는 주소예요')
    const cur = await db.prepare('SELECT * FROM cycles WHERE closed = 0').first()
    news.push(await handler({ db, me, body, now, today, cur, origin: url.origin, env }))
  } else if (path !== 'state') throw new Oops(404, '없는 주소예요')

  // 알림은 응답을 기다리게 하지 않고 뒤에서 보낸다.
  ctx.waitUntil(notify(db, me, news))

  // 모든 요청은 최신 전체 상태로 답한다. 화면은 받은 걸 그대로 다시 그린다.
  // search: 책 찾기를 쓸 수 있는지. ask: 책 소개로 그 책만의 질문을 만들 수 있는지.
  return json({ ...(await state(db, me, today)), search: Boolean(env.YES24_API_KEY), ask: Boolean(env.YES24_API_KEY && env.AI) })
}

// ---- 알림 ----
// 서명 키는 처음 필요할 때 서버가 만들어 DB 에 둔다. 배포하는 사람이 따로 설정할 것이 없다.
async function vapidKeys(db) {
  const saved = () => db.prepare("SELECT value FROM config WHERE key = 'vapid'").first()
  let row = await saved()
  if (!row) {
    await db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(await newVapidKeys())).run()
    row = await saved() // 동시에 만든 요청이 있었다면 먼저 들어간 키를 쓴다
  }
  return JSON.parse(row.value)
}

// 구독 하나로 보낸다. 기기에서 알림을 껐거나 앱을 지웠으면(404·410) 그 구독을 지운다.
async function deliver(db, keys, contact, sub, message) {
  const res = await sendPush(keys, sub, message, { contact })
  if (res.status === 404 || res.status === 410) await db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run()
  return res.status
}

// news: src/news.js 가 만든 알림들 (빈 값은 건너뛴다). 누구에게 갈지는 to / all / kind 가 정한다.
async function notify(db, me, news) {
  news = news.filter(Boolean)
  if (!news.length) return
  try {
    const [subs, conf] = (await db.batch([db.prepare('SELECT * FROM push_subs'), db.prepare('SELECT key, value FROM config')])).map((r) => r.results)
    if (!subs.length) return
    const keys = JSON.parse(conf.find((c) => c.key === 'vapid').value)
    const contact = conf.find((c) => c.key === 'origin')?.value
    const jobs = []
    for (const n of news)
      for (const s of subs)
        if ((n.all || (n.to ? n.to.includes(s.user_id) : s.user_id !== me?.id)) && !(n.kind === 'social' && s.quiet))
          jobs.push(deliver(db, keys, contact, s, { title: n.title, body: n.body, tag: n.tag }))
    await Promise.allSettled(jobs)
  } catch (e) {
    console.error('알림을 보내지 못했다', e) // 알림 실패가 원래 요청을 망치면 안 된다
  }
}

// ---- 책 찾기 ----
async function findBooks(key, path, query) {
  if (!key) throw new Oops(404, '책 찾기가 아직 켜져 있지 않아요')
  try {
    if (path === 'search') return { items: await searchBooks(key, text(query.get('q'), 50, '검색어')) }
    return { item: await lookupBook(key, int(query.get('id'), 1, 1e12, '책 번호')) }
  } catch (e) {
    if (e instanceof Oops) throw e
    console.error(e)
    throw new Oops(502, '책 정보를 가져오지 못했어요. 아래에 직접 적어 주세요')
  }
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
        'SELECT u.id, u.username, u.name, u.pw_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?',
      )
      .bind(token_hash, now)
      .first())
  if (!me) throw new Oops(401, '로그인이 필요해요')
  return { ...me, token_hash }
}

// ---- 사이클 넘기기 ----
// 토론 다음 날이 되면 이번 책을 마감하고(우승자 기록) 다음 타자의 새 사이클을 연다.
// 누군가 접속할 때, 그리고 매일 아침 크론에서 확인한다. 실제로 넘어갔으면 알릴 소식을 돌려준다.
async function rollover(db, now, today) {
  const cur = await db.prepare('SELECT * FROM cycles WHERE closed = 0').first()
  if (cur && !(cur.discussion_date && cur.discussion_date < today)) return
  let winner = null
  if (cur) {
    const { results } = await db.prepare('SELECT user_id, finished_at FROM progress WHERE cycle_id = ?').bind(cur.id).all()
    winner = crownOf(results)
    const done = await db.prepare('UPDATE cycles SET closed = 1, winner_id = ? WHERE id = ? AND closed = 0').bind(winner, cur.id).run()
    if (!done.meta.changes) return // 동시에 들어온 다른 요청이 이미 마감했다
  }
  const { results: users } = await db.prepare('SELECT id, ord, name FROM users').all()
  const picker = nextPicker(users, cur?.picker_id ?? null)
  // 열린 사이클은 유니크 인덱스로 하나만 허용되므로, 경쟁에서 진 쪽은 조용히 무시된다.
  const opened = await db.prepare('INSERT OR IGNORE INTO cycles (picker_id, created_at) VALUES (?, ?)').bind(picker, now).run()
  if (!opened.meta.changes) return
  const who = (id) => users.find((u) => u.id === id)
  return rolloverNews({ closed: cur, winner: who(winner), picker: who(picker), users })
}

// ---- 전체 상태 ----
// ponytail: 모임 전체 데이터를 한 번에 내려준다(3명 × 한 달 한 권이면 수십 KB).
// 느려지면 지난 사이클의 메모·질문을 따로 불러오게 쪼갤 것.
async function state(db, me, today) {
  const q = (sql) => db.prepare(sql)
  const [users, cycles, avail, progress, questions, notes, books, conf, subs] = (
    await db.batch([
      q('SELECT id, name, color, ord FROM users ORDER BY ord'),
      q('SELECT * FROM cycles ORDER BY id'),
      q('SELECT a.* FROM availability a JOIN cycles c ON c.id = a.cycle_id WHERE c.closed = 0'),
      q('SELECT * FROM progress'),
      q('SELECT * FROM questions ORDER BY sec, id'),
      q('SELECT * FROM notes ORDER BY id'),
      q('SELECT * FROM books ORDER BY id'),
      q("SELECT value FROM config WHERE key = 'vapid'"),
      db.prepare('SELECT endpoint, quiet FROM push_subs WHERE user_id = ?').bind(me.id),
    ])
  ).map((r) => r.results)
  const vapid = conf[0] ? JSON.parse(conf[0].value) : await vapidKeys(db)
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
    // 알림: 구독할 때 쓰는 공개키, 그리고 알림이 켜져 있는 내 기기들 (quiet: 친구 독서 소식은 끔)
    push: { key: vapid.publicKey, subs },
  }
}

const needBook = (cur) => {
  if (!cur?.title) throw new Oops(409, '아직 이번 책이 정해지지 않았어요')
}

// ---- 변경 요청 ----
const POST = {
  // 알림: 이 기기(브라우저)의 구독을 저장한다. 같은 기기로 다른 친구가 로그인하면 그 친구 것으로 바뀐다.
  async 'push/subscribe'({ db, me, body, now, origin }) {
    const endpoint = String(body.endpoint ?? '')
    const p256dh = String(body.p256dh ?? '')
    const secret = String(body.auth ?? '')
    if (endpoint.length > 1000 || !isPushEndpoint(endpoint)) throw new Oops(400, '이 브라우저의 알림 주소는 쓸 수 없어요')
    if (!/^[\w-]{80,100}$/.test(p256dh) || !/^[\w-]{16,40}$/.test(secret)) throw new Oops(400, '알림 정보가 올바르지 않아요')
    await vapidKeys(db)
    await db.batch([
      db
        .prepare(
          `INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (endpoint) DO UPDATE SET user_id = ?2, p256dh = ?3, auth = ?4`,
        )
        .bind(endpoint, me.id, p256dh, secret, now),
      // 푸시 서버에 "누가 보내는지"로 알려 줄 이 앱의 주소
      db.prepare("INSERT INTO config (key, value) VALUES ('origin', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1").bind(origin),
    ])
  },

  async 'push/unsubscribe'({ db, me, body }) {
    await db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(String(body.endpoint ?? ''), me.id).run()
  },

  // 이 기기에서 "친구 독서 소식"(진행도·진화·완독·질문) 알림만 끄거나 켠다. 일정 알림은 계속 온다.
  async 'push/quiet'({ db, me, body }) {
    if (typeof body.quiet !== 'boolean') throw new Oops(400, '알림 설정 값이 올바르지 않아요')
    const done = await db
      .prepare('UPDATE push_subs SET quiet = ? WHERE endpoint = ? AND user_id = ?')
      .bind(body.quiet ? 1 : 0, String(body.endpoint ?? ''), me.id)
      .run()
    if (!done.meta.changes) throw new Oops(404, '이 기기는 알림이 켜져 있지 않아요')
  },

  // 이 기기로 시험 알림을 보낸다. 못 보냈으면 이유(푸시 서버의 응답 번호)를 알려 준다.
  async 'push/test'({ db, me, body, origin }) {
    const sub = await db.prepare('SELECT * FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(String(body.endpoint ?? ''), me.id).first()
    if (!sub) throw new Oops(409, '이 기기는 알림이 켜져 있지 않아요. 먼저 알림을 켜 주세요')
    const message = { title: '🐢 거북이 도서관', body: `${me.name}님, 알림이 잘 도착했어요!`, tag: 'test' }
    const code = await deliver(db, await vapidKeys(db), origin, sub, message).catch(() => 0)
    if (code < 200 || code >= 300) throw new Oops(502, `알림을 보내지 못했어요 (응답 ${code}). 알림을 껐다가 다시 켜 보세요`)
  },

  // 이번 타자가 책을 등록(또는 수정)한다.
  async book({ db, me, body, now, cur }) {
    if (cur.picker_id !== me.id) throw new Oops(403, '이번 책은 다른 친구가 고를 차례예요')
    const title = text(body.title, 100, '책 제목')
    const pages = int(body.pages, 1, 5000, '전체 쪽수')
    const genre = GENRES.includes(body.genre) ? body.genre : 'fiction'
    const stmts = [
      db
        .prepare('UPDATE cycles SET title = ?, author = ?, pages = ?, genre = ?, reason = ? WHERE id = ?')
        .bind(title, optText(body.author, 60), pages, genre, optText(body.reason, 200), cur.id),
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
    return cur.title ? null : bookNews({ name: me.name, book: { id: cur.id, title } }) // 고칠 때는 알리지 않는다
  },

  // 가능한 날짜를 저장한다. 전원이 확정했고 겹치는 날이 있으면 그중 하루를 뽑아 토론일로 정한다.
  async dates({ db, me, body, today, cur }) {
    needBook(cur)
    if (cur.discussion_date) throw new Oops(409, '토론일이 이미 정해졌어요')
    // 화면은 내일부터 90일 안의 날만 고르게 한다. 서버도 같은 범위의 실제 날짜만 받는다 (지난 날은 조용히 버린다).
    const last = new Date(Date.parse(`${today}T00:00:00Z`) + 90 * 86400e3).toISOString().slice(0, 10)
    const real = (d) => {
      if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
      const at = Date.parse(`${d}T00:00:00Z`) // 13월처럼 없는 날짜는 NaN, 2월 30일은 3월로 넘어간다
      return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === d
    }
    if (!Array.isArray(body.dates) || body.dates.length > 120 || !body.dates.every((d) => real(d) && d <= last)) throw new Oops(400, '날짜가 올바르지 않아요')
    const dates = [...new Set(body.dates)].filter((d) => d > today).sort()
    const confirmed = body.confirmed ? 1 : 0
    if (confirmed && !dates.length) throw new Oops(400, '가능한 날짜를 하루 이상 골라 주세요')
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
    let decided = common?.length ? common[Math.floor(Math.random() * common.length)] : null
    if (decided) {
      const set = await db.prepare('UPDATE cycles SET discussion_date = ? WHERE id = ? AND discussion_date IS NULL').bind(decided, cur.id).run()
      if (!set.meta.changes) return null // 동시에 들어온 다른 요청이 먼저 정했다. 알림은 그쪽이 보낸다
    }
    return confirmed ? datesNews({ name: me.name, me: me.id, book: cur, users, avail, decided, common }) : null
  },

  // 정해진 토론일을 취소하고 다시 고른다. 골라 둔 날짜는 남기고 확정만 푼다.
  async reschedule({ db, me, cur }) {
    await db.batch([
      db.prepare('UPDATE cycles SET discussion_date = NULL WHERE id = ?').bind(cur.id),
      db.prepare('UPDATE availability SET confirmed = 0 WHERE cycle_id = ?').bind(cur.id),
    ])
    return cur.discussion_date ? rescheduleNews({ name: me.name, book: cur }) : null
  },

  // 방금 넘어간 것을 되돌린다. 토론을 못 했는데 날짜가 지나 책이 넘어가 버렸을 때 쓴다.
  // 새 책이 아직 안 정해진 동안에만 된다: 빈 새 사이클을 지우고 이전 책을 다시 열어 날짜부터 다시 정한다.
  async reopen({ db, me, cur }) {
    if (cur.title) throw new Oops(409, '새 책이 이미 정해져서 되돌릴 수 없어요')
    const prev = await db.prepare('SELECT * FROM cycles WHERE closed = 1 ORDER BY id DESC LIMIT 1').first()
    if (!prev) throw new Oops(409, '되돌릴 지난 책이 없어요')
    // 세 문장 모두 "이전 책이 아직 마감 상태일 때만" 일한다. 같은 요청이 동시에 두 번 들어와도 한 번만 되돌려진다.
    const [, , reopened] = await db.batch([
      db.prepare('UPDATE availability SET confirmed = 0 WHERE cycle_id = ?1 AND (SELECT closed FROM cycles WHERE id = ?1) = 1').bind(prev.id),
      db.prepare('DELETE FROM cycles WHERE id = ? AND title IS NULL').bind(cur.id), // 열린 사이클은 하나뿐이어야 하므로 다시 열기 전에 지운다
      db.prepare('UPDATE cycles SET closed = 0, winner_id = NULL, discussion_date = NULL WHERE id = ? AND closed = 1').bind(prev.id),
    ])
    return reopened.meta.changes ? reopenNews({ name: me.name, book: prev }) : null
  },

  // 모임 도서를 어디까지 읽었는지. 지난 모임 책도 서재에서 이어서 기록할 수 있다(우승자는 안 바뀐다).
  async progress({ db, me, body, now, cur }) {
    const cycle =
      body.cycle_id == null
        ? cur
        : await db.prepare('SELECT * FROM cycles WHERE id = ?').bind(int(body.cycle_id, 1, 1e9, '책')).first()
    needBook(cycle)
    const pages = int(body.pages, 0, cycle.pages, '읽은 쪽수')
    const { results: was } = await db.prepare('SELECT user_id, pages_read, finished_at FROM progress WHERE cycle_id = ?').bind(cycle.id).all()
    await db
      .prepare(
        `INSERT INTO progress (cycle_id, user_id, pages_read, finished_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (cycle_id, user_id) DO UPDATE SET pages_read = ?3,
           finished_at = CASE WHEN ?4 IS NULL THEN NULL ELSE COALESCE(progress.finished_at, ?4) END`,
      )
      .bind(cycle.id, me.id, pages, pages >= cycle.pages ? now : null)
      .run()
    if (cycle.closed) return null // 지난 책을 이어 읽는 것은 조용히 기록만 한다
    const winner =
      pages >= cycle.pages &&
      (await db.prepare('SELECT user_id FROM progress WHERE cycle_id = ? AND finished_at IS NOT NULL ORDER BY finished_at, user_id LIMIT 1').bind(cycle.id).first())
    return progressNews({
      name: me.name,
      userId: me.id,
      book: cycle,
      before: was.find((p) => p.user_id === me.id)?.pages_read ?? 0,
      after: pages,
      first: winner?.user_id === me.id,
    })
  },

  async question({ db, me, body, cur }) {
    needBook(cur)
    const asked = text(body.body, 300, '질문')
    await db.prepare("INSERT INTO questions (cycle_id, user_id, sec, cat, body) VALUES (?, ?, 1, '우리의 질문', ?)").bind(cur.id, me.id, asked).run()
    return questionNews({ name: me.name, userId: me.id, book: cur, text: asked })
  },

  // 소설의 주인공 이름. 적어 두면 카드가 "내가 ○○라면"처럼 그 이름으로 묻는다. 비우면 다시 '주인공'.
  async hero({ db, body, cur }) {
    needBook(cur)
    const name = optText(String(body.name ?? '').replace(/[{}\s]+/g, ' '), 20)
    await db.prepare('UPDATE cycles SET hero = ? WHERE id = ?').bind(name, cur.id).run()
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

  // 예스24 책 소개를 읽고 덱 맨 앞에 놓을 카드를 만든다(무료 AI, 10초쯤):
  // 줄거리를 짧게 되짚는 "이 책은" 한 장 + 이 책에만 맞는 질문 다섯 장쯤.
  async 'question/book'({ db, cur, env }) {
    needBook(cur)
    if (!env.YES24_API_KEY || !env.AI) throw new Oops(404, '책에 맞춘 질문은 아직 켜져 있지 않아요')
    const { results: front } = await db.prepare('SELECT cat FROM questions WHERE cycle_id = ? AND sec = 0').bind(cur.id).all()
    if (front.some((q) => q.cat === BOOK_CAT)) throw new Oops(409, '이 책에 맞는 질문은 이미 받았어요')
    let made
    try {
      const intro = await bookIntro(env.YES24_API_KEY, cur.title, cur.author)
      if (!intro) throw new Oops(404, '이 책의 소개글을 찾지 못했어요. 질문을 직접 추가해 보세요')
      made = await askBook(env.AI, { ...cur, intro })
    } catch (e) {
      if (e instanceof Oops) throw e
      console.error(e)
      made = { cards: [] }
    }
    if (!made.cards.length) throw new Oops(502, '질문을 만들지 못했어요. 잠시 뒤에 다시 해 보세요')
    // 줄거리 카드는 한 장만 둔다(질문만 빼고 다시 받는 경우). 제목의 [ ] { } 는 카드 문법과 겹쳐서 뗀다.
    const opener = made.summary &&
      !front.some((q) => q.cat === INTRO_CAT) && {
        cat: INTRO_CAT,
        body: `『${cur.title.replace(/[[\]{}]/g, ' ').trim()}』, 이런 이야기였죠.\n${made.summary}\n자, 그럼 이야기를 시작해 볼까요?`,
      }
    const rows = [opener, ...made.cards.map((body) => ({ cat: BOOK_CAT, body }))].filter(Boolean)
    await db.batch([
      // 만드는 사이에 다른 친구가 먼저 받았거나 책이 바뀌었으면 넣지 않는다.
      db
        .prepare(
          `INSERT INTO questions (cycle_id, sec, cat, body)
           SELECT ?1, 0, json_extract(value, '$.cat'), json_extract(value, '$.body') FROM json_each(?3)
           WHERE NOT EXISTS (SELECT 1 FROM questions WHERE cycle_id = ?1 AND cat = ?2)
             AND EXISTS (SELECT 1 FROM cycles WHERE id = ?1 AND closed = 0 AND title = ?4)`,
        )
        .bind(cur.id, BOOK_CAT, JSON.stringify(rows), cur.title),
      // 소설이고 주인공 이름을 아직 안 적었으면, 책 소개에서 찾은 이름을 넣어 둔다(토론장에서 바꿀 수 있다).
      db.prepare("UPDATE cycles SET hero = ?1 WHERE id = ?2 AND hero IS NULL AND genre = 'fiction' AND title = ?3").bind(made.hero, cur.id, cur.title),
    ])
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
