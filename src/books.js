// 책 찾기: 예스24 Open API (https://developers.yes24.com). 제목으로 찾아 고르면 지은이·쪽수가 채워진다.
// 키는 Worker 비밀값 YES24_API_KEY. 없으면 이 기능은 꺼지고 화면은 직접 입력만 보여 준다.
// 이용 조건: 키는 서버에서만 쓰고, 책 정보가 보이는 화면에 예스24 출처와 상품 페이지 링크를 둔다.
const API = 'https://apis.yes24.com/v1/goods/'

// "유발 하라리 저/조현욱 역" → "유발 하라리".  역할 표기가 없으면 그대로.
export function cleanAuthor(a) {
  return String(a ?? '')
    .split('/')[0]
    .replace(/\(.*?\)/g, '')
    .replace(/\s+(공저|편저|원저|저자|지음|글그림|저|글|편)\s*$/, '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ')
}

// 분류명에서 토론 카드 종류를 짐작한다. 모르겠으면 null (화면에서 고른 값을 건드리지 않는다).
export function genreOf(sort = '') {
  if (/에세이|수필|시집|\b시\b/.test(sort)) return 'essay'
  if (/소설|희곡|동화|판타지|라이트노벨|라이트 노벨/.test(sort)) return 'fiction'
  if (/인문|사회|과학|경제|경영|자기계발|역사|정치|예술|종교|건강|IT|컴퓨터/.test(sort)) return 'nonfiction'
  return null
}

const from = (url, ...hosts) => (hosts.some((h) => String(url ?? '').startsWith(h)) ? String(url) : '')

export function toBook(it) {
  const id = Number(it.itemId) || null
  return {
    id,
    title: String(it.title ?? '').trim().slice(0, 100),
    author: cleanAuthor(it.author).slice(0, 60),
    publisher: String(it.publisher ?? ''),
    year: /^\d{4}/.test(String(it.publishDate ?? '')) ? String(it.publishDate).slice(0, 4) : '',
    cover: from(it.cover, 'https://image.yes24.com/'),
    link: from(it.link, 'https://www.yes24.com/', 'https://m.yes24.com/', 'https://apis.yes24.com/') || (id ? `https://www.yes24.com/product/goods/${id}` : ''),
    genre: genreOf(it.goodsSortNm),
    pages: Number(it.pages) > 0 ? Number(it.pages) : null, // detail=Y 일 때만 온다
  }
}

async function call(path, key, params) {
  const res = await fetch(`${API}${path}?${new URLSearchParams({ ...params, detail: 'Y' })}`, { headers: { 'X-Api-Key': key } })
  if (res.status === 404) return [] // SEARCH_001 / GOODS_00x: 결과 없음
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) throw new Error(`YES24 ${res.status} ${body?.errorCode ?? ''} ${body?.message ?? ''}`)
  return body.data?.items ?? []
}

export const searchBooks = async (key, query) => (await call('itemList', key, { query, category: 'BOOK', pageSize: '10' })).map(toBook)

export async function lookupBook(key, id) {
  const [it] = await call('itemDetail', key, { searchType: 'ItemId', query: String(id) })
  return it ? toBook(it) : null
}

// ---- 토론 질문을 만들 때 쓸 책 소개글 ----
const plain = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
const squash = (s) => String(s ?? '').replace(/\s+/g, '')
const introOf = (it) => [it?.contentDetail?.bookIntroduction, it?.contentDetail?.bookSummary].map(plain).filter(Boolean).join(' ').slice(0, 3000)

// 제목과 지은이가 맞는 책 가운데 소개글이 있는 첫 번째 것의 "책 소개 + 줄거리". 못 찾으면 빈 문자열.
// 같은 책이 판형별로 여러 개 나오고 소개가 빈 판도 있어서, 제목이 꼭 맞는 것부터 세 권까지 본다.
// 지은이를 적어 뒀는데 지은이가 다르면 제목이 같아도 쓰지 않는다(엉뚱한 책으로 질문을 만드느니 안 만드는 편이 낫다).
export async function bookIntro(key, title, author) {
  const items = await call('itemList', key, { query: title, category: 'BOOK', pageSize: '10' })
  const [want, by] = [squash(title), squash(author)]
  const titled = (it) => {
    const have = squash(it.title)
    return have === want ? 2 : have && (have.includes(want) || want.includes(have)) ? 1 : 0
  }
  const authored = (it) => {
    const who = squash(cleanAuthor(it.author))
    return !by || (who && (who.includes(by) || by.includes(who)))
  }
  const picks = items.filter((it) => titled(it) && authored(it)).sort((a, b) => titled(b) - titled(a)).slice(0, 3)
  for (const it of picks) {
    // 목록 응답에 소개가 실려 오지 않으면 상세를 한 번 더 묻는다.
    const full = it.contentDetail === undefined ? (await call('itemDetail', key, { searchType: 'ItemId', query: String(it.itemId) }))[0] : it
    if (introOf(full).length >= 40) return introOf(full)
  }
  return ''
}
