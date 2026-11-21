// 이용 시간 (설계서 §9 "시간" 항목)
// - 하루 이용 시간: 아이 화면(메인·게임·포도판)이 보이는 동안만 1초씩 센다.
//   부모 영역·시작 화면·잠금 화면·쉬는 시간 화면·앱이 백그라운드일 때는 세지 않는다.
// - 쉬는 시간 알림: 연속 이용이 설정 분을 넘으면 "눈 쉬자" 화면. 20초 쉰 뒤 ▶로 계속.
//   앱을 60초 이상 떠나 있었으면 연속 이용을 0으로 본다.
// - 잠금: 하루 이용 시간을 다 썼거나 이용 가능 시간대가 아니면 잠금 화면.
//   게임 중에는 지금 문제가 끝날 때까지 기다린다(문제 사이 checkpoint). 단, 최대 2분.
//   쉬는 시간 알림도 게임 중에는 문제 사이에서, 메인에서는 바로 띄운다.
// 위쪽 순수 함수(dayKey·isWithinHours·lockReason 등)는 DOM 없이 검사할 수 있다.

import { getSettings } from './settings.js';
import { addUsageSeconds, getUsageSeconds } from './progress.js';
import * as audio from './audio.js';

export const COUNTED_SCREENS = ['main', 'game', 'grapes'];
const FLUSH_EVERY_S = 10;       // 10초마다 저장
const REST_RESET_MS = 60_000;   // 60초 이상 떠나 있었으면 쉰 것으로 본다
const GAME_GRACE_S = 120;       // 게임 중 잠금 유예 최대 2분
export const BREAK_REST_S = 20; // 눈 쉬기: ▶가 나오기까지 20초

/* =========================================================
   순수 함수
   ========================================================= */
const pad = (n) => String(n).padStart(2, '0');

// 로컬 날짜 기준 "YYYY-MM-DD"
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 이용 가능 시간대 안인지.
// - 시작 < 끝: 시작 ≤ 지금 < 끝
// - 시작 > 끝: 밤을 넘기는 구간 (예: 20:00~07:00) → 지금 ≥ 시작 또는 지금 < 끝
// - 시작 = 끝: 쓸 수 있는 시간이 없다 (부모 화면에서 저장할 때 경고)
export function isWithinHours(date, hours) {
  if (!hours?.enabled) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  const s = toMinutes(hours.start);
  const e = toMinutes(hours.end);
  if (s === e) return false;
  return s < e ? now >= s && now < e : now >= s || now < e;
}

// 잠금 이유: 'hours'(시간대 밖) | 'daily'(오늘 시간 다 씀) | null
export function lockReason(now, settings, usedSecondsToday) {
  if (!isWithinHours(now, settings.allowedHours)) return 'hours';
  if (usedSecondsToday >= settings.dailyLimitMin * 60) return 'daily';
  return null;
}

export function remainingSeconds(settings, usedSecondsToday) {
  return Math.max(0, settings.dailyLimitMin * 60 - usedSecondsToday);
}

// 오늘을 끝으로 하는 최근 n일의 날짜 키 (오래된 날 → 오늘)
export function recentDays(n, today = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1 - i));
    return { key: dayKey(d), date: d };
  });
}

/* =========================================================
   실행 중 측정
   ========================================================= */
let hooks = { getScreen: () => '', onLock: () => {}, onUnlock: () => {} };
let pending = 0;               // 아직 저장하지 않은 초
let pendingDay = dayKey();
let continuous = 0;            // 연속 이용 초 (쉬는 시간 알림용)
let hiddenAt = null;
let graceUsed = 0;             // 게임 중 잠금 유예로 기다린 초
let breakDue = false;
let breakOpen = false;
let breakResolve = null;
let breakTimer = 0;

const $ = (sel) => document.querySelector(sel);

export function usedToday(now = new Date()) {
  const k = dayKey(now);
  return getUsageSeconds(k) + (pendingDay === k ? pending : 0);
}

export function currentLockReason(now = new Date()) {
  return lockReason(now, getSettings(), usedToday(now));
}

