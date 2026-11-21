// 포도판 (설계서 §3) — 데이터 "kongkong.grapes" + 화면
// - 포도판 = 포도송이 5개. 송이당 포도알 수는 판을 만들 때의 부모 설정 값으로 고정된다.
//   (포도알이 하나도 없는 판은 아직 시작 전으로 보고, 부모 설정이 바뀌면 그 값을 따른다)
// - 스티커 5개 → progress.pendingGrapes 1개 → 이 파일이 꺼내서 포도알로 붙인다.
// - 포도알이 붙을 때: 콩콩이 쪽에서 데굴데굴 굴러가 빈 자리에 쓱 → "포도알 하나 쓱!" → "포도알이 일곱 개"
// - 송이 완성: 친구 전원 축하 → 새 친구 합류 → 보물 상자 화면 (부모가 "보상 줌"을 누를 때까지 보상 대기)
// - 5송이 완성: "포도판 완성!" 큰 축하, 완성 판 수 기록. 부모가 새 포도판을 시작할 때까지 그대로 둔다.

import { getSettings, getSetting, STORAGE_PREFIX, OPTIONS } from './settings.js';
import { takePendingGrape, joinNextFriend } from './progress.js';
import { createKong } from './assets.js';
import * as audio from './audio.js';
import { pulse, isReduceMotion } from './effects.js';
import { cheerAll, friendPool, showNewFriend } from './celebrate.js';

export const BUNCHES = 5;
const KEY = `${STORAGE_PREFIX}grapes`;
const HISTORY_MAX = 50;

// 송이 모양: 위가 넓고 아래로 좁아지는 줄 (합 = 송이당 포도알 수)
const ROWS = { 5: [3, 2], 10: [4, 3, 2, 1], 15: [5, 4, 3, 2, 1], 20: [6, 5, 4, 3, 2] };
const GRAPE_SIZE = { 5: 50, 10: 40, 15: 34, 20: 28 };

/* =========================================================
   데이터
   ========================================================= */
const now = () => new Date().toISOString();
const int = (v, min, max, def) => (Number.isInteger(v) && v >= min && v <= max ? v : def);
const str = (v) => (typeof v === 'string' && v.length <= 40 ? v : null);

function makeBoard(perBunch) {
  return {
    perBunch,
    startedAt: now(),
    completedAt: null,
    bunches: Array.from({ length: BUNCHES }, () => ({
      filled: 0, completedAt: null, rewardGiven: false, rewardGivenAt: null,
    })),
  };
}

function defaults() {
  return { version: 1, board: makeBoard(getSettings().grapesPerBunch), boardsCompleted: 0, history: [] };
}

function sanitize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const b = raw.board && typeof raw.board === 'object' ? raw.board : {};
  const per = OPTIONS.grapesPerBunch.includes(b.perBunch) ? b.perBunch : d.board.perBunch;
  const board = makeBoard(per);
  board.startedAt = str(b.startedAt) ?? board.startedAt;
  board.bunches = board.bunches.map((_, i) => {
    const s = Array.isArray(b.bunches) ? b.bunches[i] : null;
    const filled = int(s?.filled, 0, per, 0);
    const full = filled === per;
    const given = full && s?.rewardGiven === true;
    return {
      filled,
      completedAt: full ? str(s?.completedAt) : null,
      rewardGiven: given,
      rewardGivenAt: given ? str(s?.rewardGivenAt) : null,
    };
  });
  board.completedAt = board.bunches.every((x) => x.filled === per) ? str(b.completedAt) : null;
  return {
    version: 1,
    board,
    boardsCompleted: int(raw.boardsCompleted, 0, 1e6, 0),
    history: Array.isArray(raw.history)
      ? raw.history.filter((h) => h && typeof h === 'object').slice(-HISTORY_MAX).map((h) => ({
        startedAt: str(h.startedAt),
        endedAt: str(h.endedAt),
        perBunch: OPTIONS.grapesPerBunch.includes(h.perBunch) ? h.perBunch : null,
        grapes: int(h.grapes, 0, BUNCHES * 20, 0),
        complete: h.complete === true,
      }))
      : [],
  };
}

