// 웹 푸시 보내기. 서명(VAPID, RFC 8292)과 본문 암호화(RFC 8291, aes128gcm)를 WebCrypto 로 직접 한다 — 의존성 없음.
// 암호화가 표준과 맞는지는 test/push.test.js 가 RFC 의 예제 값으로 확인한다.
const enc = new TextEncoder()

export const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// 구독 주소는 기기가 보내 준 값이다. 브라우저 회사의 푸시 서버만 받아서, 서버가 아무 주소로나 요청을 보내게 되는 일을 막는다.
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/
export function isPushEndpoint(endpoint) {
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname)
  } catch {
    return false
  }
}

// 이 앱의 서명 키. 공개키는 기기가 구독할 때 쓰고, 개인키로는 보낼 때마다 서명한다.
export async function newVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  return {
    publicKey: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  }
}

// Authorization 머리글. 푸시 서버 주소(aud)가 들어가므로 서버마다 따로 서명한다.
export async function vapidAuth(keys, endpoint, contact, nowSec) {
  const part = (obj) => b64u(enc.encode(JSON.stringify(obj)))
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: contact })}`
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned))
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.publicKey}`
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

// 기기의 공개키(p256dh)와 비밀값(auth)으로 본문을 암호화한다. salt 와 local(보내는 쪽 일회용 키)은 시험할 때만 넣는다.
export async function encryptPayload(plain, p256dh, auth, { salt = crypto.getRandomValues(new Uint8Array(16)), local } = {}) {
  const ecdh = { name: 'ECDH', namedCurve: 'P-256' }
  local ??= await crypto.subtle.generateKey(ecdh, true, ['deriveBits'])
  const theirs = unb64u(p256dh)
  const ours = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const theirKey = await crypto.subtle.importKey('raw', theirs, ecdh, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirKey }, local.privateKey, 256))

  const ikm = await hkdf(unb64u(auth), shared, concat(enc.encode('WebPush: info\0'), theirs, ours), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // 본문 끝의 0x02 는 "이게 마지막 조각"이라는 표시다.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(plain), Uint8Array.of(2))))
  // salt(16) | 조각 크기 4096(4) | 공개키 길이(1) | 보내는 쪽 공개키(65) | 암호문
  return concat(salt, Uint8Array.of(0, 0, 16, 0), Uint8Array.of(ours.length), ours, sealed)
}

// 구독 하나에 알림 하나. 푸시 서버의 응답을 그대로 돌려준다 (404·410 이면 그 구독은 사라진 것).
export async function sendPush(keys, sub, message, { contact, now = Date.now(), fetcher = fetch } = {}) {
  const headers = {
    authorization: await vapidAuth(keys, sub.endpoint, contact, Math.floor(now / 1000)),
    'content-encoding': 'aes128gcm',
    'content-type': 'application/octet-stream',
    ttl: '86400', // 기기가 꺼져 있으면 하루까지 보관
  }
  // 같은 topic 의 밀린 알림은 새것으로 바뀐다 (꺼져 있던 폰에 진행도 알림이 줄줄이 쌓이지 않게).
  if (/^[\w-]{1,32}$/.test(message.tag ?? '')) headers.topic = message.tag
  return fetcher(sub.endpoint, { method: 'POST', headers, body: await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth) })
}
