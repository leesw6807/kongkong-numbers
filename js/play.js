// 게임 공통 흐름 (설계서 §5 난이도, §12 2단계)
// - 한 판 = 문제 N개 (부모 설정 "한 판 문제 수")
// - 단계: 부모 설정 "난이도"가 자동이면 적응형, 1~3단계를 고르면 고정
// - 단계 변화는 아이에게 표시하지 않는다 (콘솔에만 남긴다)
//
// 게임 모듈 규약 (js/games/*.js):
//   export default { id, async playQuestion(ctx) → { result: 'correct'|'hinted'|'wrong', aborted? } }
//   ctx = { stage, level, range: {min, max}, numberStyle, hintDelayMs, first, introNeeded, misses, signal }
//   misses: 직전까지 연속으로 틀린 문제 수 (2 이상이면 첫 오답부터 강한 힌트)
//   signal(AbortSignal)이 abort되면 화면을 정리하고 곧바로 { aborted: true }로 끝낸다.

import { getSettings } from './settings.js';
import * as audio from './audio.js';
import { pulse } from './effects.js';
import { createBuddy, nextBuddy } from './buddy.js';
import { getGame, getProgress, setAdaptive, recordAnswer, addSticker } from './progress.js';
import { cheerRound, createStickerBoard } from './celebrate.js';
import { openGrapes } from './grapes.js';
import { checkpoint, currentLockReason, lockNow } from './usage.js';
import count from './games/count.js';
import choose from './games/choose.js';
import basket from './games/basket.js';
import compare from './games/compare.js';
import stones from './games/stones.js';

const IMPLEMENTED = { count, choose, basket, compare, stones };

// 단계별 수 범위 (설계서 §5)
export const LEVEL_RANGE = {
  1: { min: 1, max: 3 },
  2: { min: 1, max: 5 },
  3: { min: 1, max: 10 },
};

const UP_AFTER = 3;    // 3연속 정답 → 한 단계 위
const DOWN_AFTER = 3;  // 2연속 오답 → 강한 힌트, 그 후에도 오답(3번째) → 한 단계 아래

/* ---------- 적응형 단계 (게임별로 progress.js에 저장) ---------- */
function stateOf(id) {
  const { level, streak, misses } = getGame(id);
  return { level, streak, misses };
}

export function currentLevel(id) {
  const d = getSettings().difficulty;
  return d === 'auto' ? stateOf(id).level : d;
}

// 한 문제 결과 반영. 정답률 통계는 항상 남기고, 단계 조정은 난이도 "자동"일 때만 한다.
// number: 오답일 때 정답이었던 수 (자주 틀리는 숫자 통계)
export function report(id, result, number) {
  recordAnswer(id, result, number);
  if (getSettings().difficulty !== 'auto') return;
  const st = stateOf(id);
  const before = st.level;
  if (result === 'correct') {
    st.streak++;
    st.misses = 0;
    if (st.streak >= UP_AFTER) {
      st.level = Math.min(st.level + 1, 3);
      st.streak = 0;
    }
  } else if (result === 'hinted') {
    st.streak = 0;
  } else if (result === 'wrong') {
    st.streak = 0;
    st.misses++;
    if (st.misses >= DOWN_AFTER) {
      st.level = Math.max(st.level - 1, 1);
      st.misses = 0;
    }
  }
  setAdaptive(id, st);
  if (st.level !== before) console.info(`[단계] ${id}: ${before} → ${st.level}`);
}

// 연속 오답 수 (게임이 "2연속 오답 → 강한 힌트"를 판단할 때 사용)
export function missCount(id) {
  return stateOf(id).misses;
}

// 개발 확인용: 콘솔에서 (await import('./js/play.js')).debugState()
export function debugState() {
  const p = getProgress();
  return {
    games: Object.fromEntries(Object.entries(p.games).map(([k, g]) => [k, { level: g.level, streak: g.streak, misses: g.misses, ...g.stats }])),
    stickers: p.stickers,
    stickersTotal: p.stickersTotal,
    pendingGrapes: p.pendingGrapes,
  };
}

