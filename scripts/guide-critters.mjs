// 가이드(public/guide.html)의 캐릭터 그림을 다시 그려 넣는다.  node scripts/guide-critters.mjs
// 가이드는 스크립트 없이 바로 보이도록 캐릭터 SVG 를 HTML 에 넣어 둔다. public/critters.js 의 그림을 고쳤으면 이걸 한 번 돌린다.
// data-critter="단계"(0~4) 가 붙은 요소의 안쪽을 채우고, data-crown 이 있으면 왕관을 씌운다.
import { readFileSync, writeFileSync } from 'node:fs'

globalThis.matchMedia = () => ({ matches: false }) // critters.js 가 브라우저 전용 값을 한 번 읽는다
const { critterSVG } = await import('../public/critters.js')

const file = new URL('../public/guide.html', import.meta.url)
let count = 0
const html = readFileSync(file, 'utf8').replace(
  /(<(div|span)\b[^>]*\sdata-critter="(\d)"( data-crown)?[^>]*>)[\s\S]*?(<\/\2>)/g,
  (_, open, tag, stage, crown, close) => (count++, open + critterSVG(Number(stage), Boolean(crown)).replace(/\s*\n\s*/g, '') + close),
)
writeFileSync(file, html)
console.log(`캐릭터 ${count}개를 다시 그렸어요`)
