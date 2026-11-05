// 거북이 도서관 화면. 서버가 주는 전체 상태(S)를 받아 그대로 다시 그린다.
import { STAGES, pct, stageOf, phaseOf, unanimous, crownOf, fame } from './rules.js'
import { critterSVG, mountScene, updateScene, celebrate } from './critters.js'

const $ = (sel, root = document) => root.querySelector(sel)
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])

const app = $('#app')
const sheet = $('#sheet')

const TABS = [
  ['home', '🐢', '도서관'],
  ['notes', '✏️', '기록'],
  ['talk', '💬', '토론장'],
  ['shelf', '📚', '서재'],
  ['fame', '👑', '명예'],
]
const GENRE = { fiction: '소설', nonfiction: '비문학', essay: '에세이·시' }
const KIND = { review: '한줄평', memo: '메모', quote: '구절' }
const COLORS = { peach: '살구', mint: '민트', sky: '하늘', lemon: '레몬', lilac: '라일락', rose: '장미' }
const COVERS = [
  ['#ffd9c2', '#f5a983'],
  ['#cdeedd', '#86caa6'],
  ['#cfe6f7', '#84b9dd'],
  ['#fcefb4', '#e5c655'],
  ['#e2d6f7', '#ab93dc'],
  ['#fbd0da', '#e68ba5'],
  ['#dcecc0', '#a3c873'],
]

let S = null // 서버 상태
let raw = '' // 마지막으로 받은 상태(JSON 문자열). 바뀌었는지 비교한다.
let stale = false // 받아 두고 아직 화면에 안 그린 상태가 있다
let mounted = false
let busy = false
const ui = {
  tab: 'home',
  month: null, // 달력에 보이는 달 'YYYY-MM'
  dates: null, // 고르는 중인 날짜 Set
  drafts: {}, // 저장 전 쪽수 { 'cycle1': 120 }
  card: 0, // 보고 있는 토론 카드
  filter: 'all', // 기록 필터
  shelfUser: null, // 서재 주인
  open: null, // 서재에서 연 책 { key, user }
  seen: new Set(), // 스포일러 가림을 푼 메모
}

