// 책 소개글로 토론의 첫 카드(짧은 줄거리)와 그 책만의 토론 질문을 만든다.
// Cloudflare Workers AI 의 무료 모델을 쓴다(키가 필요 없고 하루 무료 한도 안에서 돈다).
// 모델이 책을 "기억해서" 쓰게 두면 없는 인물을 지어낸다(무료 모델 넷에게 『모순』을 물었더니 셋은 모른다고 했고 하나는 지어냈다).
// 그래서 예스24 책 소개에 나온 내용만 근거로 쓰게 한다. 결말은 소개에 없으니 카드에도 나오지 않는다.
const MODEL = '@cf/openai/gpt-oss-120b'
export const INTRO_CAT = '이 책은' // 덱 맨 앞: "이런 이야기였죠" 하고 줄거리를 짧게 되짚는 카드
export const BOOK_CAT = '이 책의 질문'
const KIND = { fiction: '소설', nonfiction: '비문학', essay: '에세이' }

const SYSTEM = `너는 친한 친구 셋이 하는 독서 모임의 진행자다. 책을 다 읽고 모인 친구들에게 먼저 이 책이 어떤 내용이었는지 짧게 되짚어 주고(summary), 질문 하나로 10분 넘게 이야기할 수 있는 토론 질문을 쓴다(questions).

summary
- '책 소개'만 가지고 이 책이 어떤 이야기인지(비문학이면 무엇을 말하는 책인지) 2~3문장, 150자 안팎으로 간추린다.
- 누가 나오고 무슨 일을 겪는지가 드러나게 쓴다. 광고 문구(베스트셀러, 화제작, 수상 내역)는 옮기지 않는다.
- 모임에서 소리 내어 읽을 글이다. '~예요', '~해요'로 끝나는 부드러운 존댓말로 쓴다.

questions 를 쓸 때 지킬 것
- 아래 '책 소개'에 나온 인물, 관계, 사건, 주장만 근거로 삼는다. 소개에 없는 이름이나 사건, 결말은 지어내지 않는다.
- 이 책에만 쓸 수 있는 질문을 쓴다. 인물 이름이나 책의 주장을 질문에 직접 넣는다.
- 읽은 사람 자신의 생각을 묻는다. 사람마다 답이 갈려야 한다. 질문은 아래 세 가지 꼴 가운데 하나로 쓴다.
  1) 나라면: "내가 ○○라면 …했을까요?" (반드시 '내가'로 시작한다)
  2) 판단: "○○의 선택은 옳았을까요?", "○○의 삶은 불행하기만 했을까요?"
  3) 주장: "'…'라는 책의 말에 동의하나요?"
- 인물을 주어로 그 속마음이나 앞날을 맞히게 하는 질문("○○는 어떻게 느꼈을까요", "○○는 어떻게 해야 할까요")은 쓰지 않는다.
- 책 소개에 적히지 않은 일을 일어난 것처럼 전제하지 않는다(누가 무엇을 포기했다, 목표를 이뤘다, 결국 누구를 골랐다 등). 2) 판단 꼴은 소개에 그 인물이 실제로 한 일이나 살아가는 방식이 적혀 있을 때만 쓰고, 고민이나 갈림길만 나와 있으면 1) 나라면 꼴로 묻는다.
- 책을 평가하는 질문(재미, 별점, 추천, 문체)과 줄거리를 확인하는 질문은 쓰지 않는다.
- q 와 more 는 모두 존댓말이고 반드시 '요?'로 끝난다(…했을까요?, …인가요?, …동의하나요?). 반말(…할까?, …해?)은 쓰지 않는다.
- 읽는 사람은 '나'라고 쓴다(내가 ○○라면, 나라면). '너', '당신', '~하시나요'는 쓰지 않는다.
- q 는 한 문장, 50자 안팎으로 짧게. 책 소개를 길게 되풀이하지 않는다.
- more 는 이야기가 멈췄을 때 이어서 물을 한 문장, 40자 안팎.
- choices 는 둘이나 셋 가운데 고르게 할 수 있을 때만 넣고(각 10자 이내), 아니면 빈 배열.
- 질문은 5개. 서로 다른 인물이나 주제를 다룬다.
- hero: 소설이면 책 소개에 이름이 나오는 중심 인물(주인공)의 이름을 소개에 적힌 그대로 반드시 적는다. 소설이 아니거나 소개에 인물 이름이 없을 때만 빈 문자열.

좋은 질문의 예 (다른 책)
{"q": "내가 싱클레어라면 크로머에게 사실대로 털어놓았을까요?", "more": "털어놓지 못하게 막는 것은 무엇이었을까요?", "choices": ["털어놓는다", "숨긴다"]}
{"q": "집을 떠나 데미안을 따른 싱클레어의 선택은 옳았을까요?", "more": "나라면 무엇 때문에 망설였을까요?", "choices": ["옳았다", "옳지 않았다"]}
{"q": "'가난은 개인의 책임이 아니다'라는 저자의 말에 동의하나요?", "more": "내 주변에서 그 말이 맞지 않았던 경우가 있었나요?", "choices": ["동의한다", "동의하기 어렵다"]}

JSON 만 답한다: {"summary": "", "hero": "", "questions": [{"q": "", "more": "", "choices": []}]}`

