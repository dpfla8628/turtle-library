import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

globalThis.matchMedia = () => ({ matches: false })
const { critterSVG } = await import('../public/critters.js')

test('가이드의 캐릭터 SVG가 현재 그림과 같다', () => {
  const html = readFileSync(new URL('../public/guide.html', import.meta.url), 'utf8')
  const figures = [...html.matchAll(/<(div|span)\b[^>]*\sdata-critter="(\d)"( data-crown)?[^>]*>([\s\S]*?)<\/\1>/g)]
  assert.ok(figures.length >= 5, '가이드 캐릭터 그림을 찾지 못했어요')
  for (const [, , stage, crown, actual] of figures) {
    const expected = critterSVG(Number(stage), Boolean(crown))
    assert.equal(actual.replace(/\s*\n\s*/g, ''), expected.replace(/\s*\n\s*/g, ''), '가이드 그림이 다릅니다: node scripts/guide-critters.mjs 를 돌리세요')
  }
})
