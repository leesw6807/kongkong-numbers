// 음성 문장 데이터 — 키 = mp3 파일 이름(확장자 제외). (설계서 §7)
// 파일은 assets/audio/<키>.mp3 에 둔다. 파일이 없으면 text를 한국어 TTS로 읽는다.
// 이 목록을 바꾸면 assets/audio/LIST.md도 함께 고친다. (dev 테스트 화면의 "LIST.md 대조"로 확인)

const pad = (n) => String(n).padStart(2, '0');

// ---------- 숫자 ----------
// 세기(고유어): 하나, 둘, 셋 … 스물 (포도알이 최대 20알이라 20까지)
export const NATIVE = ['하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열',
  '열하나', '열둘', '열셋', '열넷', '열다섯', '열여섯', '열일곱', '열여덟', '열아홉', '스물'];
// 개수(고유어 + 개): 한 개, 두 개 … 스무 개
const COUNTER = ['한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열',
  '열한', '열두', '열세', '열네', '열다섯', '열여섯', '열일곱', '열여덟', '열아홉', '스무'];
// 한자어: 일 … 십 (3단계 범위 1~10)
export const SINO = ['일', '이', '삼', '사', '오', '육', '칠', '팔', '구', '십'];
// 3단계 한자어 소개: "셋은 '삼'이라고도 해."
const TOPIC = ['하나는', '둘은', '셋은', '넷은', '다섯은', '여섯은', '일곱은', '여덟은', '아홉은', '열은'];
const hasBatchim = (word) => (word.charCodeAt(word.length - 1) - 0xac00) % 28 !== 0;

export const NATIVE_MAX = NATIVE.length;  // 20
export const SINO_MAX = SINO.length;      // 10

export const numKey = {
  native: (n) => `n_native_${pad(n)}`,
  sino: (n) => `n_sino_${pad(n)}`,
  counter: (n) => `n_counter_${pad(n)}`,
  intro: (n) => `n_intro_${pad(n)}`,
};

// ---------- 물체 (게임에 나오는 것) ----------
// 이모지는 js/assets.js의 OBJECTS와 id를 맞춘다.
export const OBJECT_NAMES = {
  apple:      { name: '사과',     subject: '사과가' },
  strawberry: { name: '딸기',     subject: '딸기가' },
  chick:      { name: '병아리',   subject: '병아리가' },
  fish:       { name: '물고기',   subject: '물고기가' },
  flower:     { name: '꽃',       subject: '꽃이' },
  balloon:    { name: '풍선',     subject: '풍선이' },
};

export const objKey = {
  name: (id) => `obj_${id}`,        // "딸기" (바구니: 딸기 네 개 담아 줘!)
  subject: (id) => `obj_${id}_sbj`, // "딸기가" (딸기가 네 개!)
};

