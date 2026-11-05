import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pct, stageOf, phaseOf, todayKST, unanimous, crownOf, nextPicker, fame,
} from '../public/rules.js'

test('pct: 다 읽어야만 100', () => {
  assert.equal(pct(0, 300), 0)
  assert.equal(pct(299, 300), 99)
  assert.equal(pct(300, 300), 100)
  assert.equal(pct(999, 300), 100)
  assert.equal(pct(10, 0), 0)
  assert.equal(pct(10, null), 0)
})

test('stageOf: 30/50/70/100 에서 진화', () => {
  assert.deepEqual([0, 29, 30, 49, 50, 69, 70, 99, 100].map(stageOf), [0, 0, 1, 1, 2, 2, 3, 3, 4])
})

test('phaseOf: 책 선정 → 날짜 정하기 → 읽기 → 토론일 → 종료', () => {
  const today = '2026-11-05'
  assert.equal(phaseOf({ title: null }, today), 'picking')
  assert.equal(phaseOf({ title: '모순', discussion_date: null }, today), 'scheduling')
  assert.equal(phaseOf({ title: '모순', discussion_date: '2026-11-20' }, today), 'reading')
  assert.equal(phaseOf({ title: '모순', discussion_date: '2026-11-05' }, today), 'dday')
  assert.equal(phaseOf({ title: '모순', discussion_date: '2026-11-04' }, today), 'over')
})

test('todayKST: UTC 15시 이후는 한국 날짜로 다음 날', () => {
  assert.equal(todayKST(new Date('2026-11-05T14:59:00Z')), '2026-11-05')
  assert.equal(todayKST(new Date('2026-11-05T15:00:00Z')), '2026-11-06')
})

test('unanimous: 전원 확정 전에는 null', () => {
  const avail = [
    { user_id: 1, dates: ['2026-11-20'], confirmed: 1 },
    { user_id: 2, dates: ['2026-11-20'], confirmed: 0 },
  ]
  assert.equal(unanimous(avail, [1, 2, 3], '2026-11-05'), null)
})

test('unanimous: 전원이 고른 미래 날짜만, 정렬해서', () => {
  const avail = [
    { user_id: 1, dates: ['2026-11-22', '2026-11-20', '2026-11-05', '2026-11-01'], confirmed: 1 },
    { user_id: 2, dates: ['2026-11-20', '2026-11-22', '2026-11-05', '2026-11-25'], confirmed: 1 },
    { user_id: 3, dates: ['2026-11-01', '2026-11-05', '2026-11-22', '2026-11-20'], confirmed: 1 },
  ]
  // 11-05 는 오늘이라 제외, 11-01 은 과거 + 2번이 안 골랐음
  assert.deepEqual(unanimous(avail, [1, 2, 3], '2026-11-05'), ['2026-11-20', '2026-11-22'])
})

test('unanimous: 겹치는 날이 없으면 빈 배열', () => {
  const avail = [
    { user_id: 1, dates: ['2026-11-20'], confirmed: 1 },
    { user_id: 2, dates: ['2026-11-21'], confirmed: 1 },
  ]
  assert.deepEqual(unanimous(avail, [1, 2], '2026-11-05'), [])
})

test('crownOf: 가장 먼저 완독한 사람, 없으면 null', () => {
  assert.equal(crownOf([]), null)
  assert.equal(crownOf([{ user_id: 1, finished_at: null }]), null)
  assert.equal(crownOf([
    { user_id: 1, finished_at: 300 },
    { user_id: 2, finished_at: 100 },
    { user_id: 3, finished_at: null },
  ]), 2)
})

test('nextPicker: 순번대로 돌고 마지막 다음은 처음', () => {
  const users = [{ id: 7, ord: 2 }, { id: 5, ord: 0 }, { id: 6, ord: 1 }]
  assert.equal(nextPicker(users, 5), 6)
  assert.equal(nextPicker(users, 6), 7)
  assert.equal(nextPicker(users, 7), 5)
  assert.equal(nextPicker(users, null), 5) // 첫 사이클
})

