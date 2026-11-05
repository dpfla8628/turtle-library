// 비밀번호 해시와 세션 토큰. Worker 와 scripts/users.mjs 가 같이 쓴다 (둘 다 WebCrypto).

const enc = new TextEncoder()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)))

// ponytail: 1만 회 — Workers 무료 플랜의 요청당 CPU 10ms 안에 들어오게 낮춘 값.
// 반복 수가 해시 문자열에 같이 저장되므로, 유료 플랜으로 옮기면 이 숫자만 10만으로 올리면 된다.
const ITERATIONS = 10000

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return `${iterations}:${hex(salt)}:${hex(bits)}`
}

export async function verifyPassword(password, stored) {
  const [iterations, salt] = stored.split(':')
  const again = await hashPassword(password, unhex(salt), Number(iterations))
  let diff = again.length ^ stored.length
  for (let i = 0; i < again.length; i++) diff |= again.charCodeAt(i) ^ stored.charCodeAt(i) // 상수 시간 비교
  return diff === 0
}

export const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)))
export const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