/* ---------- 한 판 진행 ---------- */
let showScreen = () => {};
let session = null;

const wait = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export function initPlay(opts) {
  showScreen = opts.showScreen;
  document.querySelector('#btn-home').addEventListener('click', () => {
    stopGame();
    showScreen('main');
  });
}

export function isPlayable(id) {
  return Boolean(IMPLEMENTED[id]);
}

export function stopGame() {
  session?.abort();
  session = null;
  audio.stop();
}

export async function startGame(id) {
  const game = IMPLEMENTED[id];
  if (!game) return false;
  stopGame();
  const ac = new AbortController();
  session = ac;
  const { signal } = ac;

  const stage = document.querySelector('#game-stage');
  stage.replaceChildren();
  stage.dataset.game = id;
  showScreen('game');

  const total = getSettings().questionsPerRound;
  let introDone = false;

  for (let i = 0; i < total; i++) {
    if (signal.aborted) return false;
    const s = getSettings();
    const level = currentLevel(id);
    // 수 읽기 "고유어"일 때만 3단계에서 한자어를 한 판에 한 번 소개 (설계서 §4)
    const introNeeded = s.numberStyle === 'native' && level === 3 && !introDone;
    console.info(`[게임] ${id} ${i + 1}/${total} · ${level}단계`);

    const r = await game.playQuestion({
      stage,
      level,
      range: LEVEL_RANGE[level],
      numberStyle: s.numberStyle,
      hintDelayMs: Math.max(s.hintDelaySec * 1000, 1500), // "바로"도 1.5초는 기다린다
      first: i === 0,
      introNeeded,
      misses: missCount(id),
      signal,
    });
    if (r?.aborted || signal.aborted) return false;
    if (introNeeded) introDone = true;
    report(id, r.result, r.number);
    await wait(500, signal);

    // 문제와 문제 사이: 이용 시간이 끝났으면 잠그고, 쉬는 시간이면 눈 쉬기 화면 (usage.js)
    if (i < total - 1) {
      const cp = await checkpoint(signal);
      if (cp !== 'continue') return false;
    }
  }

  const stickersFull = await roundEnd(stage, signal);
  if (signal.aborted) return false;
  session = null;
  // 마지막 문제까지 마친 판은 스티커를 준 뒤에 잠근다 (받을 포도알은 다음에 포도판을 열 때 붙는다)
  if (currentLockReason()) {
    lockNow();
    return true;
  }
  // 스티커 5칸이 찼으면 바로 포도판으로 가서 포도알을 붙인다
  if (stickersFull) openGrapes();
  else showScreen('main');
  return true;
}

// 한 판 완료: 스티커 1개 지급 + 축하 친구 2~3명 (설계서 §2, §3)
// 스티커가 5칸 차면 progress.js가 칸을 비우고 "받을 포도알"을 늘린다 → 끝나면 포도판에서 붙인다.
// 반환: 스티커 5칸이 찼는지
async function roundEnd(stage, signal) {
  if (signal.aborted) return false;
  const sticker = addSticker(); // 끝까지 마친 판이므로 중간에 나가도 스티커는 이미 받은 것
  const kong = createBuddy({ idle: false }); // 이 판의 메인 캐릭터
  nextBuddy(); // 다음 판(메인 화면부터)은 다른 캐릭터 (설계서 §2 "메인 캐릭터")
  const { board, popNew } = createStickerBoard(sticker.count);
  const box = document.createElement('div');
  box.className = 'round-end';
  box.append(kong, board);
  stage.replaceChildren(box);

  audio.sfx('cheer');
  pulse(kong, 2);
  const friends = cheerRound({ signal });
  await wait(450, signal);
  if (signal.aborted) return sticker.full;
  await popNew();
  if (signal.aborted) return sticker.full;
  await Promise.all([friends, audio.say('line_round_done')]);
  await wait(600, signal);
  return sticker.full;
}
