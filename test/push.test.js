import { test } from 'node:test'
import assert from 'node:assert/strict'
import { b64u, unb64u, encryptPayload, vapidAuth, newVapidKeys, isPushEndpoint, sendPush } from '../src/push.js'
import { progressNews, datesNews, reminderNews, nudgeNews, bookNews, questionNews } from '../src/news.js'

// RFC 8291 5절과 부록 A 의 예제 값. 같은 입력이면 암호문이 글자 하나까지 같아야 한다.
const RFC = {
  plain: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6Tlz' +
    'AC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

test('encryptPayload: RFC 8291 예제와 똑같은 암호문', async () => {
  const pub = unb64u(RFC.asPublic)
  const ecdh = { name: 'ECDH', namedCurve: 'P-256' }
  const jwk = { kty: 'EC', crv: 'P-256', d: RFC.asPrivate, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33)) }
  const local = {
    privateKey: await crypto.subtle.importKey('jwk', jwk, ecdh, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', pub, ecdh, true, []),
  }
  const body = await encryptPayload(RFC.plain, RFC.uaPublic, RFC.auth, { salt: unb64u(RFC.salt), local })
  assert.equal(b64u(body), RFC.body)
})

test('encryptPayload: 매번 새 salt 와 일회용 키를 쓴다', async () => {
  const a = await encryptPayload('안녕', RFC.uaPublic, RFC.auth)
  const b = await encryptPayload('안녕', RFC.uaPublic, RFC.auth)
  assert.notEqual(b64u(a), b64u(b))
  assert.equal(a[20], 65) // salt 16 + 조각 크기 4 다음에 공개키 길이
})

