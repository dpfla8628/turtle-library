// 계정 만들기 / 비밀번호 다시 정하기.
//   node scripts/users.mjs 아이디:이름 [아이디:이름 ...]   새 계정 (순번은 기존 회원 뒤에 이어 붙는다)
//   node scripts/users.mjs --reset 아이디 [아이디 ...]     비밀번호를 잊었을 때 새로 발급
// users.local.sql 을 만들고 비밀번호를 화면에 한 번 보여 준다. 그 SQL 을 D1 에 넣어야 반영된다:
//   npx wrangler d1 execute book-club --local  --file=users.local.sql   (내 PC)
//   npx wrangler d1 execute book-club --remote --file=users.local.sql   (배포한 곳)
import { randomInt } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { hashPassword } from '../src/auth.js'

const WORDS = [
  'mint', 'tokki', 'bada', 'gureum', 'byeol', 'dal', 'haetsal', 'namu', 'kkot', 'baram', 'noeul', 'bom',
  'gaeul', 'sup', 'gang', 'san', 'mogwa', 'gyul', 'bam', 'kong', 'ddalgi', 'podo', 'sagwa', 'boksung',
  'nabi', 'saebyeok', 'dotori', 'solbang', 'jogae', 'morae', 'isul', 'nun', 'bi', 'mujigae', 'haneul', 'deul',
  'chaek', 'yeonpil', 'jongi', 'pyeonji', 'chatjan', 'damyo', 'yangmal', 'mokdori', 'usan', 'deungbul', 'changga', 'uija',
  'goyang', 'gangaji', 'geobuk', 'byeongari', 'daram', 'gom', 'yeou', 'sasum', 'gorae', 'pengwin', 'ori', 'chamsae',
  'hodu', 'bori', 'ssal', 'kkul',
]
const COLORS = ['peach', 'mint', 'sky', 'lemon', 'lilac', 'rose']
const ID = /^[a-z0-9_]{2,20}$/

const args = process.argv.slice(2)
const reset = args[0] === '--reset'
const items = reset ? args.slice(1).map((id) => [id, id]) : args.map((a) => a.split(':'))
if (!items.length || items.some(([id, name]) => !ID.test(id ?? '') || !name)) {
  console.error('사용법: node scripts/users.mjs 아이디:이름 [...]   또는   node scripts/users.mjs --reset 아이디 [...]')
  console.error('아이디는 영문 소문자·숫자·밑줄 2~20자')
  process.exit(1)
}

const word = () => WORDS[randomInt(WORDS.length)]
const sql = []
for (const [i, [username, name]] of items.entries()) {
  const password = `${word()}-${word()}-${String(randomInt(10000)).padStart(4, '0')}`
  const hash = await hashPassword(password)
  if (reset)
    sql.push(
      `UPDATE users SET pw_hash = '${hash}', fails = 0, locked_until = 0 WHERE username = '${username}';`,
      `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '${username}');`,
    )
  else
    sql.push(
      `INSERT INTO users (username, name, color, ord, pw_hash) VALUES ('${username}', '${name.replaceAll("'", "''")}', ` +
        `'${COLORS[i % COLORS.length]}', (SELECT COALESCE(MAX(ord), -1) + 1 FROM users), '${hash}');`,
    )
  console.log(`${reset ? '' : `${name}\t`}아이디: ${username}\t비밀번호: ${password}`)
}
writeFileSync('users.local.sql', sql.join('\n') + '\n')
console.log('\nusers.local.sql 을 만들었어요. 위 비밀번호는 다시 볼 수 없으니 지금 적어 두세요.')