// ---------- 서버 ----------
async function call(path, body) {
  let res
  try {
    res = await fetch(`/api/${path}`, body && { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new Error('인터넷 연결을 확인해 주세요')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && path !== 'login') {
    S = null
    raw = ''
    if (sheet.open) sheet.close()
    render()
  }
  if (!res.ok) throw new Error(data.error || '문제가 생겼어요. 다시 해 주세요')
  return data
}

function setState(next, passive = false) {
  const json = JSON.stringify(next)
  if (json === raw) return
  raw = json
  S = next
  // 글을 쓰는 중이면 화면을 갈아엎지 않고 미뤄 둔다.
  if (passive && typing()) stale = true
  else render()
}

// 시트가 열려 있거나, 입력 칸에 커서가 있거나, 책 고르는 폼에 적어 둔 값이 있으면 '쓰는 중'으로 본다.
const typing = () =>
  sheet.open ||
  $('#view :is(input, textarea, select):focus') ||
  [...document.querySelectorAll('#view form :is(input:not([type=radio]), textarea)')].some((el) => el.value)

// 변경 요청 → 새 상태 반영. 실패하면 이유를 알려 주고 false.
async function act(path, body, done) {
  try {
    setState(await call(path, body))
    if (done) toast(done)
    return true
  } catch (e) {
    toast(e.message, true)
    return false
  }
}

async function refresh() {
  if (!S || document.hidden || busy) return
  try {
    setState(await call('state'), true)
  } catch {
    // 조용히 넘어간다. 다음 주기에 다시 시도한다.
  }
}

// ---------- 상태에서 뽑아 쓰는 값 ----------
const user = (id) => S.users.find((u) => u.id === id)
const cur = () => S.cycles.find((c) => !c.closed)
const readOf = (cycleId, userId) => S.progress.find((p) => p.cycle_id === cycleId && p.user_id === userId)?.pages_read ?? 0

function members() {
  const c = cur()
  const crowned = crownOf(S.progress.filter((p) => p.cycle_id === c.id))
  return S.users.map((u) => {
    const pages = readOf(c.id, u.id)
    const percent = pct(pages, c.pages)
    return { ...u, pages, percent, stage: stageOf(percent), crown: crowned === u.id, me: u.id === S.me.id }
  })
}

const dateOf = (s) => new Date(`${s}T00:00:00Z`)
const addDays = (s, n) => new Date(dateOf(s).getTime() + n * 86400e3).toISOString().slice(0, 10)
const daysUntil = (s) => Math.round((dateOf(s) - dateOf(S.today)) / 86400e3)
const dayFmt = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' })
const fmtDate = (s) => dayFmt.format(dateOf(s))
const stampFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' })
const fmtStamp = (ms) => stampFmt.format(ms)

const coverOf = (title) => COVERS[[...title].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 7) % COVERS.length]
const cover = (title, cls = '') => {
  const [bg, spine] = coverOf(title)
  return `<span class="cover ${cls}" style="--cv:${bg};--cs:${spine}"><span>${esc(title)}</span></span>`
}
const stars = (n) => `<span class="stars" aria-label="별점 ${n}점">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`

// ---------- 그리기 ----------
function render() {
  stale = false
  if (!S) {
    mounted = false
    app.innerHTML = loginView()
    return
  }
  if (!mounted) {
    app.innerHTML = `
      <header class="top" id="top"></header>
      <section id="lobby" hidden><div class="chips" id="pages"></div><div class="scene" id="scene"></div></section>
      <main id="view"></main>
      <nav class="tabs" id="tabs" aria-label="메뉴"></nav>`
    mountScene($('#scene'))
    mounted = true
  }
  const c = cur()
  const ms = members()
  const me = ms.find((m) => m.me)
  $('#top').innerHTML = `
    <h1><span aria-hidden="true">🐢</span> 거북이 도서관</h1>
    <button class="me c-${me.color}" data-act="profile" aria-label="내 정보">${critterSVG(me.stage, me.crown)}<span>${esc(me.name)}</span></button>`
  $('#tabs').innerHTML = TABS.map(
    ([id, icon, label]) =>
      `<button data-act="tab" data-tab="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</button>`,
  ).join('')
  $('#lobby').hidden = ui.tab !== 'home'
  updateScene(ms, STAGES.map((s) => s.name))
  $('#pages').innerHTML = c.title
    ? ms.map((m) => `<span class="chip c-${m.color}"><i></i>${esc(m.name)} <b>${m.pages}쪽</b>${m.crown ? ' 👑' : ''}</span>`).join('')
    : ''
  $('#view').innerHTML = VIEWS[ui.tab]()

  const deck = $('#deck')
  if (deck) {
    showCard(ui.card)
    // 손으로 밀어 넘길 때 현재 카드 번호를 따라간다.
    deck.addEventListener('scroll', () => {
      const mid = deck.scrollLeft + deck.clientWidth / 2
      ui.card = Math.max(0, [...deck.children].findIndex((el) => el.offsetLeft + el.clientWidth >= mid))
      $('#deck-pos').textContent = `${ui.card + 1} / ${deck.children.length}`
    })
  }
}

// ponytail: 버튼으로 넘길 때는 애니메이션 없이 바로 옮긴다. 부드러운 스크롤은 도중의 위치가 카드 번호 계산과 엇갈린다.
// 손으로 미는 쪽은 브라우저의 scroll-snap 이 부드럽게 처리한다.
function showCard(i) {
  const deck = $('#deck')
  if (!deck?.children.length) return
  ui.card = Math.max(0, Math.min(i, deck.children.length - 1))
  const go = deck.children[ui.card]
  deck.scrollTo({ left: go.offsetLeft - (deck.clientWidth - go.clientWidth) / 2, behavior: 'instant' })
  $('#deck-pos').textContent = `${ui.card + 1} / ${deck.children.length}`
}

const loginView = () => `
  <main class="login">
    <div class="login-art c-mint">${critterSVG(0)}</div>
    <h1>거북이 도서관</h1>
    <p class="soft">느릿느릿, 한 달에 한 권. 같이 읽고 같이 이야기해요.</p>
    <form data-form="login" class="form card">
      <label>아이디<input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <label>비밀번호<input name="password" type="password" required autocomplete="current-password"></label>
      <p class="err" role="alert"></p>
      <button class="btn wide">들어가기</button>
    </form>
    <a class="link" href="guide.html">처음이신가요? 사용 가이드 보기</a>
  </main>`

const empty = (emoji, title, text) => `<section class="card center empty"><p class="emoji" aria-hidden="true">${emoji}</p><h2>${title}</h2><p class="soft">${text}</p></section>`

// ----- 도서관(홈) -----
function homeView() {
  const c = cur()
  const phase = phaseOf(c, S.today)
  const picker = user(c.picker_id)
  const mine = c.picker_id === S.me.id
  const nth = `${S.cycles.length}번째 책`
  const previous = S.cycles.findLast((item) => item.closed && item.title)
  let h = ''
  if (/^거북\d+$/.test(user(S.me.id).name))
    h += `<button class="hint" data-act="profile">👋 처음 오셨네요! 여기를 눌러 이름과 색을 정해 보세요</button>`
  else if (pushState() === 'off' && Notification.permission === 'default' && !hintSeen())
    h += `<button class="hint" data-act="push-hint">🔔 알림을 켜면 친구 소식과 토론일을 알려 드려요</button>`
  if (phase === 'picking')
    return (
      h +
      (mine
        ? `<section class="card"><p class="eyebrow">${nth} · 내가 고를 차례</p><h2>이번에 함께 읽을 책을 골라 주세요</h2>${finder()}${bookForm()}</section>`
        : `<section class="card center"><p class="eyebrow">${nth}</p><h2>${esc(picker.name)}님이 책을 고르는 중이에요</h2>
           <p class="soft">책이 정해지면 여기에 나타나요. 조금만 기다려 주세요 🐢</p></section>`) +
      (previous ? `<p class="center"><button class="link" data-act="reopen">지난 토론을 아직 못 했나요? 되돌리기</button></p>` : '')
    )
  h += `<section class="card book">
    ${cover(c.title)}
    <div>
      <p class="eyebrow">${nth} · ${esc(picker.name)}님의 선택</p>
      <h2>${esc(c.title)}</h2>
      <p class="soft">${[c.author, `${c.pages}쪽`, GENRE[c.genre]].filter(Boolean).map(esc).join(' · ')}</p>
      ${mine ? `<button class="link" data-act="edit-book">책 정보 고치기</button>` : ''}
    </div>
  </section>`
  h += phase === 'scheduling' ? calendarCard(c) : ddayCard(c, phase)
  return h + progressCard(c)
}

// 책 찾기 칸. 서버에 예스24 Open API 키가 설정돼 있을 때만 보인다. 고르면 바로 아래 폼에 제목·지은이·쪽수가 채워진다.
const finder = () =>
  S.search
    ? `<div class="find">
        <label>책 찾기 <small>제목이나 지은이로 찾아서 고르면 쪽수까지 채워져요</small>
          <span class="find-row"><input type="search" enterkeyhint="search" autocomplete="off" maxlength="50" placeholder="예: 모순">
          <button type="button" class="btn small" data-act="find">찾기</button></span></label>
        <ul class="found" hidden></ul>
      </div>`
    : ''

function bookForm(c) {
  const genre = c?.genre ?? 'fiction'
  return `<form data-form="book" class="form">
    <label>책 제목<input name="title" required maxlength="100" value="${esc(c?.title)}" placeholder="예: 모순"></label>
    <label>지은이<input name="author" maxlength="60" value="${esc(c?.author)}" placeholder="예: 양귀자"></label>
    <label>전체 쪽수<input name="pages" type="number" inputmode="numeric" required min="1" max="5000" value="${esc(c?.pages)}" placeholder="예: 308"></label>
    <fieldset class="pick"><legend>어떤 책인가요? ${c ? '' : '<small>토론 카드가 여기에 맞춰져요</small>'}</legend>
      ${Object.entries(GENRE)
        .map(([k, v]) => `<label><input type="radio" name="genre" value="${k}" ${k === genre ? 'checked' : ''}><span>${v}</span></label>`)
        .join('')}
    </fieldset>
    <button class="btn wide">${c ? '고친 내용 저장' : '이 책으로 정하기'}</button>
  </form>`
}

function calendarCard(c) {
  if (ui.calFor !== c.id) Object.assign(ui, { calFor: c.id, dates: null, month: null }) // 새 책이면 고르던 날짜를 비운다
  const mine = S.avail.find((a) => a.user_id === S.me.id)
  const saved = (mine?.dates ?? []).filter((d) => d > S.today)
  ui.dates ??= new Set(saved)
  const first = addDays(S.today, 1)
  const last = addDays(S.today, 90)
  const others = S.avail.filter((a) => a.user_id !== S.me.id && a.confirmed)
  // 처음에는 누군가(나 또는 친구)가 고른 가장 이른 날이 있는 달을 보여 준다.
  const picked = [...ui.dates, ...others.flatMap((a) => a.dates)].filter((d) => d >= first && d <= last).sort()
  ui.month ??= (picked[0] ?? first).slice(0, 7)
  const [y, m] = ui.month.split('-').map(Number)
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()

  let cells = '일월화수목금토'.replace(/./g, '<span class="dow">$&</span>') + '<span></span>'.repeat(lead)
  for (let d = 1; d <= count; d++) {
    const date = `${ui.month}-${String(d).padStart(2, '0')}`
    const on = ui.dates.has(date)
    const who = others.filter((a) => a.dates.includes(date))
    const all = on && who.length === S.users.length - 1
    cells += `<button class="day${on ? ' on' : ''}${all ? ' all' : ''}" data-act="day" data-date="${date}" ${date < first || date > last ? 'disabled' : ''}
      aria-pressed="${on}" aria-label="${fmtDate(date)}, ${on ? '선택됨' : '선택 안 됨'}${who.length ? `, ${esc(who.map((a) => user(a.user_id).name).join(', '))} 가능` : ''}">
      ${d}<span class="dots">${who.map((a) => `<i class="c-${user(a.user_id).color}"></i>`).join('')}</span></button>`
  }

  const common = unanimous(S.avail, S.users.map((u) => u.id), S.today)
  const dirty = !mine?.confirmed || saved.length !== ui.dates.size || saved.some((d) => !ui.dates.has(d))
  return `<section class="card cal c-${user(S.me.id).color}">
    <p class="eyebrow">토론일 정하기</p>
    <p class="soft">모일 수 있는 날을 모두 골라 주세요. ${S.users.length}명 모두 되는 날 가운데 하루가 뽑혀요.</p>
    <div class="cal-head">
      <button data-act="month" data-d="-1" aria-label="이전 달" ${ui.month <= first.slice(0, 7) ? 'disabled' : ''}>‹</button>
      <strong>${y}년 ${m}월</strong>
      <button data-act="month" data-d="1" aria-label="다음 달" ${ui.month >= last.slice(0, 7) ? 'disabled' : ''}>›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <ul class="who">${S.users
      .map((u) => {
        const a = S.avail.find((x) => x.user_id === u.id)
        return `<li class="c-${u.color}"><i></i>${esc(u.name)} <span>${a?.confirmed ? `골랐어요 ✓` : '고르는 중…'}</span></li>`
      })
      .join('')}</ul>
    ${common && !common.length ? `<p class="warn">모두 골랐는데 겹치는 날이 없어요 😢 가능한 날을 조금 더 골라 주세요.</p>` : ''}
    <button class="btn wide" data-act="save-dates" ${dirty && ui.dates.size ? '' : 'disabled'}>
      ${!dirty ? '골랐어요 ✓ 친구들을 기다리는 중' : mine?.confirmed ? `바꾼 날짜 저장 (${ui.dates.size}일)` : `이 날짜로 확정 (${ui.dates.size}일)`}
    </button>
  </section>`
}

function ddayCard(c, phase) {
  return `<section class="card dday ${phase}">
    <p class="eyebrow">토론하는 날</p>
    <div class="row between"><strong class="big">${phase === 'dday' ? '오늘이에요! 🎉' : `D-${daysUntil(c.discussion_date)}`}</strong><span>${fmtDate(c.discussion_date)}</span></div>
    ${phase === 'dday' ? `<button class="btn wide" data-act="tab" data-tab="talk">토론장 들어가기</button>` : ''}
    <button class="link" data-act="reschedule">날짜 다시 정하기</button>
  </section>`
}

// 쪽수 입력(슬라이더 + 숫자). kind: 'cycle'(모임 도서) | 'book'(개인 책)
function progressControl(kind, id, read, total) {
  const v = ui.drafts[kind + id] ?? read
  return `<div class="prog" data-kind="${kind}" data-id="${id}" data-total="${total}">
    <input type="range" min="0" max="${total}" value="${v}" style="--p:${(v / total) * 100}%" aria-label="읽은 쪽수 슬라이더">
    <div class="row between">
      <label class="num"><input type="number" inputmode="numeric" min="0" max="${total}" value="${v}" aria-label="읽은 쪽수"> / ${total}쪽 <b class="live">${pct(v, total)}%</b></label>
      <button class="btn" data-act="save-progress">기록하기</button>
    </div>
  </div>`
}

const ladder = (stage, color) =>
  `<ol class="ladder c-${color}" aria-label="진화 단계">${STAGES.map(
    (s, i) => `<li class="${i <= stage ? 'on' : ''}${i === stage ? ' now' : ''}">${critterSVG(i)}<span>${s.min}%</span></li>`,
  ).join('')}</ol>`

function progressCard(c) {
  const u = user(S.me.id)
  const read = readOf(c.id, u.id)
  const percent = pct(read, c.pages)
  const stage = stageOf(percent)
  const next = STAGES[stage + 1]
  return `<section class="card">
    <p class="eyebrow">나의 독서</p>
    <div class="row between"><strong class="big">${read}<small> / ${c.pages}쪽</small></strong><span class="pill c-${u.color}">${percent}% · ${STAGES[stage].name}</span></div>
    ${progressControl('cycle', c.id, read, c.pages)}
    <p class="soft">${next ? `${Math.ceil((c.pages * next.min) / 100) - read}쪽만 더 읽으면 <b>${next.name}</b>로 진화해요` : '끝까지 다 읽었어요! 🎉'}</p>
    ${ladder(stage, u.color)}
  </section>`
}

// ----- 기록(메모) -----
// 스포일러 가림: 아직 열려 있는 모임 도서에서, 내가 읽은 곳보다 뒤에서 쓴 친구의 글은 가린다. 토론 당일에는 모두 보인다.
const veiled = (n, cycle) =>
  cycle && !cycle.closed && n.user_id !== S.me.id && n.page > readOf(cycle.id, S.me.id) && !ui.seen.has(n.id) && phaseOf(cycle, S.today) !== 'dday'

function noteItem(n, cycle) {
  const u = user(n.user_id)
  const mine = n.user_id === S.me.id
  const veil = veiled(n, cycle)
  return `<li class="note k-${n.kind} c-${u.color}${veil ? ' veil' : ''}${n.body.length > 220 ? ' long' : ''}">
    <header><i></i><b>${esc(u.name)}</b><span class="kind">${KIND[n.kind]}</span>${n.page ? `<span class="pg">p.${n.page}</span>` : ''}<time>${fmtStamp(n.created_at)}</time></header>
    ${veil ? '<div class="inner spoiler-shape" aria-hidden="true"><span></span><span></span><span></span></div>' : `<div class="inner">
      ${n.rating ? stars(n.rating) : ''}
      <p class="body">${esc(n.body)}</p>
      ${n.body.length > 220 ? `<button class="link" data-act="more">더 보기</button>` : ''}
      ${mine ? `<footer><button class="link" data-act="note-edit" data-id="${n.id}">고치기</button><button class="link" data-act="note-del" data-id="${n.id}">지우기</button></footer>` : ''}
    </div>`}
    ${veil ? `<button class="unveil" data-act="reveal" data-id="${n.id}">아직 안 읽은 부분의 기록이에요 (p.${n.page})<b>눌러서 보기</b></button>` : ''}
  </li>`
}

// cycle(모임 도서: 모두의 기록) 또는 book(개인 책: 주인의 기록)
function notesSection({ cycle, book }) {
  const all = S.notes.filter((n) => (cycle ? n.cycle_id === cycle.id : n.book_id === book.id)).reverse()
  const target = cycle ? `data-cycle="${cycle.id}"` : `data-book="${book.id}"`
  const canWrite = cycle || book.user_id === S.me.id
  const review = all.find((n) => n.kind === 'review' && n.user_id === S.me.id)
  const list = all.filter((n) => ui.filter === 'all' || n.kind === ui.filter)
  return `<section class="notes">
    ${
      canWrite
        ? `<div class="write">
            <button class="btn small" data-act="note-new" data-kind="memo" ${target}>✏️ 메모</button>
            <button class="btn small" data-act="note-new" data-kind="quote" ${target}>❝ 구절</button>
            <button class="btn small" ${review ? `data-act="note-edit" data-id="${review.id}"` : `data-act="note-new" data-kind="review" ${target}`}>⭐ 한줄평${review ? ' 고치기' : ''}</button>
          </div>`
        : ''
    }
    ${
      all.length
        ? `<div class="seg" role="group" aria-label="기록 종류">${[['all', '전체'], ...Object.entries(KIND)]
            .map(([k, v]) => `<button data-act="filter" data-f="${k}" aria-pressed="${ui.filter === k}">${v} ${k === 'all' ? all.length : all.filter((n) => n.kind === k).length}</button>`)
            .join('')}</div>
          <ul class="note-list">${list.map((n) => noteItem(n, cycle)).join('') || '<li class="soft center">이 종류의 기록은 아직 없어요</li>'}</ul>`
        : `<p class="soft center pad">${canWrite ? '아직 기록이 없어요. 읽다가 떠오른 생각이나 마음에 남은 문장을 적어 보세요.' : '아직 기록이 없어요.'}</p>`
    }
  </section>`
}

function notesView() {
  const c = cur()
  if (!c.title) return empty('✏️', '아직 이번 책이 없어요', '책이 정해지면 읽으면서 메모와 구절을 남길 수 있어요.')
  return `<h2 class="title">『${esc(c.title)}』 기록</h2>
    <p class="soft lead">읽다가 든 생각, 밑줄 긋고 싶은 문장을 남겨요. 친구가 나보다 뒤쪽에서 쓴 기록은 가려져요.</p>
    ${notesSection({ cycle: c })}`
}

// ----- 토론장 -----
// 본 질문 카드 아래에 돌아가며 붙는 한 줄. "좋았어"에서 멈추지 않고 책의 대목으로 돌아가게 한다.
const FOLLOW = [
  '그 생각이 시작된 쪽을 펴서 한 문단만 읽어 줄래요?',
  '좋았다면(별로였다면) 무엇이 그랬나요? 문장, 속도, 인물이나 주장, 결말 가운데서 골라 봐요.',
  '방금 쓴 그 표현을 다른 말로 풀면 무슨 뜻인가요?',
  '같은 대목을 다르게 읽은 사람이 있나요?',
  '방금 들은 말에서 동의하는 부분과 동의하기 어려운 부분은 각각 어디인가요?',
  '그 점이 이 책 전체에서 왜 중요한가요?',
  '그렇게 보면 책의 다른 대목과도 맞아떨어지나요?',
  '처음 든 생각과 지금 생각이 달라졌나요?',
]
// 카드 문구 속 [가 / 나] 는 고르는 선택지 칩으로 보여 준다.
const withChoices = (html) =>
  html.replace(/\[([^\]\n]+)\]/g, (_, s) => `<span class="opts">${s.split(' / ').map((o) => `<b>${o}</b>`).join('')}</span>`)

