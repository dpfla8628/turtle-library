// 책 소개로 그 책만의 질문 만들기: 책 소개 고르기(예스24 응답)와 모델 답 다듬기.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCards, askBook, askMessages, BOOK_CAT } from '../src/ask.js'
import { bookIntro } from '../src/books.js'

test('toCards: 모델의 답을 카드 문구로 바꾸고, 어긋난 것은 버린다', () => {
  const answer = `여기 있습니다:
  {"summary": "스물다섯 살 안진진이 [두 남자] 사이에서\\n누구와 결혼할지 고민하는 이야기예요.", "hero": "안진진", "questions": [
    {"q": "내가 안진진이라면 누구와 결혼했을까요?", "more": "그 선택으로 잃는 것은 무엇인가요?", "choices": ["김장우", "나영규"]},
    {"q": "어머니의 삶은 불행하기만 했을까요?", "more": "", "choices": ["하나뿐"]},
    {"q": "", "more": "질문이 없으면 버려요"},
    {"q": "[대괄호]와 {중괄호},\\n줄바꿈은 지워요", "choices": "배열이 아님"},
    {"q": "반말로 묻는 질문은 버릴까?", "more": "그래요?"},
    {"q": "이어 묻는 말만 반말이면 그 줄만 떼나요?", "more": "왜 그럴까?"},
    {"q": "저자의 말에 동의하시나요?", "more": "당신은 당신의 삶을 어떻게 보시나요?"},
    {"q": "당신이라면 당신이 가진 것을 당신과 가까운 사람에게 줬을까요?"},
    "문자열", null
  ]}`
  assert.deepEqual(toCards(answer), {
    summary: '스물다섯 살 안진진이 두 남자 사이에서 누구와 결혼할지 고민하는 이야기예요.',
    hero: '안진진',
    cards: [
      '내가 안진진이라면 누구와 결혼했을까요? [김장우 / 나영규]\n그 선택으로 잃는 것은 무엇인가요?',
      '어머니의 삶은 불행하기만 했을까요?', // 선택지가 하나면 붙이지 않는다
      '대괄호 와 중괄호 , 줄바꿈은 지워요',
      '이어 묻는 말만 반말이면 그 줄만 떼나요?',
      '저자의 말에 동의하나요?\n나는 나의 삶을 어떻게 보나요?', // '당신', '~하시나요'는 다른 카드 말투로
      '나라면 내가 가진 것을 나와 가까운 사람에게 줬을까요?',
    ],
  })
  for (const junk of ['', '모르겠어요', '{"questions": "없음"}', '{"hero": 3}', null, undefined, '{깨진 JSON'])
    assert.deepEqual(toCards(junk), { summary: null, hero: null, cards: [] })
  assert.equal(toCards('{"summary": "너무 짧아요"}').summary, null) // 줄거리라고 하기엔 짧은 것은 쓰지 않는다
  const many = JSON.stringify({ questions: Array.from({ length: 9 }, (_, i) => ({ q: `${i}번째 질문인가요?` })) })
  assert.equal(toCards(many).cards.length, 6)
})

test('askBook: 책 소개를 넣어 묻고, 소개에 없는 주인공 이름은 버린다', async () => {
  const book = { title: '모순', author: '양귀자', genre: 'fiction', intro: '스물다섯 살 안진진의 이야기.' }
  const asked = []
  const ai = (hero) => ({
    run: async (model, input) => {
      asked.push(input)
      return { choices: [{ message: { content: JSON.stringify({ hero, questions: [{ q: '안진진의 선택은 옳았을까요?' }] }) } }] }
    },
  })
  assert.deepEqual(await askBook(ai('안진진'), book), { summary: null, hero: '안진진', cards: ['안진진의 선택은 옳았을까요?'] })
  assert.equal((await askBook(ai('김영세'), book)).hero, null)
  assert.match(asked[0].messages[1].content, /『모순』 \(양귀자, 소설\)[\s\S]*스물다섯 살 안진진의 이야기/)
  assert.equal(askMessages({ ...book, author: null, genre: 'essay' })[1].content.split('\n')[0], '책: 『모순』 (에세이)')
  assert.equal(BOOK_CAT, '이 책의 질문')
})

// 예스24 를 흉내 낸다: 주소별로 정해 둔 items 를 돌려준다.
function fakeYes24(t, routes) {
  const seen = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(url)
    seen.push(`${u.pathname.split('/').pop()}:${u.searchParams.get('query')}`)
    const items = routes[seen.at(-1)]
    return items ? Response.json({ success: true, data: { items } }) : Response.json({ success: false, errorCode: 'SEARCH_001' }, { status: 404 })
  })
  return seen
}
const long = (s) => s + ' 이 책은 우리에게 삶의 모순을 묻는다.'.repeat(3)

test('bookIntro: 제목과 지은이가 맞는 책의 소개글(책 소개 + 줄거리)을 고른다', async (t) => {
  const seen = fakeYes24(t, {
    'itemList:모순': [
      { itemId: 1, title: '모순의 경제학', author: '다른 사람 저', contentDetail: { bookIntroduction: long('엉뚱한 책.') } },
      { itemId: 2, title: '모순', author: '다른 작가 저', contentDetail: { bookIntroduction: long('제목만 같은 책.') } },
      { itemId: 3, title: '모순', author: '양귀자 저', contentDetail: null }, // 소개가 빈 판
      { itemId: 4, title: '모순 (양장)', author: '양귀자 저', contentDetail: { bookIntroduction: long('<p>안진진의&nbsp;이야기.</p>'), bookSummary: '<b>줄거리</b> 요약' } },
      { itemId: 5, title: '전혀 다른 책', author: '양귀자 저', contentDetail: { bookIntroduction: long('관계없는 책.') } },
    ],
  })
  const intro = await bookIntro('key', '모순', '양귀자')
  assert.match(intro, /^안진진의 이야기\. 이 책은/)
  assert.match(intro, /줄거리 요약$/)
  assert.doesNotMatch(intro, /[<>]|&nbsp;/)
  assert.deepEqual(seen, ['itemList:모순'])
})

test('bookIntro: 목록에 소개가 실려 오지 않으면 상세를 묻고, 못 찾으면 빈 문자열', async (t) => {
  const seen = fakeYes24(t, {
    'itemList:데미안': [{ itemId: 7, title: '데미안', author: '헤르만 헤세 저/전영애 역' }],
    'itemDetail:7': [{ itemId: 7, title: '데미안', contentDetail: { bookIntroduction: long('싱클레어의 성장 이야기.') } }],
    'itemList:짧은 책': [{ itemId: 8, title: '짧은 책', contentDetail: { bookIntroduction: '너무 짧다' } }],
  })
  assert.match(await bookIntro('key', '데미안', '헤르만 헤세'), /^싱클레어의 성장 이야기/)
  assert.deepEqual(seen, ['itemList:데미안', 'itemDetail:7'])
  assert.equal(await bookIntro('key', '짧은 책', null), '')
  assert.equal(await bookIntro('key', '세상에 없는 책', null), '')
})