export function flush() {
  if (pending > 0) addUsageSeconds(pendingDay, pending);
  pending = 0;
  pendingDay = dayKey();
}

export function initUsage(opts) {
  hooks = { ...hooks, ...opts };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flush);
  $('#break-next').addEventListener('click', () => closeBreak(true));
  setInterval(tick, 1000);
}

function onVisibility() {
  if (document.hidden) {
    flush();
    hiddenAt = Date.now();
  } else {
    if (hiddenAt !== null && Date.now() - hiddenAt >= REST_RESET_MS) {
      continuous = 0;
      breakDue = false;
    }
    hiddenAt = null;
  }
}

function tick() {
  if (document.hidden) return;
  const now = new Date();
  if (dayKey(now) !== pendingDay) flush(); // 자정이 지나면 어제 몫을 먼저 저장

  const screen = hooks.getScreen();
  const counted = COUNTED_SCREENS.includes(screen) && !breakOpen;
  if (counted) {
    pending++;
    continuous++;
    if (pending >= FLUSH_EVERY_S) flush();
  }

  const s = getSettings();
  if (s.breakReminderMin > 0 && continuous >= s.breakReminderMin * 60) breakDue = true;

  const reason = lockReason(now, s, usedToday(now));

  // 잠금 화면: 풀릴 조건이 되면 (자정, 시간대 시작, 부모가 시간 늘림) 메인으로
  if (screen === 'lock') {
    if (!reason) hooks.onUnlock();
    return;
  }

  if (reason && COUNTED_SCREENS.includes(screen)) {
    if (screen === 'game') {
      // 게임 중: 문제 사이(checkpoint)에서 잠그되, 최대 2분까지만 기다린다
      graceUsed++;
      if (graceUsed >= GAME_GRACE_S) lockNow();
    } else {
      lockNow();
    }
    return;
  }
  graceUsed = 0;

  if (breakDue && !breakOpen && screen === 'main') openBreak();
}

export function lockNow() {
  graceUsed = 0;
  flush();
  closeBreak(false);
  hooks.onLock();
}

// 게임의 문제와 문제 사이에서 play.js가 부른다. 반환: 'continue' | 'lock' | 'aborted'
export async function checkpoint(signal) {
  if (currentLockReason()) {
    lockNow();
    return 'lock';
  }
  if (breakDue) {
    await openBreak(signal);
    if (signal?.aborted) return 'aborted';
    if (currentLockReason()) {
      lockNow();
      return 'lock';
    }
  }
  return 'continue';
}

/* ---------- 쉬는 시간 화면 ---------- */
function openBreak(signal) {
  if (breakOpen) return Promise.resolve();
  breakOpen = true;
  const layer = $('#break-layer');
  const next = $('#break-next');
  next.classList.remove('show');
  layer.hidden = false;
  layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-in-out' });
  audio.say('line_eye_rest'); // 눈도 쉬어야 해. 저 멀리 한번 볼까?
  clearTimeout(breakTimer);
  breakTimer = setTimeout(() => next.classList.add('show'), BREAK_REST_S * 1000);
  return new Promise((resolve) => {
    breakResolve = resolve;
    signal?.addEventListener('abort', () => closeBreak(false), { once: true });
  });
}

function closeBreak(byChild) {
  if (!breakOpen) return;
  // ▶는 20초가 지나 보일 때만 누를 수 있다
  if (byChild && !$('#break-next').classList.contains('show')) return;
  clearTimeout(breakTimer);
  breakOpen = false;
  breakDue = false;
  continuous = 0;
  $('#break-layer').hidden = true;
  if (byChild) audio.say('line_rest_done'); // 눈이 쉬었어! 다시 놀자!
  const r = breakResolve;
  breakResolve = null;
  r?.();
}

// 개발 확인용: 콘솔에서 (await import('./js/usage.js')).debugUsage()
export function debugUsage() {
  return { usedToday: usedToday(), pending, continuous, breakDue, breakOpen, graceUsed, lock: currentLockReason() };
}