// ---------- 문장 ----------
// group: LIST.md 구분, use: 쓰는 곳
const PHRASES = [
  ['공통', 'line_hello',        '안녕! 나는 콩콩이야. 같이 숫자 놀이 하자!', '시작 버튼 누른 뒤'],
  ['공통', 'line_pick_game',    '어떤 놀이 할까? 콕 눌러 봐!',              '메인 화면'],
  ['공통', 'line_retry',        '다시 한번 해 볼까?',                        '오답 후 재시도 (부정 표현 없이)'],
  ['공통', 'line_hint',         '이건 어때?',                                '힌트 (정답 대상 흔들기와 함께)'],
  ['공통', 'line_round_done',   '한 판 끝! 스티커 받아!',                    '한 판 완료 (스티커 지급)'],
  ['공통', 'line_bye_today',    '오늘은 여기까지! 내일 또 만나~',            '이용 시간 끝·잠금 화면'],
  ['공통', 'line_eye_rest',     '눈도 쉬어야 해. 저 멀리 한번 볼까?',        '쉬는 시간 알림'],
  ['공통', 'line_rest_done',    '눈이 쉬었어! 다시 놀자!',                   '쉬는 시간 끝 (▶ 누른 뒤)'],

  ['칭찬', 'praise_1', '잘했어!',          '정답 · 콩콩이·다른 친구 등장 시 (돌려 쓰기)'],
  ['칭찬', 'praise_2', '최고야!',          '정답 · 콩콩이·다른 친구 등장 시 (돌려 쓰기)'],
  ['칭찬', 'praise_3', '우와, 맞았어!',    '정답 · 콩콩이·다른 친구 등장 시 (돌려 쓰기)'],
  ['칭찬', 'praise_4', '티노도 신나!',     '정답 · 티노 등장 시에만'],
  ['칭찬', 'praise_5', '부릉부릉 출발~!',  '정답 · 부릉이 등장 시에만'],

  ['게임', 'line_count_intro',  '콕콕 눌러서 세어 보자!',    'count 시작'],
  ['게임', 'line_choose_q',     '몇 개일까?',                'choose 문제'],
  ['게임', 'line_choose_tap',   '맞는 숫자를 콕 눌러 줘!',   'choose 안내'],
  ['게임', 'line_basket_tail',  '담아 줘!',                  'basket 문제 끝말 (딸기 + 네 개 + 담아 줘!)'],
  ['게임', 'line_basket_done',  '바구니 가득! 고마워!',      'basket 완료'],
  ['게임', 'line_compare_q',    '어느 쪽이 더 많아?',        'compare 문제'],
  ['게임', 'line_compare_ans',  '이쪽이 더 많아!',           'compare 정답 확인'],
  ['게임', 'line_stones_intro', '처음부터 차례대로 건너 보자!', 'stones 시작'],
  ['게임', 'line_stones_done',  '와, 다 건넜다!',            'stones 완료'],

  ['포도판', 'line_grape_in',          '포도알 하나 쓱!',             '포도알 붙을 때'],
  ['포도판', 'line_grape_count_head',  '포도알이',                    '포도알 개수 앞말 (포도알이 + 일곱 개)'],
  ['포도판', 'line_bunch_full',        '포도송이를 다 채웠어!',       '송이 완성'],
  ['포도판', 'line_new_friend',        '새 친구가 왔어!',             '새 친구 합류'],
  ['포도판', 'line_show_parent',       '엄마 아빠한테 보여 주자!',    '보물 상자 화면'],
  ['포도판', 'line_board_done',        '포도판 완성!',                '5송이 완성'],
];

function build() {
  const lines = {};
  const add = (group, key, text, use) => { lines[key] = { group, text, use }; };

  PHRASES.forEach(([g, k, t, u]) => add(g, k, t, u));

  for (let n = 1; n <= NATIVE_MAX; n++) add('숫자 · 세기(고유어)', numKey.native(n), NATIVE[n - 1], '세기, 수 읽기');
  for (let n = 1; n <= SINO_MAX; n++) add('숫자 · 한자어', numKey.sino(n), SINO[n - 1], '수 읽기 "한자어"·"둘 다" 설정');
  for (let n = 1; n <= NATIVE_MAX; n++) add('숫자 · 개수', numKey.counter(n), `${COUNTER[n - 1]} 개`, '사과가 + 세 개 / 포도알이 + 일곱 개');
  for (let n = 1; n <= SINO_MAX; n++) {
    const s = SINO[n - 1];
    add('숫자 · 한자어 소개', numKey.intro(n), `${TOPIC[n - 1]} '${s}'${hasBatchim(s) ? '이라고도' : '라고도'} 해.`, '3단계 (수 읽기 "고유어"일 때)');
  }

  Object.entries(OBJECT_NAMES).forEach(([id, o]) => {
    add('물체 이름', objKey.name(id), o.name, 'basket 문제 (딸기 네 개 담아 줘!)');
    add('물체 이름', objKey.subject(id), o.subject, '개수 말하기 (사과가 세 개!)');
  });

  return lines;
}

export const LINES = build();

// ---------- 효과음 ----------
// 파일이 없으면 audio.js가 부드러운 합성음으로 대신한다. 부정 효과음은 만들지 않는다.
export const SFX = {
  sfx_tap:     { text: '톡 (짧고 부드러운 탭 소리)',   use: '물체·버튼 탭' },
  sfx_correct: { text: '띵동 (위로 올라가는 두 음)',   use: '정답' },
  sfx_pop:     { text: '쏙 (포도알 들어가는 소리)',    use: '포도알·스티커' },
  sfx_cheer:   { text: '짜잔 (세 음 올라가는 축하음)', use: '한 판 완료·송이 완성' },
};