function cueCard(q, i, total, c) {
  const [main, ...sub] = withChoices(esc(q.body)).split('\n')
  const author = q.user_id && user(q.user_id)
  let extra = ''
  if (q.cat === '한줄평') {
    const reviews = S.notes.filter((n) => n.cycle_id === c.id && n.kind === 'review')
    const mine = reviews.find((n) => n.user_id === S.me.id)
    extra = `<ul class="mini">${S.users
      .map((u) => {
        const r = reviews.find((n) => n.user_id === u.id)
        return `<li class="c-${u.color}"><i></i><b>${esc(u.name)}</b> ${!r ? '<span class="soft">아직 안 썼어요</span>' : veiled(r, c) ? '<span class="soft">썼어요 · 내가 더 읽으면 보여요</span>' : `${r.rating ? stars(r.rating) : ''} <span>${esc(r.body)}</span>`}</li>`
      })
      .join('')}</ul>
      <button class="btn small" ${mine ? `data-act="note-edit" data-id="${mine.id}"` : `data-act="note-new" data-kind="review" data-cycle="${c.id}"`}>⭐ 내 한줄평 ${mine ? '고치기' : '쓰기'}</button>`
  }
  if (q.cat === '밑줄') {
    const quotes = S.notes.filter((n) => n.cycle_id === c.id && n.kind === 'quote')
    if (quotes.length) extra = `<ul class="note-list">${quotes.map((n) => noteItem(n, c)).join('')}</ul>`
  }
  const removable = !q.user_id || q.user_id === S.me.id
  return `<article class="cue sec${q.sec}${author ? ` ours c-${author.color}` : ''}" aria-label="카드 ${i + 1}">
    <header><span class="cat">${esc(q.cat)}</span><span>${i + 1} / ${total}</span></header>
    <div class="mid">
      <p class="q">${main}</p>
      ${sub.length ? `<p class="sub">${sub.join('<br>')}</p>` : ''}
      ${extra}
    </div>
    ${q.sec === 1 ? `<p class="follow"><b>더 물어보기</b>${FOLLOW[i % FOLLOW.length]}</p>` : ''}
    <footer><span>${author ? `${esc(author.name)}님의 질문` : '기본 카드'}</span>${removable ? `<button class="link" data-act="del-q" data-id="${q.id}">이 카드 빼기</button>` : ''}</footer>
  </article>`
}

