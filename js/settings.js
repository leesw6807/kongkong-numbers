// 부모 설정 데이터 (설계서 §9 "부모 설정 항목")
// - 기본값, 값 검증, localStorage 저장, 변경 알림을 담당한다. 화면은 js/parent.js.
// - 저장된 값은 항상 sanitize()를 거친다: 모르는 값·잘못된 값은 기본값으로 돌아간다.
// - 백업·복원은 "kongkong." 으로 시작하는 저장 항목 전체(설정 + 앞으로 생길 진행·포도판)를 다룬다.

import { GAMES, FRIENDS, NEW_FRIENDS } from './assets.js';

const ALL_FRIEND_IDS = [...FRIENDS, ...NEW_FRIENDS].map((f) => f.id);

export const STORAGE_PREFIX = 'kongkong.';
const KEY = `${STORAGE_PREFIX}settings`;
export const SETTINGS_VERSION = 1;

export const REWARD_SLOTS = 5;          // 포도송이 5개
export const REWARD_TEXT_MAX = 30;      // 보상 글 최대 글자 수
export const REWARD_EMOJIS = ['🍦', '🧸', '🏞️', '📚', '🎈', '🎁', '🍰', '🎨', '🧩', '🚲', '🎡', '🍕'];

// 선택지 (값 목록) — 화면의 라벨은 parent.js에서 붙인다
export const OPTIONS = {
  difficulty: ['auto', 1, 2, 3],
  numberStyle: ['native', 'sino', 'both'],
  questionsPerRound: [3, 4, 5],
  hintDelaySec: [0, 5, 10],
  dailyLimitMin: [5, 10, 15, 20],
  breakReminderMin: [0, 5, 10],
  voiceRate: ['slow', 'normal'],
  grapesPerBunch: [5, 10, 15, 20],
  buddyMode: ['even', 'priority'],
  sfxStyle: ['glocken', 'piano', 'softPiano', 'musicBox'],
};

function makeDefaults() {
  return {
    version: SETTINGS_VERSION,
    // 학습
    difficulty: 'auto',
    numberStyle: 'native',
    gamesEnabled: Object.fromEntries(GAMES.map((g) => [g.id, true])),
    questionsPerRound: 3,
    hintDelaySec: 5,
    // 시간
    dailyLimitMin: 10,
    breakReminderMin: 5,
    allowedHours: { enabled: false, start: '07:00', end: '20:00' },
    // 소리
    volume: { voice: 70, sfx: 60 },      // 배경음은 넣지 않는다 (설계서 §9)
    voiceRate: 'slow',
    voiceName: '',                       // TTS 목소리 ('' = 자동: 가장 자연스러운 목소리)
    sfxStyle: 'glocken',                 // 효과음 소리 (설계서 §7)
    // 화면
    dimScreen: false,
    reduceMotion: false,
    // 보상
    favoriteFriend: null,                // null = 골고루
    buddyMode: 'even',                   // 메인 캐릭터: 골고루 | 우선순위대로 (설계서 §2)
    buddyOrder: [...ALL_FRIEND_IDS],     // 메인 캐릭터 우선순위 (친구 전원, 앞이 1순위)
    grapesPerBunch: 10,                  // 새 포도판부터 적용 (진행 중인 송이는 그대로)
    rewards: Array.from({ length: REWARD_SLOTS }, () => ({ text: '', emoji: '' })),
  };
}

export const DEFAULTS = Object.freeze(makeDefaults());

/* ---------- 검증 ---------- */
const pick = (v, list, def) => (list.includes(v) ? v : def);
const bool = (v, def) => (typeof v === 'boolean' ? v : def);
const volume = (v, def) => (Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v))) : def);
const time = (v, def) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : def);