let memory = null;

function load() {
  let g;
  let t;
  try {
    t = localStorage.getItem(KEY);
  } catch {
    t = undefined; // 저장소를 쓸 수 없음 → 이번 실행 동안의 메모리 기록
  }
  if (t === undefined) g = memory ? structuredClone(memory) : sanitize(null);
  else if (t === null) g = sanitize(null); // 저장된 판 없음 (복원·삭제 직후 포함) → 옛 메모리를 되살리지 않는다
  else {
    try { g = sanitize(JSON.parse(t)); } catch { g = sanitize(null); }
  }
  // 아직 포도알이 하나도 없는 판은 부모 설정의 송이당 포도알 수를 따른다
  const setting = getSetting('grapesPerBunch');
  if (totalGrapes(g.board) === 0 && g.board.perBunch !== setting) g.board.perBunch = setting;
  return g;
}

function save(g) {
  memory = structuredClone(g);
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch (e) {
    console.warn('[grapes] 저장 실패 — 이번 실행 동안만 기억합니다', e);
  }
}

export function totalGrapes(board) {
  return board.bunches.reduce((s, b) => s + b.filled, 0);
}

export function getGrapes() {
  return load();
}

// 지금 채우는 송이 번호 (0~4). 다 찼으면 -1
export function currentBunch(board) {
  return board.bunches.findIndex((b) => b.filled < board.perBunch);
}

export function isBoardFull(board) {
  return currentBunch(board) === -1;
}

// 포도알 1개 붙이기 (데이터만). 반환: { bunchIndex, filled, perBunch, bunchFull, boardFull } 또는 null(판이 다 참)
function addGrape() {
  const g = load();
  const i = currentBunch(g.board);
  if (i < 0) return null;
  const b = g.board.bunches[i];
  b.filled++;
  const bunchFull = b.filled === g.board.perBunch;
  if (bunchFull) b.completedAt = now();
  const boardFull = isBoardFull(g.board);
  if (boardFull) {
    g.board.completedAt = now();
    g.boardsCompleted++;
  }
  save(g);
  return { bunchIndex: i, filled: b.filled, perBunch: g.board.perBunch, bunchFull, boardFull };
}

// 부모 메뉴 "보상 줌" — 다 채운 송이에만
export function markRewardGiven(i) {
  const g = load();
  const b = g.board.bunches[i];
  if (!b || b.filled < g.board.perBunch || b.rewardGiven) return false;
  b.rewardGiven = true;
  b.rewardGivenAt = now();
  save(g);
  return true;
}

// 부모 메뉴 "포도판 새로 시작" — 지금 판을 기록에 남기고 빈 판으로 (송이당 포도알 수는 지금 설정)
export function startNewBoard() {
  const g = load();
  g.history.push({
    startedAt: g.board.startedAt,
    endedAt: now(),
    perBunch: g.board.perBunch,
    grapes: totalGrapes(g.board),
    complete: isBoardFull(g.board),
  });
  g.history = g.history.slice(-HISTORY_MAX);
  g.board = makeBoard(getSetting('grapesPerBunch'));
  save(g);
  return g;
}

/* =========================================================
   화면
   ========================================================= */
let showScreen = () => {};
let session = null;
let treasureResolve = null;

const $ = (sel) => document.querySelector(sel);
const finished = (anim) => anim.finished.then(() => {}, () => {});
const wait = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function initGrapes(opts) {
  showScreen = opts.showScreen;
  $('#grapes-home').addEventListener('click', closeGrapes);
  $('#grapes-kong').append(createKong({ small: true }));
  $('#treasure').prepend(createKong()); // 보물 상자 화면에서 "엄마 아빠한테 보여 주자!" 하는 콩콩이
  $('#treasure-next').addEventListener('click', () => {
    const r = treasureResolve;
    treasureResolve = null;
    r?.();
  });
}

// 포도판 연출을 멈춘다 (잠금 등). 화면 전환은 부르는 쪽이 한다.
export function stopGrapes() {
  session?.abort();
  session = null;
  hideTreasure();
}

function closeGrapes() {
  stopGrapes();
  audio.stop();
  showScreen('main');
}