function talkView() {
  const c = cur()
  if (!c.title) return empty('💬', '아직 이번 책이 없어요', '책이 정해지면 토론 카드가 준비돼요.')
  const cards = S.questions.filter((q) => q.cycle_id === c.id)
  ui.card = Math.max(0, Math.min(ui.card, cards.length - 1))
  return `<h2 class="title">『${esc(c.title)}』 토론장</h2>
    <div class="deck" id="deck">${cards.map((q, i) => cueCard(q, i, cards.length, c)).join('')}</div>
    <div class="deck-nav">
      <button class="btn ghost" data-act="card" data-d="-1" aria-label="이전 카드">‹ 이전</button>
      <span id="deck-pos">${cards.length ? ui.card + 1 : 0} / ${cards.length}</span>
      <button class="btn ghost" data-act="card" data-d="1" aria-label="다음 카드">다음 ›</button>
    </div>
    <div class="row">
      <button class="btn grow" data-act="add-q">＋ 내 질문 추가</button>
      <button class="btn ghost grow" data-act="draw-q">🎲 한 장 더 뽑기</button>
    </div>`
}

// ----- 서재 -----
function shelfItems(uid) {
  const club = S.cycles
    .filter((c) => c.title)
    .map((c) => {
      const p = S.progress.find((x) => x.cycle_id === c.id && x.user_id === uid)
      return { key: `c${c.id}`, cycle: c, title: c.title, author: c.author, pages: c.pages, read: p?.pages_read ?? 0, done: p?.finished_at ?? null, at: c.created_at }
    })
  const own = S.books
    .filter((b) => b.user_id === uid)
    .map((b) => ({ key: `b${b.id}`, book: b, title: b.title, author: b.author, pages: b.pages, read: b.pages_read, done: b.finished_at, at: b.created_at }))
  // 읽는 중인 책이 먼저, 그 안에서는 최근 것이 먼저.
  return [...club, ...own].sort((a, b) => !!a.done - !!b.done || (b.done ?? b.at) - (a.done ?? a.at))
}