export function sanitize(raw) {
  const d = makeDefaults();
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = d;

  s.difficulty = pick(r.difficulty, OPTIONS.difficulty, d.difficulty);
  s.numberStyle = pick(r.numberStyle, OPTIONS.numberStyle, d.numberStyle);
  for (const g of GAMES) s.gamesEnabled[g.id] = bool(r.gamesEnabled?.[g.id], true);
  if (!Object.values(s.gamesEnabled).some(Boolean)) {
    for (const g of GAMES) s.gamesEnabled[g.id] = true; // 전부 꺼진 값은 받지 않는다
  }
  s.questionsPerRound = pick(r.questionsPerRound, OPTIONS.questionsPerRound, d.questionsPerRound);
  s.hintDelaySec = pick(r.hintDelaySec, OPTIONS.hintDelaySec, d.hintDelaySec);

  s.dailyLimitMin = pick(r.dailyLimitMin, OPTIONS.dailyLimitMin, d.dailyLimitMin);
  s.breakReminderMin = pick(r.breakReminderMin, OPTIONS.breakReminderMin, d.breakReminderMin);
  s.allowedHours = {
    enabled: bool(r.allowedHours?.enabled, d.allowedHours.enabled),
    start: time(r.allowedHours?.start, d.allowedHours.start),
    end: time(r.allowedHours?.end, d.allowedHours.end),
  };

  for (const k of ['voice', 'sfx']) s.volume[k] = volume(r.volume?.[k], d.volume[k]);
  s.voiceRate = pick(r.voiceRate, OPTIONS.voiceRate, d.voiceRate);
  s.sfxStyle = pick(r.sfxStyle, OPTIONS.sfxStyle, d.sfxStyle);
  // TTS 목소리 이름: 기기마다 목록이 달라 여기서는 형식만 본다 (없는 이름이면 audio.js가 자동 선택으로 돌아감)
  s.voiceName = typeof r.voiceName === 'string' && r.voiceName.length <= 120 ? r.voiceName : '';

  s.dimScreen = bool(r.dimScreen, d.dimScreen);
  s.reduceMotion = bool(r.reduceMotion, d.reduceMotion);

  s.favoriteFriend = FRIENDS.some((f) => f.id === r.favoriteFriend) ? r.favoriteFriend : null;
  s.buddyMode = pick(r.buddyMode, OPTIONS.buddyMode, d.buddyMode);
  // 아는 친구만, 중복 없이 남기고 빠진 친구는 뒤에 붙인다 (항상 친구 전원의 순서)
  const order = Array.isArray(r.buddyOrder) ? [...new Set(r.buddyOrder.filter((id) => ALL_FRIEND_IDS.includes(id)))] : [];
  s.buddyOrder = [...order, ...ALL_FRIEND_IDS.filter((id) => !order.includes(id))];
  s.grapesPerBunch = pick(r.grapesPerBunch, OPTIONS.grapesPerBunch, d.grapesPerBunch);
  s.rewards = d.rewards.map((_, i) => {
    const x = Array.isArray(r.rewards) ? r.rewards[i] : null;
    return {
      text: typeof x?.text === 'string' ? x.text.slice(0, REWARD_TEXT_MAX) : '',
      emoji: REWARD_EMOJIS.includes(x?.emoji) ? x.emoji : '',
    };
  });

  return s;
}

/* ---------- 저장소 ---------- */
let current = null;
let storageOk = true;
const listeners = new Set();

function readRaw() {
  try {
    const t = localStorage.getItem(KEY);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

function writeRaw(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    storageOk = true;
  } catch (e) {
    storageOk = false;
    console.warn('[settings] 저장 실패 (저장 공간을 쓸 수 없음)', e);
  }
}

export function isStorageAvailable() {
  return storageOk;
}

export function loadSettings() {
  current = sanitize(readRaw());
  return getSettings();
}

export function getSettings() {
  if (!current) loadSettings();
  return structuredClone(current);
}

const getAt = (obj, keys) => keys.reduce((o, k) => (o == null ? undefined : o[k]), obj);

// 예: getSetting('volume.voice')
export function getSetting(path) {
  return getAt(getSettings(), path.split('.'));
}

// 예: setSetting('volume.voice', 50) → 저장 성공 시 true
// 허용되지 않는 값(선택지 밖, 마지막 게임 끄기 등)은 저장하지 않고 false
export function setSetting(path, value) {
  if (!current) loadSettings();
  const keys = path.split('.');
  const next = structuredClone(current);
  let o = next;
  for (const k of keys.slice(0, -1)) {
    if (o[k] === null || typeof o[k] !== 'object') return false;
    o = o[k];
  }
  if (!(keys.at(-1) in o)) return false;
  o[keys.at(-1)] = value;

  const clean = sanitize(next);
  if (JSON.stringify(getAt(clean, keys)) !== JSON.stringify(value)) return false;

  current = clean;
  writeRaw(current);
  emit(path);
  return true;
}

// 변경 알림: cb(settings, path) — path가 '*'이면 전체가 바뀐 것(복원 등)
export function onSettingsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(path) {
  const s = getSettings();
  listeners.forEach((cb) => {
    try { cb(s, path); } catch (e) { console.error('[settings] 변경 알림 처리 중 오류', e); }
  });
}

/* ---------- 백업·복원 ---------- */
function prefixedKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
  } catch { /* 저장소 없음 */ }
  return keys;
}

export function exportBackup() {
  if (!current) loadSettings();
  writeRaw(current); // 기본값만 쓰고 있어도 설정이 백업에 들어가도록
  const data = {};
  for (const k of prefixedKeys()) data[k] = localStorage.getItem(k);
  return { app: 'kongkong', format: 1, exportedAt: new Date().toISOString(), data };
}

// 백업 객체를 검사한 뒤 현재 저장 내용을 통째로 바꾼다. 반환: 불러온 항목 수
export function importBackup(obj) {
  if (!obj || obj.app !== 'kongkong' || obj.format !== 1 || !obj.data || typeof obj.data !== 'object') {
    throw new Error('콩콩이 백업 파일이 아닙니다.');
  }
  const entries = Object.entries(obj.data);
  if (!entries.length || !entries.every(([k, v]) => k.startsWith(STORAGE_PREFIX) && typeof v === 'string')) {
    throw new Error('백업 파일 내용이 올바르지 않습니다.');
  }
  try {
    prefixedKeys().forEach((k) => localStorage.removeItem(k));
    entries.forEach(([k, v]) => localStorage.setItem(k, v));
  } catch (e) {
    throw new Error('저장 공간에 쓰지 못했습니다.');
  }
  loadSettings();
  writeRaw(current); // 검증된 값으로 다시 저장
  emit('*');
  return entries.length;
}
