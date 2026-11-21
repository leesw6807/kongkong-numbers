// 게임 공통 도우미 (js/games/*.js에서 사용)
// DOM·저장소에 의존하지 않는 순수 함수는 Node에서도 검사할 수 있게 여기 둔다.

export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// 아무것도 누르지 않을 때 연달아 내는 힌트는 최대 3번 (설계서 §1 "주목·힌트 최대 3회").
// 그 뒤로는 조용히 기다리고, 아이가 한 번이라도 누르면 다시 0부터 센다.
export const MAX_IDLE_HINTS = 3;

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const wait = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

// 게임마다 하나씩 만들어 "직전 문제와 같은 수·물체 피하기"를 따로 기억한다.
//   count(range, level): 단계 범위 안의 수. 2단계 이상은 2부터 (1개는 너무 쉬움)
//   object(objects):     직전과 다른 물체
export function makePicker() {
  let lastN = 0;
  let lastObject = '';
  return {
    count({ min, max }, level) {
      const lo = level >= 2 ? Math.max(min, 2) : min;
      let n = randInt(lo, max);
      for (let i = 0; i < 10 && n === lastN && max > lo; i++) n = randInt(lo, max);
      lastN = n;
      return n;
    },
    object(objects) {
      const pool = objects.filter((o) => o.id !== lastObject);
      const o = pool[Math.floor(Math.random() * pool.length)];
      lastObject = o.id;
      return o;
    },
  };
}

// 어느 쪽이 많아? 두 수 고르기 (설계서 §6 compare)
// - 1단계: 1~3 중 서로 다른 두 수
// - 2단계: 1~5 중 2 이상 차이 (눈으로 비교하기 쉬움)
// - 3단계: 2~10 중 1~3 차이 (가까운 수 비교)
// 직전과 같은 조합(순서 무관)은 피한다. 반환: [작은 수, 큰 수]
export function pickComparePair(level, { min, max }, lastKey = '') {
  const pairs = [];
  const lo = level >= 3 ? Math.max(min, 2) : min;
  for (let a = lo; a <= max; a++) {
    for (let b = a + 1; b <= max; b++) {
      const d = b - a;
      if (level === 1 || (level === 2 && d >= 2) || (level >= 3 && d <= 3)) pairs.push([a, b]);
    }
  }
  const pool = pairs.length > 1 ? pairs.filter((p) => p.join(',') !== lastKey) : pairs;
  return pool[Math.floor(Math.random() * pool.length)];
}

// 많은 쪽 위치: 왼쪽·오른쪽을 무작위로 하되 같은 쪽이 3번 연속 나오지 않게 한다.
export function makeSidePicker() {
  const recent = [];
  return () => {
    let side = Math.random() < 0.5 ? 'left' : 'right';
    if (recent.length >= 2 && recent.at(-1) === recent.at(-2) && recent.at(-1) === side) {
      side = side === 'left' ? 'right' : 'left';
    }
    recent.push(side);
    if (recent.length > 2) recent.shift();
    return side;
  };
}

// 징검다리 돌 숫자 고르기 (설계서 §6 stones). 이어지는 수 len개, start부터.
// - 1단계: 1~3 (3개)
// - 2단계: 1~4 또는 2~5 (4개)
// - 3단계: 1~10 안에서 이어지는 5개 (시작 1~6)
// 직전과 같은 구간은 피한다(가능할 때).
export function pickStoneRun(level, lastStart = 0) {
  if (level <= 1) return { start: 1, len: 3 };
  const len = level === 2 ? 4 : 5;
  const maxStart = level === 2 ? 2 : 6;
  const starts = Array.from({ length: maxStart }, (_, i) => i + 1).filter((s) => s !== lastStart);
  return { start: starts[Math.floor(Math.random() * starts.length)], len };
}

// 돌 자리 섞기: 숫자 순서 → 자리 번호. 2단계 이상은 이미 순서대로인 배치를 피한다
// (왼쪽부터 누르기만 하면 숫자를 몰라도 건너게 되므로).
export function shuffleStoneSlots(len, level) {
  const sorted = Array.from({ length: len }, (_, i) => i);
  let order = shuffle(sorted);
  for (let i = 0; i < 20 && level >= 2 && order.every((v, k) => v === k); i++) order = shuffle(sorted);
  return order; // order[k] = k번째 숫자(start + k)를 놓을 자리
}

// 숫자 보기 고르기 (설계서 §6 choose): 정답 n + 오답 (cardCount - 1)개, 순서는 섞는다.
// - 오답은 정답과 가까운 수(±2)를 먼저, 모자라면 먼 수.
// - 정답이 늘 "제일 큰 수"가 되지 않게 오답에는 범위보다 하나 큰 수까지 쓴다(최대 CHOICE_MAX).
// - 정답이 몇 번째 크기일지(아래 오답 개수)를 가능한 값 중에서 고르게 먼저 정한다.
export const CHOICE_MAX = 10;
export function pickChoices(n, { min, max }, cardCount, random = Math.random) {
  const k = Math.max(cardCount - 1, 0);
  const top = Math.min(max + 1, CHOICE_MAX);
  // 가까운 것 먼저(±2 안은 무작위), 그다음 먼 것(무작위)
  const order = (list) => {
    const near = shuffle(list.filter((v) => Math.abs(v - n) <= 2));
    const far = shuffle(list.filter((v) => Math.abs(v - n) > 2));
    return [...near, ...far];
  };
  const below = [];
  const above = [];
  for (let v = min; v < n; v++) below.push(v);
  for (let v = n + 1; v <= top; v++) above.push(v);
  // 아래 오답 개수 b가 될 수 있는 범위 → 그중 하나를 고르게
  const bMin = Math.max(0, k - above.length);
  const bMax = Math.min(k, below.length);
  const b = bMax >= bMin ? bMin + Math.floor(random() * (bMax - bMin + 1)) : below.length;
  const picked = [...order(below).slice(0, b), ...order(above).slice(0, k - b)];
  return shuffle([n, ...picked]);
}
