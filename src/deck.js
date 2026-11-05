// 토론 덱 구성. 문항은 cards.js, 구성 근거는 reports/독서토론 질문과 진행 방식.md.
// 한 회 = 워밍업 2 → 밑줄 낭독 → 해석 1 → 입장 2 → 연결 1 → 마무리 2(가끔 3). 텍스트에 붙은 질문이 먼저, 내 이야기는 나중.
import { OPEN, WARMUPS, GENRE_WARMUP, UNDERLINE, CORE, CLOSING_EXTRA, RESCORE, ONE_LINE } from './cards.js'

const genreOf = (genre) => (Object.hasOwn(GENRE_WARMUP, genre) ? genre : 'fiction')
const one = (arr, rand) => arr[Math.floor(rand() * arr.length)]

export function buildDeck(genre, rand = Math.random) {
  const g = genreOf(genre)
  const pool = [...CORE.common, ...CORE[g]]
  // 자리마다 기본 카드를 주로 쓰되, 매달 똑같지 않게 세 번에 한 번은 같은 분류의 다른 카드로 바꾼다.
  const slot = (cat) => {
    const spare = pool.filter((c) => c.cat === cat && !c.base)
    return CORE[g]
      .filter((c) => c.cat === cat && c.base)
      .map((basic) => (rand() < 2 / 3 ? basic : spare.splice(Math.floor(rand() * spare.length), 1)[0]))
  }
  return [
    ...[OPEN, rand() < 0.5 ? GENRE_WARMUP[g] : one(WARMUPS, rand)].map((c) => ({ sec: 0, ...c })),
    ...[UNDERLINE, ...slot('해석'), ...slot('입장'), ...slot('연결')].map((c) => ({ sec: 1, ...c })),
    ...[...(rand() < 1 / 3 ? [one(CLOSING_EXTRA, rand)] : []), RESCORE, ONE_LINE].map((c) => ({ sec: 2, ...c })),
  ].map(({ sec, cat, body }) => ({ sec, cat, body }))
}

// 아직 덱에 없는 본 질문 한 장. 다 뽑았으면 null.
export function drawCard(genre, have, rand = Math.random) {
  const pool = [...CORE.common, ...CORE[genreOf(genre)]].filter((c) => !have.has(c.body))
  return pool.length ? one(pool, rand) : null
}
