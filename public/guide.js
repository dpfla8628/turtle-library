// 가이드 페이지에 앱과 같은 캐릭터를 그려 넣는다.
import { critterSVG } from './critters.js'

for (const el of document.querySelectorAll('[data-critter]'))
  el.innerHTML = critterSVG(Number(el.dataset.critter), el.hasAttribute('data-crown'))