export const askMessages = ({ title, author, genre, intro }) => [
  { role: 'system', content: SYSTEM },
  { role: 'user', content: `책: 『${title}』 (${[author, KIND[genre] ?? '소설'].filter(Boolean).join(', ')})\n\n책 소개:\n${intro}` },
]

// 모델의 답을 카드 문구로 바꾼다. 형식이 어긋난 것은 버린다. 카드 문법에 쓰는 [ ] { } 와 줄바꿈은 지운다.
// 앱의 다른 카드와 말투가 어긋나지 않게, 존댓말(…요?)로 끝나지 않는 질문은 버리고 이어 묻는 말은 뗀다.
const polite = (s) => /요[?.!]*$/.test(s)
// 모델이 자주 쓰는 '당신', '~하시나요'를 다른 카드처럼 '나', '~하나요'로 바꾼다.
const YOU = { 당신이라면: '나라면', 당신은: '나는', 당신을: '나를', 당신이: '내가', 당신과: '나와', 당신: '나' }
const soften = (s) => s.replace(/당신(이라면|[은을이과])?/g, (m) => YOU[m]).replace(/([하보])시나요/g, '$1나요')
export function toCards(answer) {
  const text = String(answer ?? '')
  let data
  try {
    data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  } catch {
    return { summary: null, hero: null, cards: [] }
  }
  const line = (v, max) => (typeof v === 'string' ? v.replace(/[[\]{}\s]+/g, ' ').trim().slice(0, max) : '')
  const cards = (Array.isArray(data?.questions) ? data.questions : [])
    .map((x) => {
      const q = soften(line(x?.q, 120))
      const choices = (Array.isArray(x?.choices) ? x.choices : []).map((c) => line(c, 16)).filter(Boolean).slice(0, 3)
      const more = soften(line(x?.more, 100))
      return polite(q) && [q + (choices.length > 1 ? ` [${choices.join(' / ')}]` : ''), polite(more) && more].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .slice(0, 6)
  const summary = line(data?.summary, 300)
  return { summary: summary.length >= 20 ? summary : null, hero: line(data?.hero, 20) || null, cards }
}

// book: { title, author, genre, intro }.  → { summary: 짧은 줄거리, hero: 주인공 이름, cards: [질문 카드 문구] }
export async function askBook(ai, book) {
  const out = await ai.run(MODEL, { messages: askMessages(book), max_tokens: 2000, temperature: 0.3, reasoning_effort: 'low' })
  const made = toCards(out?.choices?.[0]?.message?.content ?? out?.response)
  // 주인공 이름은 책 소개에 실제로 나온 것만 믿는다.
  return { ...made, hero: made.hero && book.intro.includes(made.hero) ? made.hero : null }
}