function shelfView() {
  const uid = ui.shelfUser ?? S.me.id
  const owner = user(uid) ?? user(S.me.id)
  const items = shelfItems(owner.id)
  if (ui.open) {
    const it = shelfItems(ui.open.user).find((x) => x.key === ui.open.key)
    if (it) return bookDetail(it, user(ui.open.user))
    ui.open = null
  }
  const mine = owner.id === S.me.id
  const doneCount = items.filter((x) => x.done).length
  return `<div class="chips pickers">${S.users
    .map((u) => `<button class="chip c-${u.color}" data-act="shelf-user" data-id="${u.id}" aria-pressed="${u.id === owner.id}"><i></i>${esc(u.name)}</button>`)
    .join('')}</div>
    <h2 class="title">${mine ? '나의 서재' : `${esc(owner.name)}님의 서재`}</h2>
    <p class="soft lead">완독 <b>${doneCount}권</b> · 읽는 중 <b>${items.length - doneCount}권</b></p>
    ${mine ? `<button class="btn wide" data-act="shelf-add">＋ 읽는 책 추가</button>` : ''}
    ${
      items.length
        ? `<div class="shelf">${items
            .map(
              (it) => `<button class="vol${it.done ? ' done' : ''}" data-act="open-book" data-key="${it.key}" data-user="${owner.id}">
                ${cover(it.title)}
                ${it.cycle ? '<span class="badge">모임</span>' : ''}${it.done ? '<span class="stamp">완독</span>' : ''}
                <b>${esc(it.title)}</b>
                <span class="bar"><i style="width:${pct(it.read, it.pages)}%"></i></span>
                <small>${it.done ? `${fmtStamp(it.done)} 완독` : `${it.read} / ${it.pages}쪽 · ${pct(it.read, it.pages)}%`}</small>
              </button>`,
            )
            .join('')}</div>`
        : `<p class="soft center pad">${mine ? '아직 책이 없어요. 모임 책 말고 따로 읽는 책도 여기에 모아 보세요.' : '아직 책이 없어요.'}</p>`
    }`
}

function bookDetail(it, owner) {
  const mine = owner.id === S.me.id
  const cards = it.cycle ? S.questions.filter((q) => q.cycle_id === it.cycle.id) : []
  return `<button class="link back" data-act="back">‹ ${mine ? '나의 서재' : `${esc(owner.name)}님의 서재`}</button>
    <section class="card book${it.done ? ' done' : ''}">
      ${cover(it.title)}
      <div>
        <p class="eyebrow">${it.cycle ? `모임 도서 · ${esc(user(it.cycle.picker_id).name)}님의 선택` : `${esc(owner.name)}님의 책`}</p>
        <h2>${esc(it.title)}</h2>
        <p class="soft">${[it.author, `${it.pages}쪽`].filter(Boolean).map(esc).join(' · ')}</p>
        <p class="soft">${it.done ? `<span class="pill gold">완독 · ${fmtStamp(it.done)}</span>` : `${it.read} / ${it.pages}쪽 · ${pct(it.read, it.pages)}%`}</p>
      </div>
    </section>
    ${
      mine
        ? `<section class="card"><p class="eyebrow">어디까지 읽었나요?</p>${progressControl(it.cycle ? 'cycle' : 'book', it.cycle?.id ?? it.book.id, it.read, it.pages)}
            ${it.book ? `<div class="row end"><button class="link" data-act="shelf-edit" data-id="${it.book.id}">책 정보 고치기</button><button class="link" data-act="shelf-del" data-id="${it.book.id}">서재에서 빼기</button></div>` : ''}</section>`
        : ''
    }
    ${
      it.cycle?.closed && cards.length
        ? `<details class="card"><summary>그날의 토론 카드 ${cards.length}장</summary><ol class="past">${cards
            .map((q) => `<li>${esc(q.body).split('\n')[0]}</li>`)
            .join('')}</ol></details>`
        : ''
    }
    <h3 class="title">기록</h3>
    ${notesSection(it.cycle ? { cycle: it.cycle } : { book: it.book })}`
}

// ----- 명예의 전당 -----
function fameView() {
  const rows = fame(S.users, S.cycles, S.progress, S.books).map((r) => ({ ...r, u: user(r.user_id) }))
  const ms = members()
  const board = (key, unit) => {
    const sorted = [...rows].sort((a, b) => b[key] - a[key])
    const max = sorted[0][key] || 1
    return sorted
      .map((r) => {
        const rank = sorted.findIndex((x) => x[key] === r[key]) // 같은 수면 같은 등수
        return `<li class="c-${r.u.color}"><span class="rank">${r[key] ? (['🥇', '🥈', '🥉'][rank] ?? rank + 1) : '·'}</span>
          <span class="ava">${critterSVG(ms.find((m) => m.id === r.u.id).stage)}</span><b>${esc(r.u.name)}</b>
          <span class="meter"><i style="width:${(r[key] / max) * 100}%"></i></span><strong>${r[key]}${unit}</strong></li>`
      })
      .join('')
  }
  const past = S.cycles.filter((c) => c.closed && c.title).reverse()
  return `<h2 class="title">명예의 전당</h2>
    <section class="card"><p class="eyebrow">👑 빨리 읽기 왕</p><p class="soft">모임 책을 가장 먼저 다 읽은 횟수예요.</p><ol class="board">${board('wins', '회')}</ol></section>
    <section class="card"><p class="eyebrow">📚 다독왕</p><p class="soft">모임 책과 서재의 책을 합쳐 끝까지 읽은 권수예요.</p><ol class="board">${board('read', '권')}</ol></section>
    <section class="card"><p class="eyebrow">함께 읽은 책</p>
      ${
        past.length
          ? `<ul class="past-books">${past
              .map(
                (c) => `<li><button data-act="open-book" data-key="c${c.id}" data-user="${S.me.id}">${cover(c.title, 'tiny')}
                  <span><b>${esc(c.title)}</b><small>${fmtDate(c.discussion_date)} 토론 · ${esc(user(c.picker_id).name)}님의 선택</small>
                  <small>${c.winner_id ? `👑 ${esc(user(c.winner_id).name)}님이 가장 먼저 완독` : '완독한 사람이 없었어요'}</small></span></button></li>`,
              )
              .join('')}</ul>`
          : `<p class="soft">첫 토론을 마치면 여기에 쌓여요.</p>`
      }
    </section>`
}

const VIEWS = { home: homeView, notes: notesView, talk: talkView, shelf: shelfView, fame: fameView }

// ---------- 시트(아래에서 올라오는 창) ----------
function openSheet(html) {
  sheet.innerHTML = `<div class="sheet-body"><button class="x" data-act="close" aria-label="닫기">✕</button>${html}</div>`
  if (!sheet.open) sheet.showModal()
}
sheet.addEventListener('click', (e) => e.target === sheet && sheet.close()) // 바깥을 누르면 닫힌다
sheet.addEventListener('close', () => {
  sheet.innerHTML = ''
  if (stale) render()
})

let onYes = null
function confirmSheet(title, text, yes, fn) {
  onYes = fn
  openSheet(`<h2>${title}</h2><p class="soft">${text}</p>
    <div class="row"><button class="btn ghost grow" data-act="close">아니요</button><button class="btn grow" data-act="yes">${yes}</button></div>`)
}

