// 도서관 장면과 캐릭터. 그림은 전부 인라인 SVG 라서 이미지 파일이 없다.
// 캐릭터 몸 색은 CSS 변수 --c(기본) / --cd(진한 쪽)로 들어온다 (.c-peach 같은 클래스가 정한다).

const INK = '#5a463c'
const CREAM = '#fffaf2'

const eyes = (x1, x2, y) => `
  <circle cx="${x1}" cy="${y}" r="2.9" fill="${INK}"/><circle cx="${x2}" cy="${y}" r="2.9" fill="${INK}"/>
  <circle cx="${x1 + 1}" cy="${y - 1}" r=".9" fill="#fff"/><circle cx="${x2 + 1}" cy="${y - 1}" r=".9" fill="#fff"/>
  <ellipse cx="${x1 - 5}" cy="${y + 7}" rx="3.8" ry="2.3" fill="#ff8f8f" opacity=".5"/>
  <ellipse cx="${x2 + 5}" cy="${y + 7}" rx="3.8" ry="2.3" fill="#ff8f8f" opacity=".5"/>`
const line = (d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`
const smile = (x, y) => line(`M${x - 3} ${y} q3 3.2 6 0`)
const wMouth = (x, y) => line(`M${x - 4.6} ${y} q2.3 3 4.6 0 q2.3 3 4.6 0`)

// ---- 캐릭터 ----
// 70%까지는 계속 거북이다. 읽을수록 몸이 커지고(SIZE) 머리띠 색이 바뀌며(BAND), 70%부터는 달리는 자세가 된다.
// 100%에서만 토끼가 된다. 모두 오른쪽을 보고, 발바닥이 y=94 근처에 닿는다.
const SIZE = [0.64, 0.8, 0.92, 1] // 거북이 몸 크기 (발바닥 가운데를 기준으로 줄인다)
const BAND = [null, ['#ffffff', '#8e7464'], ['#74aaf2', '#355f9b'], ['#f2665c', '#a83931']] // 머리띠 [색, 테두리]: 없음 → 흰색 → 파랑 → 빨강
const SKIN = '#cdebb5'
const LEG = '#b5dc98'

function headband([color, edge], flying) {
  const arc = 'M67 57 Q80 49.5 93.5 61'
  // 끈: 평소엔 짧은 매듭, 달릴 때는 뒤로 길게 휘날린다
  const tails = flying
    ? `<g class="tails fly"><path d="M67 57 q-10 -9 -22 -4 M67 58.5 q-11 0 -18 8" fill="none" stroke="${color}" stroke-width="3.6" stroke-linecap="round"/></g>`
    : `<g class="tails"><path d="M67 57 l-9 -4 l2 7z M67 58 l-8 4 l5 4z" fill="${color}" stroke="${edge}" stroke-width=".8" stroke-linejoin="round"/></g>`
  return `${tails}
    <path d="${arc}" fill="none" stroke="${edge}" stroke-width="6.6" stroke-linecap="round"/>
    <path d="${arc}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="67" cy="57.5" r="3.4" fill="${color}" stroke="${edge}" stroke-width=".8"/>`
}