test('vapidAuth: 푸시 서버 주소로 서명한 ES256 토큰', async () => {
  const keys = await newVapidKeys()
  const header = await vapidAuth(keys, 'https://fcm.googleapis.com/fcm/send/abc', 'https://example.com', 1000)
  const m = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/)
  assert.ok(m, header)
  assert.equal(m[4], keys.publicKey)
  assert.equal(unb64u(keys.publicKey).length, 65)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64u(m[1]))), { typ: 'JWT', alg: 'ES256' })
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64u(m[2]))), { aud: 'https://fcm.googleapis.com', exp: 1000 + 12 * 3600, sub: 'https://example.com' })
  const pub = await crypto.subtle.importKey('raw', unb64u(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`)))
})

test('isPushEndpoint: 브라우저 푸시 서버의 https 주소만', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])
    assert.ok(isPushEndpoint(ok), ok)
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://localhost/x', 'nope', '', null])
    assert.ok(!isPushEndpoint(bad), String(bad))
})

test('sendPush: 암호화한 본문과 필요한 머리글로 구독 주소에 보낸다', async () => {
  const keys = await newVapidKeys()
  let seen
  const res = await sendPush(keys, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: RFC.uaPublic, auth: RFC.auth }, { title: '제목', body: '내용', tag: 'progress-2' }, {
    contact: 'https://example.com',
    fetcher: async (url, init) => ((seen = { url, ...init }), { status: 201 }),
  })
  assert.equal(res.status, 201)
  assert.equal(seen.url, 'https://fcm.googleapis.com/fcm/send/abc')
  assert.equal(seen.method, 'POST')
  assert.equal(seen.headers['content-encoding'], 'aes128gcm')
  assert.equal(seen.headers.topic, 'progress-2')
  assert.match(seen.headers.authorization, /^vapid t=.+, k=.+$/)
  assert.ok(Number(seen.headers.ttl) > 0)
  assert.ok(seen.body instanceof Uint8Array && seen.body.length > 86)
})

// ---- 알림 문구 ----
const book = { id: 3, title: '데미안', pages: 240 }
const read = (before, after, first = false) => progressNews({ name: '토리', userId: 2, book, before, after, first })

test('progressNews: 줄었거나 그대로면 알리지 않는다', () => {
  assert.equal(read(100, 100), null)
  assert.equal(read(100, 80), null)
})

test('progressNews: 그냥 쪽수는 10% 칸을 넘을 때만 알린다', () => {
  assert.equal(read(24, 40), null) // 10% → 16%: 같은 칸
  const next = read(40, 50) // 16% → 20%
  assert.match(next.title, /토리.*50쪽/)
  assert.equal(read(50, 60), null) // 20% → 25%
})

test('progressNews: 단계가 오르면 진화, 다 읽으면 완독(가장 먼저면 왕관)', () => {
  assert.match(read(60, 72).title, /꼬마 거북이/) // 25% → 30%
  assert.match(read(100, 170).title, /달리는 거북이/) // 41% → 70%: 두 단계를 건너도 도착한 단계를 알린다
  const done = read(200, 240)
  assert.match(done.title, /다 읽었/)
  assert.doesNotMatch(done.title, /가장 먼저/)
  assert.match(read(200, 240, true).title, /가장 먼저/)
})

test('알림의 tag: 책·종류·사람이 다르면 서로 덮지 않는다', () => {
  const tags = [
    read(40, 50).tag,
    read(60, 72).tag,
    read(200, 240).tag,
    progressNews({ name: '모모', userId: 3, book, before: 40, after: 50, first: false }).tag,
    progressNews({ name: '토리', userId: 2, book: { ...book, id: 4 }, before: 40, after: 50, first: false }).tag,
    bookNews({ name: '토리', book }).tag,
    questionNews({ name: '토리', userId: 2, book, text: '질문' }).tag,
    questionNews({ name: '모모', userId: 3, book, text: '다른 친구의 질문' }).tag,
  ]
  assert.equal(new Set(tags).size, tags.length, tags.join(' '))
  assert.ok(tags.every((tag) => /^[\w-]{1,32}$/.test(tag)), '푸시 서버의 topic 으로 쓸 수 있는 글자와 길이')
})

test('알림의 kind: 친구 독서 소식은 social, 일정은 plan', () => {
  assert.equal(read(40, 50).kind, 'social')
  assert.equal(questionNews({ name: '토리', userId: 2, book, text: '질문' }).kind, 'social')
  assert.equal(bookNews({ name: '토리', book }).kind, 'plan')
  assert.equal(reminderNews({ id: 3, title: '데미안', discussion_date: '2026-11-21' }, '2026-11-20').kind, 'plan')
})

const users = [{ id: 1 }, { id: 2 }, { id: 3 }]
const dates = (extra) => datesNews({ name: '토리', me: 2, book, users, avail: [], decided: null, common: null, ...extra })

test('datesNews: 정해졌으면 나머지 모두에게', () => {
  const n = dates({ decided: '2026-11-21', common: ['2026-11-21'] })
  assert.deepEqual(n.to, [1, 3])
  assert.match(n.body, /11월 21일/)
})

test('datesNews: 아직이면 안 고른 친구에게만, 모두 골랐는데 겹치는 날이 없으면 모두에게', () => {
  const waiting = dates({ avail: [{ user_id: 1, confirmed: 1 }, { user_id: 2, confirmed: 1 }] })
  assert.deepEqual(waiting.to, [3])
  const all = users.map((u) => ({ user_id: u.id, confirmed: 1 }))
  const none = dates({ avail: all, common: [] })
  assert.deepEqual(none.to, [1, 3])
  assert.match(none.title, /겹치는 날이 없/)
})

test('reminderNews: 전날과 당일에만, 모두에게', () => {
  const c = { id: 3, title: '데미안', discussion_date: '2026-11-21' }
  assert.match(reminderNews(c, '2026-11-20').title, /내일/)
  assert.equal(reminderNews(c, '2026-11-20').all, true)
  assert.match(reminderNews(c, '2026-11-21').title, /오늘/)
  assert.equal(reminderNews(c, '2026-11-19'), null)
  assert.equal(reminderNews({ id: 3, title: '데미안', discussion_date: null }, '2026-11-20'), null)
  assert.equal(reminderNews(null, '2026-11-20'), null)
})

test('nudgeNews: 월·목 아침에만, 기다리게 하는 사람에게만', () => {
  const day = 86400e3
  const now = Date.parse('2026-11-09T00:00:00Z') // 월요일
  const picking = { id: 4, picker_id: 2, title: null, discussion_date: null, created_at: now - 3 * day }
  assert.deepEqual(nudgeNews({ cycle: picking, today: '2026-11-09', now, users, avail: [] }).to, [2])
  assert.equal(nudgeNews({ cycle: picking, today: '2026-11-10', now, users, avail: [] }), null, '화요일에는 안 보낸다')
  assert.equal(nudgeNews({ cycle: { ...picking, created_at: now - day }, today: '2026-11-09', now, users, avail: [] }), null, '차례가 된 지 이틀이 안 됐다')

  const scheduling = { id: 4, picker_id: 2, title: '데미안', discussion_date: null, created_at: now - 3 * day }
  assert.deepEqual(nudgeNews({ cycle: scheduling, today: '2026-11-12', now, users, avail: [{ user_id: 1, confirmed: 1 }] }).to, [2, 3]) // 목요일
  assert.equal(nudgeNews({ cycle: scheduling, today: '2026-11-12', now, users, avail: users.map((u) => ({ user_id: u.id, confirmed: 1 })) }), null)
  assert.equal(nudgeNews({ cycle: { ...scheduling, discussion_date: '2026-11-21' }, today: '2026-11-12', now, users, avail: [] }), null, '토론일이 정해졌으면 독촉하지 않는다')
  assert.equal(nudgeNews({ cycle: null, today: '2026-11-09', now, users, avail: [] }), null)
})