function noteSheet({ kind, note, cycle, book }) {
  kind = note?.kind ?? kind
  const hint = {
    review: '이 책을 한 문장으로 말한다면?',
    memo: '읽다가 든 생각을 자유롭게 적어 보세요',
    quote: '마음에 남은 문장을 옮겨 적어 보세요',
  }[kind]
  openSheet(`<form data-form="note" class="form">
    <h2>${{ review: '한줄평', memo: '메모', quote: '인상 깊은 구절' }[kind]} ${note ? '고치기' : '남기기'}</h2>
    <input type="hidden" name="kind" value="${kind}">
    ${note ? `<input type="hidden" name="id" value="${note.id}">` : `<input type="hidden" name="${cycle ? 'cycle_id' : 'book_id'}" value="${cycle ?? book}">`}
    ${
      kind === 'review'
        ? `<fieldset><legend>별점</legend><div class="rate">${[5, 4, 3, 2, 1]
            .map((n) => `<input type="radio" name="rating" id="star${n}" value="${n}" ${note?.rating === n ? 'checked' : ''}><label for="star${n}" aria-label="${n}점">★</label>`)
            .join('')}</div></fieldset>`
        : ''
    }
    <label><span class="sr">내용</span><textarea name="body" required rows="${kind === 'review' ? 3 : 7}" maxlength="${kind === 'review' ? 200 : 5000}" placeholder="${hint}">${esc(note?.body)}</textarea></label>
    ${kind === 'review' ? '' : `<label>쪽수 <small>(비워 두면 지금 읽는 쪽으로 적혀요)</small><input name="page" type="number" inputmode="numeric" min="1" max="5000" value="${esc(note?.page)}"></label>`}
    <button class="btn wide">저장</button>
  </form>`)
}

function profileSheet() {
  const u = user(S.me.id)
  openSheet(`<form data-form="profile" class="form">
    <h2>내 정보</h2>
    <label>이름 <small>(8자까지)</small><input name="name" required maxlength="8" value="${esc(u.name)}"></label>
    <fieldset class="swatches"><legend>내 색</legend>${Object.entries(COLORS)
      .map(([k, v]) => `<label class="c-${k}"><input type="radio" name="color" value="${k}" ${k === u.color ? 'checked' : ''}><span aria-label="${v}"></span></label>`)
      .join('')}</fieldset>
    <button class="btn wide">저장</button>
  </form>
  ${pushSection()}
  <details class="more"><summary>비밀번호 바꾸기</summary>
    <form data-form="password" class="form">
      <label>지금 비밀번호<input name="old" type="password" required autocomplete="current-password"></label>
      <label>새 비밀번호 <small>(6자 이상)</small><input name="next" type="password" required minlength="6" autocomplete="new-password"></label>
      <button class="btn wide ghost">비밀번호 바꾸기</button>
    </form>
  </details>
  <p class="soft center">아이디 <b>${esc(S.me.username)}</b> · <button class="link" data-act="logout">로그아웃</button> · <a class="link" href="guide.html">사용 가이드</a></p>`)
}

// ---------- 알림 (웹 푸시) ----------
// 알림은 기기(브라우저)마다 켠다. 켜면 그 기기의 구독 주소를 서버에 맡기고, 서버가 소식이 생길 때 그 주소로 보낸다.
const pushable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
let mySub = null // 이 기기의 구독. 없으면 null

async function loadPush() {
  if (!pushable) return
  const reg = await navigator.serviceWorker.getRegistration()
  mySub = (await reg?.pushManager.getSubscription()) ?? null
}

// 'none' 이 브라우저는 못 받음 | 'blocked' 브라우저에서 막아 둠 | 'off' | 'on'
const pushState = () =>
  !pushable ? 'none' : Notification.permission === 'denied' ? 'blocked' : mySub && S.push?.subs?.some((sub) => sub.endpoint === mySub.endpoint) ? 'on' : 'off'

const myPush = () => S.push?.subs?.find((sub) => sub.endpoint === mySub?.endpoint)

const pushSection = () =>
  `<section class="more push"><h3>알림</h3>${
    {
      none: `<p class="soft">이 브라우저에서는 알림을 켤 수 없어요. 아이폰은 Safari 의 공유 버튼에서 "홈 화면에 추가"로 설치한 다음, 홈 화면의 거북이 도서관을 열어서 켜 주세요.</p>`,
      blocked: `<p class="soft">이 사이트의 알림이 브라우저에서 차단돼 있어요. 브라우저의 사이트 설정에서 알림을 허용한 뒤 다시 열어 주세요.</p>`,
      off: `<p class="soft">친구가 읽은 쪽수를 기록했을 때, 책이나 토론일이 정해졌을 때, 토론 전날과 당일에 알려 드려요.</p>
        <button type="button" class="btn wide" data-act="push-on">🔔 이 기기에서 알림 켜기</button>`,
      on: `<p class="soft">이 기기에서 알림을 받고 있어요 🔔</p>
        <button type="button" class="btn ghost wide" data-act="push-quiet" role="switch" aria-checked="${!myPush()?.quiet}">친구 독서 소식 알림: ${myPush()?.quiet ? '꺼짐' : '켜짐'}</button>
        <p class="soft">책과 토론 일정 알림은 계속 와요.</p>
        <div class="row"><button type="button" class="btn ghost grow" data-act="push-test">시험 알림 보내기</button><button type="button" class="btn ghost grow" data-act="push-off">알림 끄기</button></div>`,
    }[pushState()]
  }</section>`

const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))
const hintSeen = () => {
  try {
    return localStorage.getItem('pushHint') === 'seen'
  } catch {
    return true // 저장소를 못 쓰는 브라우저에서는 권유를 계속 띄우지 않는다
  }
}

function toast(msg, bad = false) {
  const t = $('#toast')
  t.textContent = msg
  t.className = bad ? 'bad' : ''
  if (t.matches(':popover-open')) t.hidePopover() // 다시 띄워야 열려 있는 시트보다 위에 온다
  t.showPopover()
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.hidePopover(), 2800)
}