function turtle(stage) {
  const run = stage === 3
  const legs = run
    ? `<ellipse cx="20" cy="88" rx="11" ry="5" fill="${LEG}" transform="rotate(26 20 88)"/><ellipse cx="61" cy="88" rx="11" ry="5" fill="${LEG}" transform="rotate(-26 61 88)"/>`
    : `<ellipse cx="27" cy="89" rx="9" ry="5.5" fill="${LEG}"/><ellipse cx="55" cy="89" rx="9" ry="5.5" fill="${LEG}"/>`
  const body = `${legs}
    <path d="M13 81 q-9 0 -10 7 q9 2 13 -2z" fill="${LEG}"/>
    ${stage === 0 ? '<path d="M76 51 q-3 -9 5 -10 q2 8 -5 10z" fill="#8fce7a"/>' : ''}
    <circle cx="78" cy="67" r="16" fill="${SKIN}"/>
    <path d="M9 85 Q9 43 40 43 Q71 43 71 85 Z" fill="var(--c)"/>
    <path d="M24 62 q16 -13 32 0" fill="none" stroke="var(--cd)" stroke-width="4" stroke-linecap="round"/>
    <circle cx="27" cy="73" r="4" fill="var(--cd)"/><circle cx="40" cy="76" r="4" fill="var(--cd)"/><circle cx="53" cy="73" r="4" fill="var(--cd)"/>
    <rect x="6" y="81" width="68" height="8" rx="4" fill="var(--cd)"/>
    ${BAND[stage] ? headband(BAND[stage], run) : ''}
    ${eyes(75, 86, 64)}${run ? `<path d="M77.3 69 h6.4 a3.2 3.6 0 0 1 -6.4 0z" fill="${INK}"/>` : smile(80.5, 70)}`
  // 달리는 거북이: 몸을 앞으로 기울이고, 서 있을 때도 옅게 보이는 바람 줄(.dash)을 뒤에 둔다
  return run
    ? `<path class="dash" d="M0 55 h8 M-4 64 h11 M1 73 h6" fill="none" stroke="#d6c2ad" stroke-width="2.4" stroke-linecap="round"/><g transform="rotate(4 40 92)">${body}</g>`
    : body
}

const RABBIT = `<circle cx="22" cy="78" r="8.5" fill="${CREAM}"/>
   <ellipse cx="50" cy="19" rx="8" ry="19" fill="var(--c)" transform="rotate(-9 50 19)"/>
   <ellipse cx="70" cy="19" rx="8" ry="19" fill="var(--c)" transform="rotate(9 70 19)"/>
   <ellipse cx="50" cy="20" rx="3.6" ry="13" fill="#ffc9d4" transform="rotate(-9 50 20)"/>
   <ellipse cx="70" cy="20" rx="3.6" ry="13" fill="#ffc9d4" transform="rotate(9 70 20)"/>
   <ellipse cx="46" cy="76" rx="25" ry="17" fill="var(--c)"/>
   <ellipse cx="34" cy="91" rx="10" ry="4.5" fill="var(--c)"/><ellipse cx="60" cy="91" rx="10" ry="4.5" fill="var(--c)"/>
   <ellipse cx="48" cy="80" rx="13" ry="9" fill="${CREAM}" opacity=".85"/>
   <circle cx="60" cy="51" r="23.5" fill="var(--c)"/>
   <ellipse cx="60.5" cy="56" rx="2.4" ry="1.7" fill="#ff8fa3"/>
   ${eyes(52, 69, 50)}${wMouth(60.5, 59)}`

// 왕관은 가장 먼저 다 읽은 사람, 곧 토끼만 쓴다.
// CSS 애니메이션의 transform 은 SVG transform 속성을 덮어쓴다. 그래서 자리는 바깥 g, 흔들림(.crown)은 안쪽 g 가 맡는다.
const CROWN = `<g transform="translate(60 30)"><g class="crown">
  <path d="M-14 0 L-16 -14 L-7.5 -7 L0 -18 L7.5 -7 L16 -14 L14 0 Z" fill="#f9cf4a" stroke="#dfa521" stroke-width="1.6" stroke-linejoin="round"/>
  <circle cx="0" cy="-5.5" r="2.2" fill="#ff8fa3"/><circle cx="-8.5" cy="-4" r="1.5" fill="#8fd3f4"/><circle cx="8.5" cy="-4" r="1.5" fill="#8fd3f4"/>
</g></g>`

// 그림 위쪽의 빈 공간을 잘라 이름표가 머리 바로 위에 붙게 한다.
const TOP = [57, 55, 50, 46, 0]

