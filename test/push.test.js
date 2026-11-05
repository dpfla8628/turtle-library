import { test } from 'node:test'
import assert from 'node:assert/strict'
import { b64u, unb64u, encryptPayload, vapidAuth, newVapidKeys, isPushEndpoint, sendPush } from '../src/push.js'
import { progressNews, datesNews, reminderNews } from '../src/news.js'

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
const book = { title: '데미안', pages: 240 }

test('progressNews: 줄었거나 그대로면 알리지 않는다', () => {
  assert.equal(progressNews({ name: '토리', book, before: 100, after: 100, first: false }), null)
  assert.equal(progressNews({ name: '토리', book, before: 100, after: 80, first: false }), null)
})

test('progressNews: 평소엔 쪽수, 단계가 오르면 진화, 다 읽으면 완독', () => {
  const plain = progressNews({ name: '토리', book, before: 10, after: 40, first: false })
  assert.match(plain.title, /토리.*40쪽/)
  assert.equal(plain.tag, 'progress')
  const up = progressNews({ name: '토리', book, before: 40, after: 72, first: false }) // 16% → 30%
  assert.match(up.title, /꼬마 거북이/)
  const done = progressNews({ name: '토리', book, before: 200, after: 240, first: false })
  assert.match(done.title, /다 읽었/)
  assert.doesNotMatch(done.title, /가장 먼저/)
  const crown = progressNews({ name: '토리', book, before: 200, after: 240, first: true })
  assert.match(crown.title, /가장 먼저/)
})

test('datesNews: 정해졌으면 모두에게, 아니면 아직 안 고른 친구에게만', () => {
  const users = [{ id: 1 }, { id: 2 }, { id: 3 }]
  const decided = datesNews({ name: '토리', me: 2, book, users, avail: [], decided: '2026-11-21' })
  assert.deepEqual(decided.to, [1, 3])
  assert.match(decided.body, /11월 21일/)
  const waiting = datesNews({ name: '토리', me: 2, book, users, avail: [{ user_id: 1, confirmed: 1 }, { user_id: 2, confirmed: 1 }], decided: null })
  assert.deepEqual(waiting.to, [3])
  assert.equal(datesNews({ name: '토리', me: 2, book, users, avail: users.map((u) => ({ user_id: u.id, confirmed: 1 })), decided: null }), null)
})

test('reminderNews: 전날과 당일에만', () => {
  const c = { title: '데미안', discussion_date: '2026-11-21' }
  assert.match(reminderNews(c, '2026-11-20').title, /내일/)
  assert.match(reminderNews(c, '2026-11-21').title, /오늘/)
  assert.equal(reminderNews(c, '2026-11-19'), null)
  assert.equal(reminderNews({ title: '데미안', discussion_date: null }, '2026-11-20'), null)
  assert.equal(reminderNews(null, '2026-11-20'), null)
})
