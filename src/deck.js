// 토론 덱 구성. 문항과 쓴 원칙은 cards.js.
import { CARDS, PLAN } from './cards.js'

const genreOf = (genre) => (Object.hasOwn(CARDS, genre) ? genre : 'fiction')
const take = (arr, rand) => arr.splice(Math.floor(rand() * arr.length), 1)[0]

// 분류마다 정해진 장수만큼 고른다. base 카드는 늘 들어가고 나머지 자리는 매번 다르게 뽑는다.
export function buildDeck(genre, rand = Math.random) {
  const g = genreOf(genre)
  return PLAN[g].flatMap(([cat, n]) => {
    const spare = CARDS[g].filter((c) => c.cat === cat && !c.base)
    const picked = CARDS[g].filter((c) => c.cat === cat && c.base)
    while (picked.length < n && spare.length) picked.push(take(spare, rand))
    return picked.map((c) => ({ sec: 1, cat, body: c.body }))
  })
}

// 아직 덱에 없는 카드 한 장. 다 뽑았으면 null.
export function drawCard(genre, have, rand = Math.random) {
  const pool = CARDS[genreOf(genre)].filter((c) => !have.has(c.body))
  return pool.length ? take(pool, rand) : null
}