export const critterSVG = (stage, crowned = false) => {
  const art =
    stage < 4
      ? `<g transform="translate(50 94) scale(${SIZE[stage]}) translate(-50 -94)"><g class="body">${turtle(stage)}</g></g>`
      : `<g class="body">${RABBIT}</g>${crowned ? CROWN : ''}`
  return `<svg viewBox="0 ${TOP[stage]} 100 ${100 - TOP[stage]}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${art}</svg>`
}

// ---- 도서관 배경 ----
const BOOK_COLORS = ['#ffcfb0', '#bfe8d4', '#bfe0f5', '#fbe9a0', '#d9c9f3', '#f9c2d0', '#ffe3c8', '#cfe8ae', '#f7b7a3']

function shelf(x, y, w, h, rows, rand) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="#dcae7c"/>
    <rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="3" fill="#b98a5e"/>`
  const rowH = (h - 10) / rows
  for (let r = 0; r < rows; r++) {
    const base = y + 5 + rowH * (r + 1) - 3
    let bx = x + 8
    while (bx < x + w - 15) {
      const bw = 5 + Math.floor(rand() * 5)
      const bh = rowH * (0.52 + rand() * 0.3)
      const color = BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)]
      if (rand() < 0.1) {
        bx += bw + 3 // 빈 칸
        continue
      }
      s += `<rect x="${bx}" y="${(base - bh).toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="1.3" fill="${color}"/>`
      bx += bw + 1
    }
    s += `<rect x="${x + 5}" y="${base}" width="${w - 10}" height="3" fill="#dcae7c"/>`
  }
  return s
}

function room() {
  let seed = 20261105 // 고정 시드: 책장이 매번 같은 모습이도록
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  return `<svg class="room" viewBox="0 0 360 230" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><pattern id="wall-dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="1.3" fill="#f7dfc2"/></pattern></defs>
    <rect width="360" height="230" fill="#fdecd6"/><rect width="360" height="160" fill="url(#wall-dots)"/>
    <path d="M144 112 V70 a36 36 0 0 1 72 0 V112 Z" fill="#fff"/>
    <path d="M149 108 V70 a31 31 0 0 1 62 0 V108 Z" fill="#cfeafc"/>
    <ellipse cx="166" cy="72" rx="9" ry="5" fill="#fff"/><ellipse cx="174" cy="69" rx="8" ry="6" fill="#fff"/><ellipse cx="197" cy="88" rx="8" ry="4.5" fill="#fff"/>
    <path d="M180 39 V108 M149 76 H211" stroke="#fff" stroke-width="4"/>
    <rect x="138" y="108" width="84" height="7" rx="3.5" fill="#fff"/>
    ${shelf(10, 26, 112, 136, 4, rand)}${shelf(238, 26, 112, 136, 4, rand)}
    <rect y="158" width="360" height="72" fill="#f4d6aa"/><rect y="156" width="360" height="5" fill="#e9c595"/>
    <path d="M0 182 H360 M0 206 H360" stroke="#eccb9b" stroke-width="1.5"/>
    <ellipse cx="180" cy="201" rx="150" ry="25" fill="#f9c8d4"/>
    <ellipse cx="180" cy="201" rx="132" ry="19" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="5 6" opacity=".85"/>
    <path d="M150 158 q-9 -17 -3 -30 q8 10 5 30z M154 158 q0 -21 10 -29 q4 16 -7 29z M152 158 q-2 -11 -13 -14 q0 10 11 14z" fill="#9fd39a"/>
    <path d="M143 156 h18 l-3 15 h-12z" fill="#f2a98a"/>
    <rect x="200" y="163" width="26" height="6" rx="2" fill="#bfe0f5"/><rect x="203" y="157" width="22" height="6" rx="2" fill="#fbe9a0"/><rect x="201" y="151" width="24" height="6" rx="2" fill="#f9c2d0"/>
  </svg>`
}