// 포도판 열기: 판을 보여 주고, 받을 포도알이 있으면 하나씩 굴려 넣는다
export async function openGrapes() {
  session?.abort();
  const ac = new AbortController();
  session = ac;
  const { signal } = ac;
  hideTreasure();
  renderBoard(getGrapes());
  showScreen('grapes');
  await wait(600, signal);
  if (!signal.aborted) await applyPending(signal);
}

/* ---------- 판 그리기 ---------- */
// 반환: slot(bunchIndex, k) → 포도알 자리 요소, bunch(i) → 송이 요소
function renderBoard(g, { incoming } = {}) {
  const board = g.board;
  const cur = currentBunch(board);
  const root = $('#grape-board');
  // 포도알 크기: 기본값과 "송이 폭에 가장 긴 줄이 들어가는 크기" 중 작은 쪽 (송이 안쪽 여백 26px, 알 사이 6px)
  const maxRow = Math.max(...ROWS[board.perBunch]);
  root.style.setProperty('--g', `min(${GRAPE_SIZE[board.perBunch]}px, calc((var(--bunch-w) - 26px - ${(maxRow - 1) * 6}px) / ${maxRow}))`);
  const slotRefs = [];
  const bunchEls = board.bunches.map((b, i) => {
    const full = b.filled === board.perBunch;
    const bunch = el('div', 'bunch');
    bunch.dataset.i = String(i);
    bunch.classList.toggle('current', i === cur);
    bunch.classList.toggle('full', full);
    bunch.classList.toggle('given', b.rewardGiven);

    const top = el('div', 'bunch-top');
    top.append(el('span', 'stem'), el('span', 'leaf'));
    if (b.rewardGiven) top.append(el('span', 'ribbon', '🎀'));
    bunch.append(top);

    const grapes = el('div', 'grapes');
    const slots = [];
    let k = 0;
    for (const n of ROWS[board.perBunch]) {
      const row = el('div', 'grape-row');
      for (let j = 0; j < n; j++, k++) {
        const s = el('span', 'grape-slot');
        if (k < b.filled) s.classList.add('filled');
        if (incoming && incoming.bunchIndex === i && incoming.filled - 1 === k) s.classList.add('incoming');
        row.append(s);
        slots.push(s);
      }
      grapes.append(row);
    }
    bunch.append(grapes);
    slotRefs.push(slots);

    // 송이 아래: 채우는 중이면 지금 개수(숫자), 다 찼고 보상 전이면 선물 상자(보상 대기)
    const foot = el('div', 'bunch-foot');
    if (i === cur && b.filled > 0) foot.append(el('span', 'bunch-count', String(b.filled)));
    if (full && !b.rewardGiven) foot.append(el('span', 'gift', '🎁'));
    bunch.append(foot);
    return bunch;
  });
  root.replaceChildren(...bunchEls);
  root.classList.toggle('complete', isBoardFull(board));
  return {
    slot: (i, k) => slotRefs[i]?.[k],
    bunch: (i) => bunchEls[i],
    all: bunchEls,
  };
}