// ---------- 누르기 ----------
const actions = {
  // 책 찾기: 결과 목록만 그 자리에서 바꾼다 (화면 전체를 다시 그리면 적어 둔 값이 사라진다).
  async find(el) {
    const box = el.closest('.find')
    const q = $('input', box).value.trim()
    const list = $('.found', box)
    if (!q) return
    list.hidden = false
    list.innerHTML = '<li class="soft">찾는 중…</li>'
    try {
      ui.found = (await call(`search?q=${encodeURIComponent(q)}`)).items
      list.innerHTML = ui.found.length
        ? ui.found
            .map(
              (b, i) => `<li><button type="button" data-act="found" data-i="${i}">
                ${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy">` : '<span class="nocover"></span>'}
                <span><b>${esc(b.title)}</b><small>${esc([b.author, b.publisher, b.year, b.pages && `${b.pages}쪽`].filter(Boolean).join(' · '))}</small></span></button>
                ${b.link ? `<a href="${esc(b.link)}" target="_blank" rel="noopener" aria-label="${esc(b.title)} 예스24에서 보기">예스24↗</a>` : ''}</li>`,
            )
            .join('') + '<li class="credit">도서 정보 제공: <a href="https://www.yes24.com/" target="_blank" rel="noopener">예스24</a></li>'
        : '<li class="soft">찾은 책이 없어요. 아래에 직접 적어 주세요.</li>'
    } catch (e) {
      list.hidden = true
      toast(e.message, true)
    }
  },
  async found(el) {
    const box = el.closest('.find')
    const form = $('form', box.parentElement)
    let b = ui.found[Number(el.dataset.i)]
    // 쪽수는 책 한 권을 따로 조회해야 온다.
    if (!b.pages && b.id) b = { ...b, pages: (await call(`lookup?id=${b.id}`).catch(() => null))?.item?.pages ?? null }
    form.elements.title.value = b.title
    form.elements.author.value = b.author
    if (b.pages) form.elements.pages.value = b.pages
    if (form.elements.genre && b.genre) form.elements.genre.value = b.genre
    $('.found', box).hidden = true
    toast(b.pages ? `『${b.title}』 ${b.pages}쪽으로 채웠어요. 내 책과 쪽수가 같은지 확인해 주세요` : '쪽수는 찾지 못했어요. 직접 적어 주세요')
  },

  tab(el) {
    ui.tab = el.dataset.tab
    ui.open = null
    ui.filter = 'all'
    render()
    scrollTo(0, 0)
  },
  close: () => sheet.close(),
  async yes() {
    const fn = onYes
    onYes = null
    sheet.close()
    await fn?.()
  },
  profile: profileSheet,
  'push-hint'() {
    try {
      localStorage.setItem('pushHint', 'seen')
    } catch {
      // 저장하지 못해도 창은 연다
    }
    profileSheet()
  },
  async 'push-on'() {
    // 권한은 버튼을 누른 그 순간에 물어야 브라우저가 받아 준다. 그래서 다른 일보다 먼저 한다.
    if ((await Notification.requestPermission()) !== 'granted') {
      toast('알림 권한을 허용해야 켤 수 있어요', true)
      return profileSheet()
    }
    try {
      const reg = await navigator.serviceWorker.register('sw.js')
      await navigator.serviceWorker.ready
      // 남아 있던 구독은 버리고 새로 받는다. 예전 것은 이미 만료됐거나 다른 서명 키로 만든 것일 수 있다.
      const stale = await reg.pushManager.getSubscription()
      if (stale) {
        await call('push/unsubscribe', { endpoint: stale.endpoint }).catch(() => {})
        await stale.unsubscribe()
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(S.push.key) })
      const { endpoint, keys } = sub.toJSON()
      if (await act('push/subscribe', { endpoint, p256dh: keys.p256dh, auth: keys.auth }, '알림을 켰어요 🔔')) {
        mySub = sub
        render()
      } else {
        // 서버에 맡기지 못했으면 기기 쪽 구독도 없애 둘이 어긋나지 않게 한다
        await sub.unsubscribe().catch(() => {})
        mySub = null
      }
    } catch {
      toast('알림을 켜지 못했어요. 잠시 뒤에 다시 해 주세요', true)
    }
    profileSheet()
  },
  async 'push-off'() {
    const endpoint = mySub?.endpoint
    if (!(await act('push/unsubscribe', { endpoint }, '알림을 껐어요'))) return toast('다시 시도해 주세요', true)
    if (await mySub?.unsubscribe().catch(() => false)) mySub = null
    render()
    profileSheet()
  },
  async 'push-quiet'() {
    if (await act('push/quiet', { endpoint: mySub.endpoint, quiet: !myPush()?.quiet }, '알림 설정을 바꿨어요')) profileSheet()
  },
  'push-test': () => act('push/test', { endpoint: mySub.endpoint }, '시험 알림을 보냈어요. 곧 도착해요 🔔'),
  async logout() {
    await call('logout', { endpoint: mySub?.endpoint }).catch(() => {}) // 이 기기로 가던 알림도 같이 끊긴다
    sheet.close()
    S = null
    raw = ''
    render()
  },
  who(el) {
    const m = members().find((x) => x.id === Number(el.dataset.id))
    const c = cur()
    openSheet(`<div class="whois c-${m.color}">
      <div class="portrait">${critterSVG(m.stage, m.crown)}</div>
      <h2>${esc(m.name)}${m.crown ? ' 👑' : ''}</h2>
      <p class="soft">${STAGES[m.stage].name}${c.title ? ` · ${m.pages} / ${c.pages}쪽 (${m.percent}%)` : ''}</p>
      ${m.crown ? '<p class="pill gold">이번 책을 가장 먼저 다 읽었어요</p>' : ''}
      ${ladder(m.stage, m.color)}
      <button class="btn ghost wide" data-act="shelf-user" data-id="${m.id}">${m.me ? '나의 서재 가기' : '서재 구경하기'}</button>
    </div>`)
  },

  // 책 · 날짜
  'edit-book': () => openSheet(`<h2>책 정보 고치기</h2>${bookForm(cur())}`),
  month(el) {
    const [y, m] = ui.month.split('-').map(Number)
    ui.month = new Date(Date.UTC(y, m - 1 + Number(el.dataset.d), 1)).toISOString().slice(0, 7)
    render()
  },
  day(el) {
    const d = el.dataset.date
    ui.dates.has(d) ? ui.dates.delete(d) : ui.dates.add(d)
    render()
  },
  async 'save-dates'() {
    const dates = [...ui.dates]
    if (!(await act('dates', { dates, confirmed: true }))) return
    ui.dates = null
    const day = cur().discussion_date
    toast(day ? `토론일이 정해졌어요! ${fmtDate(day)} 🎉` : '저장했어요. 친구들이 고르면 날짜가 정해져요')
    if (day) render()
  },
  reschedule: () =>
    confirmSheet('토론일을 다시 정할까요?', '정해진 날짜가 취소되고, 모두 가능한 날을 다시 확정해야 해요.', '다시 정하기', async () => {
      ui.dates = null
      ui.month = null
      await act('reschedule', {}, '날짜를 다시 골라 주세요')
    }),
  reopen: () =>
    confirmSheet('지난 책으로 돌아갈까요?', '방금 넘어간 빈 책 차례를 지우고, 지난 책을 다시 열어요. 토론일을 모두 다시 골라야 해요.', '되돌리기', () => act('reopen', {}, '지난 책을 다시 열었어요')),

  // 진행도
  async 'save-progress'(el) {
    const box = el.closest('.prog')
    const { kind, id } = box.dataset
    const pages = Number($('input[type=number]', box).value)
    const draft = ui.drafts[kind + id]
    delete ui.drafts[kind + id]
    let ok
    if (kind === 'cycle') {
      const cycle = S.cycles.find((c) => c.id === Number(id))
      const before = stageOf(pct(readOf(cycle.id, S.me.id), cycle.pages))
      ok = await act('progress', { cycle_id: cycle.id, pages })
      const after = stageOf(pct(pages, cycle.pages))
      if (ok && !cycle.closed && after > before) {
        celebrate(S.me.id)
        toast(after === 4 && members().find((m) => m.me).crown ? '👑 가장 먼저 다 읽었어요! 토끼로 진화!' : `🎉 ${STAGES[after].name}로 진화했어요!`)
      } else if (ok) toast(pages >= cycle.pages ? '완독! 🎉' : '기록했어요')
    } else {
      const b = S.books.find((x) => x.id === Number(id))
      ok = await act('shelf', { ...b, pages_read: pages }, pages >= b.pages ? '완독! 🎉 서재에 금빛으로 꽂혔어요' : '기록했어요')
    }
    if (!ok) ui.drafts[kind + id] = draft
  },

  // 토론 카드
  card: (el) => showCard(ui.card + Number(el.dataset.d)),
  'add-q': () =>
    openSheet(`<form data-form="question" class="form">
      <h2>내 질문 추가</h2>
      <p class="soft">"좋았다"에서 끝나지 않고 서로 생각이 갈릴 만한 질문이 좋아요.<br>예: 내가 안진진이라면 어떤 선택을 했을까요?</p>
      <label><span class="sr">질문</span><textarea name="body" required rows="4" maxlength="300" placeholder="이 장면에서는 어떻게 생각하시나요?"></textarea></label>
      <button class="btn wide">카드로 만들기</button>
    </form>`),
  async 'draw-q'() {
    const before = S.questions.length
    if (!(await act('question/draw', {}))) return
    // 새 카드는 본 질문 맨 뒤(마무리 카드 앞)에 들어간다.
    const cards = S.questions.filter((q) => q.cycle_id === cur().id)
    if (S.questions.length > before) ui.card = cards.findLastIndex((q) => q.sec === 1)
    render()
    toast('카드를 한 장 뽑았어요 🎲')
  },
  'del-q': (el) =>
    confirmSheet('이 카드를 뺄까요?', '이번 책의 토론 카드에서 사라져요.', '빼기', () => act('question/delete', { id: Number(el.dataset.id) }, '카드를 뺐어요')),

  // 기록
  filter(el) {
    ui.filter = el.dataset.f
    render()
  },
  'note-new': (el) => noteSheet({ kind: el.dataset.kind, cycle: el.dataset.cycle, book: el.dataset.book }),
  'note-edit': (el) => noteSheet({ note: S.notes.find((n) => n.id === Number(el.dataset.id)) }),
  'note-del': (el) => confirmSheet('이 기록을 지울까요?', '지우면 되돌릴 수 없어요.', '지우기', () => act('note/delete', { id: Number(el.dataset.id) }, '지웠어요')),
  reveal(el) {
    ui.seen.add(Number(el.dataset.id))
    render()
  },
  more(el) {
    el.closest('.note').classList.add('open')
    el.remove()
  },

  // 서재
  'shelf-user'(el) {
    if (sheet.open) sheet.close()
    Object.assign(ui, { tab: 'shelf', shelfUser: Number(el.dataset.id), open: null, filter: 'all' })
    render()
    scrollTo(0, 0)
  },
  'open-book'(el) {
    Object.assign(ui, { tab: 'shelf', open: { key: el.dataset.key, user: Number(el.dataset.user) }, filter: 'all' })
    ui.shelfUser = ui.open.user
    render()
    scrollTo(0, 0)
  },
  back() {
    ui.open = null
    ui.filter = 'all'
    render()
  },
  'shelf-add': () => shelfSheet(),
  'shelf-edit': (el) => shelfSheet(S.books.find((b) => b.id === Number(el.dataset.id))),
  'shelf-del': (el) =>
    confirmSheet('서재에서 뺄까요?', '이 책과 여기에 남긴 기록이 함께 지워져요.', '빼기', async () => {
      ui.open = null
      await act('shelf/delete', { id: Number(el.dataset.id) }, '서재에서 뺐어요')
    }),
}

function shelfSheet(b) {
  openSheet(`<h2>${b ? '책 정보 고치기' : '읽는 책 추가'}</h2>${b ? '' : finder()}
  <form data-form="shelf" class="form">
    ${b ? `<input type="hidden" name="id" value="${b.id}">` : ''}
    <label>책 제목<input name="title" required maxlength="100" value="${esc(b?.title)}"></label>
    <label>지은이<input name="author" maxlength="60" value="${esc(b?.author)}"></label>
    <label>전체 쪽수<input name="pages" type="number" inputmode="numeric" required min="1" max="5000" value="${esc(b?.pages)}"></label>
    <label>지금까지 읽은 쪽수<input name="pages_read" type="number" inputmode="numeric" min="0" max="5000" value="${b?.pages_read ?? 0}"></label>
    <button class="btn wide">${b ? '저장' : '서재에 꽂기'}</button>
  </form>`)
}

const forms = {
  async login(d, form) {
    try {
      await call('login', d)
      setState(await call('state'))
    } catch (e) {
      $('.err', form).textContent = e.message
    }
  },
  async book(d) {
    const first = !cur().title
    if (await act('book', d, first ? '책을 정했어요! 이제 토론일을 골라 주세요 📅' : '고쳤어요')) sheet.open && sheet.close()
  },
  async note(d) {
    if (await act('note', d, '기록했어요 ✏️')) sheet.close()
  },
  async question(d) {
    if (!(await act('question', d, '카드를 추가했어요'))) return
    ui.card = S.questions.filter((q) => q.cycle_id === cur().id).findLastIndex((q) => q.sec === 1)
    sheet.close()
    render()
  },
  async shelf(d) {
    if (await act('shelf', d, d.id ? '고쳤어요' : '서재에 꽂았어요 📚')) sheet.close()
  },
  async profile(d) {
    if (await act('profile', d, '저장했어요')) sheet.close()
  },
  async password(d, form) {
    if (await act('password', d, '비밀번호를 바꿨어요')) form.reset()
  },
}

// 한 번에 한 요청만: 처리 중에 또 누르는 것은 무시한다.
async function once(fn) {
  if (busy) return
  busy = true
  try {
    await fn()
  } finally {
    busy = false
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]')
  if (el && !el.disabled) once(() => actions[el.dataset.act]?.(el))
})

document.addEventListener('submit', (e) => {
  e.preventDefault()
  const form = e.target
  once(() => forms[form.dataset.form]?.(Object.fromEntries(new FormData(form)), form))
})

// 쪽수 슬라이더와 숫자 칸을 서로 맞춘다.
document.addEventListener('input', (e) => {
  const box = e.target.closest('.prog')
  if (!box) return
  const total = Number(box.dataset.total)
  const v = Math.max(0, Math.min(total, Math.round(Number(e.target.value) || 0)))
  for (const input of box.querySelectorAll('input')) if (input !== e.target) input.value = v
  ui.drafts[box.dataset.kind + box.dataset.id] = v
  $('[type=range]', box).style.setProperty('--p', `${(v / total) * 100}%`)
  $('.live', box).textContent = `${pct(v, total)}%`
})

// 책 찾기 칸에서 엔터를 누르면 찾기.
document.addEventListener('keydown', (e) => {
  const box = e.key === 'Enter' && e.target.closest('.find')
  if (!box) return
  e.preventDefault()
  $('[data-act=find]', box).click()
})

// 입력을 마치면 미뤄 둔 새 상태를 그린다. 바로 그리면 방금 누른 버튼이 사라지므로 조금 기다린다.
document.addEventListener('focusout', () => setTimeout(() => stale && !busy && !typing() && render(), 400))

// 친구들의 변화를 30초마다, 그리고 앱으로 돌아올 때 받아 온다.
setInterval(refresh, 30000)
document.addEventListener('visibilitychange', refresh)

if (pushable) navigator.serviceWorker.addEventListener('message', (e) => e.data === 'refresh' && refresh())
loadPush()
  .catch(() => {})
  .then(() => call('state'))
  .then(setState, () => render())
