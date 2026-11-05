-- 독서토론 앱 스키마. 여러 번 실행해도 안전하다 (IF NOT EXISTS).
-- 시각은 전부 ms(Date.now()), 날짜는 한국 기준 'YYYY-MM-DD'.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'peach',
  ord INTEGER NOT NULL,               -- 책 고르는 순번
  pw_hash TEXT NOT NULL,              -- "반복수:salt:hash"
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires INTEGER NOT NULL
);

-- 책 한 권 = 사이클 하나. title 이 없으면 고르는 중, discussion_date 가 없으면 날짜 정하는 중.
CREATE TABLE IF NOT EXISTS cycles (
  id INTEGER PRIMARY KEY,
  picker_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT,
  author TEXT,
  pages INTEGER,
  genre TEXT,
  discussion_date TEXT,
  winner_id INTEGER REFERENCES users(id),  -- 마감할 때 정해지는 '가장 빨리 읽은 사람'
  closed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- 열려 있는 사이클은 언제나 하나뿐.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_cycle ON cycles (closed) WHERE closed = 0;

CREATE TABLE IF NOT EXISTS availability (
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  dates TEXT NOT NULL DEFAULT '[]',   -- JSON 배열
  confirmed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cycle_id, user_id)
);

CREATE TABLE IF NOT EXISTS progress (
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  pages_read INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER,
  PRIMARY KEY (cycle_id, user_id)
);

-- 나의 서재: 모임 도서가 아닌 개인 책.
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  author TEXT,
  pages INTEGER NOT NULL,
  pages_read INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER,
  created_at INTEGER NOT NULL
);

-- 한줄평(review) · 메모(memo) · 인상 깊은 구절(quote). 모임 도서면 cycle_id, 개인 책이면 book_id.
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  cycle_id INTEGER REFERENCES cycles(id),
  book_id INTEGER REFERENCES books(id),
  kind TEXT NOT NULL CHECK (kind IN ('review', 'memo', 'quote')),
  body TEXT NOT NULL,
  page INTEGER,                        -- 구절의 쪽수, 또는 쓸 당시 읽던 쪽 (스포일러 가림에 쓴다)
  rating INTEGER,                      -- 한줄평 별점 1~5
  created_at INTEGER NOT NULL,
  CHECK ((cycle_id IS NULL) <> (book_id IS NULL))
);

-- 토론 큐카드. user_id 가 없으면 기본 카드. sec: 0 워밍업, 1 본 질문, 2 마무리.
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  user_id INTEGER REFERENCES users(id),
  sec INTEGER NOT NULL DEFAULT 1,
  cat TEXT NOT NULL,
  body TEXT NOT NULL
);

-- 알림(웹 푸시): 알림을 켠 기기(브라우저)마다 구독 하나.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,           -- 브라우저 회사의 푸시 서버 주소
  user_id INTEGER NOT NULL REFERENCES users(id),
  p256dh TEXT NOT NULL,                -- 기기의 공개키
  auth TEXT NOT NULL,                  -- 기기의 비밀값
  created_at INTEGER NOT NULL
);

-- 서버가 스스로 만들어 두는 값: 'vapid'(알림 서명 키), 'origin'(이 앱의 주소).
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