test('fame: 우승 횟수와 완독 권수(모임 도서 + 개인 책)', () => {
  const users = [{ id: 1 }, { id: 2 }]
  const cycles = [{ id: 1, closed: 1, winner_id: 2 }, { id: 2, closed: 1, winner_id: 2 }, { id: 3, closed: 0, winner_id: null }]
  const progress = [
    { cycle_id: 1, user_id: 1, finished_at: 5 },
    { cycle_id: 1, user_id: 2, finished_at: 3 },
    { cycle_id: 2, user_id: 1, finished_at: null },
  ]
  const books = [{ user_id: 1, finished_at: 9 }, { user_id: 1, finished_at: null }, { user_id: 2, finished_at: 9 }]
  assert.deepEqual(fame(users, cycles, progress, books), [
    { user_id: 1, wins: 0, read: 2 },
    { user_id: 2, wins: 2, read: 2 },
  ])
  // 지금 읽는 책(3)을 1번이 먼저 다 읽으면, 책이 마감되기 전에도 바로 한 번으로 센다
  const reading = [...progress, { cycle_id: 3, user_id: 2, finished_at: 8 }, { cycle_id: 3, user_id: 1, finished_at: 7 }]
  assert.deepEqual(fame(users, cycles, reading, books).map((r) => r.wins), [1, 2])
})

// ---- 토론 카드 덱 ----
import { buildDeck, drawCard } from '../src/deck.js'

test('buildDeck: 워밍업 2 → 밑줄·해석·입장·입장·연결 → 마무리 2~3, 중복 없음', () => {
  for (const genre of ['fiction', 'nonfiction', 'essay', '모르는 장르'])
    for (let i = 0; i < 200; i++) {
      const deck = buildDeck(genre)
      assert.deepEqual(deck.slice(0, 2).map((c) => c.sec), [0, 0])
      assert.deepEqual(deck.filter((c) => c.sec === 1).map((c) => c.cat), ['밑줄', '해석', '입장', '입장', '연결'])
      const closing = deck.slice(7)
      assert.ok(closing.length === 2 || closing.length === 3)
      assert.ok(closing.every((c) => c.sec === 2))
      assert.equal(closing.at(-1).cat, '한줄평')
      assert.equal(new Set(deck.map((c) => c.body)).size, deck.length)
      assert.ok(deck.every((c) => c.body && c.cat && Object.keys(c).length === 3))
    }
})

test('drawCard: 덱에 없는 카드만 뽑고, 다 뽑으면 null', () => {
  const have = new Set(buildDeck('fiction').map((c) => c.body))
  for (let card; (card = drawCard('fiction', have)); have.add(card.body)) assert.ok(!have.has(card.body))
  assert.equal(drawCard('fiction', have), null)
})

// ---- 책 찾기 (예스24 응답 → 우리 형식) ----
import { cleanAuthor, genreOf, toBook } from '../src/books.js'

test('cleanAuthor: 역할 표기와 옮긴이를 떼어 낸다', () => {
  assert.equal(cleanAuthor('양귀자'), '양귀자')
  assert.equal(cleanAuthor('양귀자 저'), '양귀자')
  assert.equal(cleanAuthor('유발 하라리 저/조현욱 역/이태수 감수'), '유발 하라리')
  assert.equal(cleanAuthor('김가, 이나 공저'), '김가, 이나')
  assert.equal(cleanAuthor('로버트 C. 마틴'), '로버트 C. 마틴')
  assert.equal(cleanAuthor(undefined), '')
})

test('genreOf: 분류명으로 종류를 짐작하고, 모르면 null', () => {
  assert.equal(genreOf('한국소설'), 'fiction')
  assert.equal(genreOf('에세이'), 'essay')
  assert.equal(genreOf('인문'), 'nonfiction')
  assert.equal(genreOf('국내도서'), null)
  assert.equal(genreOf(undefined), null)
})

test('toBook: 쪽수는 양수일 때만, 표지·링크는 예스24 주소만', () => {
  const item = { itemId: 11681152, title: ' 클린 코드 ', author: '로버트 C. 마틴 저/박재호 역', publisher: '인사이트', publishDate: '2013-12-24',
    cover: 'https://image.yes24.com/goods/11681152/XL', link: 'https://www.yes24.com/product/goods/11681152', goodsSortNm: 'IT 모바일', pages: 584 }
  assert.deepEqual(toBook(item), { id: 11681152, title: '클린 코드', author: '로버트 C. 마틴', publisher: '인사이트', year: '2013',
    cover: 'https://image.yes24.com/goods/11681152/XL', link: 'https://www.yes24.com/product/goods/11681152', genre: 'nonfiction', pages: 584 })
  const odd = toBook({ itemId: 7, title: 'x', cover: 'https://evil.example/a.jpg', link: 'javascript:alert(1)', pages: 0 })
  assert.deepEqual([odd.cover, odd.link, odd.pages, odd.year], ['', 'https://www.yes24.com/product/goods/7', null, ''])
})