/* ---------- 포도알 굴려 넣기 ---------- */
async function rollInto(slot, signal) {
  if (isReduceMotion()) return; // 움직임 줄이기: 이동 없이 자리에서 나타난다 (아래 pulse)
  const screen = $('#screen-grapes');
  const sr = screen.getBoundingClientRect();
  const from = $('#grapes-kong').getBoundingClientRect();
  const to = slot.getBoundingClientRect();
  const fly = el('div', 'grape-fly');
  Object.assign(fly.style, {
    left: `${to.left - sr.left}px`,
    top: `${to.top - sr.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
  });
  screen.append(fly);
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height * 0.3 - (to.top + to.height / 2);
  const onAbort = () => fly.remove();
  signal.addEventListener('abort', onAbort, { once: true });
  await finished(fly.animate([
    { transform: `translate(${dx}px, ${dy}px) rotate(-720deg) scale(1.5)` },
    { transform: 'translate(0, 0) rotate(0deg) scale(1)' },
  ], { duration: 1100, easing: 'ease-in-out' }));
  signal.removeEventListener('abort', onAbort);
  fly.remove();
}

async function applyPending(signal) {
  while (!signal.aborted) {
    if (isBoardFull(getGrapes().board)) return; // 다 찬 판에는 넣지 않는다 (새 포도판까지 보관)
    if (!takePendingGrape()) return;
    const res = addGrape();
    if (!res) return;

    // 데이터는 이미 저장됨 → 중간에 나가도 포도알은 남는다
    const refs = renderBoard(getGrapes(), { incoming: res });
    const slot = refs.slot(res.bunchIndex, res.filled - 1);
    await rollInto(slot, signal);
    if (signal.aborted) return;
    slot.classList.remove('incoming');
    audio.sfx('pop');
    pulse(slot);
    await audio.say('line_grape_in');                 // 포도알 하나 쓱!
    if (signal.aborted) return;
    const count = refs.bunch(res.bunchIndex).querySelector('.bunch-count');
    if (count) pulse(count);
    await audio.sayGrapeCount(res.filled);            // 포도알이 일곱 개
    if (signal.aborted) return;

    if (res.bunchFull) {
      await bunchComplete(res.bunchIndex, refs, signal);
      if (signal.aborted) return;
    }
    if (res.boardFull) {
      await boardComplete(signal);
      return;
    }
    await wait(400, signal);
  }
}

/* ---------- 송이 완성 ---------- */
async function bunchComplete(i, refs, signal) {
  const friendsBefore = friendPool();
  const newFriend = joinNextFriend(); // 먼저 저장 (중간에 나가도 합류는 유지)
  renderBoard(getGrapes());
  const bunch = $('#grape-board').children[i];
  pulse(bunch, 2);
  audio.sfx('cheer');
  await Promise.all([cheerAll({ signal, friends: friendsBefore }), audio.say('line_bunch_full')]);
  if (signal.aborted) return;
  if (newFriend) {
    await Promise.all([showNewFriend(newFriend, { signal }), audio.say('line_new_friend')]);
    if (signal.aborted) return;
  }
  await showTreasure(i, signal);
}

/* ---------- 보물 상자 ---------- */
// 콩콩이가 "엄마 아빠한테 보여 주자!" — 등록된 보상 그림을 크게, 글은 작게 (UX 원칙 1 예외)
async function showTreasure(i, signal) {
  const reward = getSetting('rewards')[i] ?? { text: '', emoji: '' };
  const t = $('#treasure');
  const emoji = $('#treasure-emoji');
  const text = $('#treasure-text');
  emoji.textContent = '🎁';
  text.textContent = '';
  t.hidden = false;
  t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-in-out' });

  // ▶는 보물 상자가 열린 순간부터 받는다 (말하는 도중에 눌러도 바로 닫힘)
  let closed = false;
  const tapped = new Promise((resolve) => {
    treasureResolve = () => { closed = true; resolve(); };
    signal.addEventListener('abort', resolve, { once: true });
  });

  audio.say('line_show_parent');
  const reveal = (async () => {
    await wait(900, signal);
    if (signal.aborted || closed) return;
    if (reward.emoji || reward.text) {
      if (reward.emoji) emoji.textContent = reward.emoji;
      text.textContent = reward.text;
      audio.sfx('pop');
      pulse($('#treasure-plate'), 2);
    }
  })();

  // 아이가 ▶를 누를 때까지 보물 상자를 보여 준다. 누르면 그림이 나오기 전이어도 바로 닫는다.
  await tapped;
  void reveal; // 닫힌 뒤에는 reveal이 아무것도 바꾸지 않는다 (closed 확인)
  treasureResolve = null;
  if (closed) audio.stop();
  hideTreasure();
}

function hideTreasure() {
  const t = $('#treasure');
  if (t) t.hidden = true;
  treasureResolve = null;
}

/* ---------- 포도판 완성 ---------- */
async function boardComplete(signal) {
  renderBoard(getGrapes());
  $('#grape-board').querySelectorAll('.bunch').forEach((b) => pulse(b, 2));
  audio.sfx('cheer');
  await Promise.all([cheerAll({ signal }), audio.say('line_board_done')]); // 포도판 완성!
}