// ---- 돌아다니기 ----
const SPEED = [2.5, 4.5, 7, 13, 16] // 초당 이동 거리(바닥 너비의 %). 단계가 오를수록 빨라진다.
const LANES = [2, 20, 11, 28, 6, 24] // 바닥에서 떨어진 높이(%). 서로 겹쳐 보이지 않게 번갈아 선다.
const calm = matchMedia('(prefers-reduced-motion: reduce)')

let floor
const cast = new Map() // user id → { el, x, stage, timer }

export function mountScene(el) {
  // 다시 로그인하면 방을 새로 그린다. 이전 방의 친구들을 기억한 채로 두면 새 방에 아무도 올라오지 않는다.
  for (const c of cast.values()) clearTimeout(c.timer)
  cast.clear()
  el.innerHTML = room() + '<div class="floor"></div>'
  floor = el.querySelector('.floor')
}

function wander(c) {
  const step = () => {
    if (!c.el.isConnected || calm.matches) return
    // 다른 친구가 서 있는(또는 가고 있는) 자리는 피해서 고른다. 몇 번 해 보고 안 되면 그냥 간다.
    let x
    for (let tries = 0; tries < 6; tries++) {
      x = 8 + Math.random() * 84
      if (![...cast.values()].some((o) => o !== c && Math.abs(o.x - x) < 18)) break
    }
    const seconds = Math.abs(x - c.x) / SPEED[c.stage]
    c.el.classList.toggle('left', x < c.x)
    c.el.classList.add('walk')
    c.el.style.setProperty('--t', `${seconds}s`)
    c.el.style.left = `${x}%`
    c.x = x
    c.timer = setTimeout(() => {
      c.el.classList.remove('walk')
      c.timer = setTimeout(step, 1500 + Math.random() * 4000)
    }, seconds * 1000)
  }
  c.timer = setTimeout(step, 600 + Math.random() * 2500)
}

// members: [{ id, name, color, stage, percent, crown, me }]
export function updateScene(members, stageNames) {
  for (const [id, c] of cast)
    if (!members.some((m) => m.id === id)) {
      clearTimeout(c.timer)
      c.el.remove()
      cast.delete(id)
    }
  members.forEach((m, i) => {
    let c = cast.get(m.id)
    if (!c) {
      const el = document.createElement('button')
      el.dataset.act = 'who'
      el.dataset.id = m.id
      const x = ((i + 0.5) / members.length) * 84 + 8
      el.style.left = `${x}%`
      el.style.bottom = `${LANES[i % LANES.length]}%`
      el.style.zIndex = 40 - LANES[i % LANES.length] // 앞줄이 뒷줄을 가린다
      el.innerHTML = '<span class="tag"></span><span class="flip"></span>'
      floor.append(el)
      c = { el, x, stage: m.stage, sig: '' }
      cast.set(m.id, c)
      wander(c)
    }
    c.stage = m.stage
    const sig = `${m.stage}|${m.crown}|${m.color}|${m.me}`
    if (sig !== c.sig) {
      // walk / left 같은 움직임 클래스는 남기고 모습만 바꾼다
      const moving = ['walk', 'left', 'evolve'].filter((k) => c.el.classList.contains(k)).join(' ')
      c.el.className = `critter c-${m.color} s${m.stage}${m.me ? ' me' : ''} ${moving}`
      c.el.querySelector('.flip').innerHTML = critterSVG(m.stage, m.crown)
      c.sig = sig
    }
    c.el.querySelector('.tag').textContent = `${m.name} ${m.percent}%`
    c.el.setAttribute('aria-label', `${m.name}, ${stageNames[m.stage]}, ${m.percent}% 읽음${m.crown ? ', 왕관' : ''}`)
  })
}

// 진화했을 때 잠깐 반짝.
export function celebrate(id) {
  const el = cast.get(id)?.el
  if (!el) return
  el.classList.add('evolve')
  setTimeout(() => el.classList.remove('evolve'), 1800)
}
