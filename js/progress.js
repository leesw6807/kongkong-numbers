// 진행 기록 (설계서 §8) — localStorage "kongkong.progress"
// - 게임별: 적응형 단계·연속 정답·연속 오답, 정답률 통계, 자주 틀리는 숫자
// - 스티커: 한 판 완료마다 1개. 5개가 되면 칸을 비우고 "받을 포도알"(pendingGrapes)을 1 늘린다.
//   포도알이 실제로 포도송이에 붙는 것은 5단계 grapes.js가 pendingGrapes를 꺼내 처리한다.
// - 합류한 친구 (5단계에서 포도송이를 채우면 추가)
// 포도판 자체는 여기서 저장하지 않는다 (진행 초기화에서 포도판이 지워지지 않도록 키를 분리).
// 캐시 없이 매번 저장소에서 읽는다 → 백업 복원 직후에도 바로 최신 값.

import { GAMES, NEW_FRIENDS } from './assets.js';
import { STORAGE_PREFIX } from './settings.js';

const KEY = `${STORAGE_PREFIX}progress`;
export const STICKERS_PER_GRAPE = 5;
const RESULTS = ['correct', 'hinted', 'wrong'];
const BIG = 1e9;

const emptyGame = () => ({
  level: 1,
  streak: 0,
  misses: 0,
  stats: { questions: 0, correct: 0, hinted: 0, wrong: 0 },
  wrongNumbers: {}, // { "7": 3 } — 7을 3번 틀림
});

function makeDefaults() {
  return {
    version: 1,
    games: Object.fromEntries(GAMES.map((g) => [g.id, emptyGame()])),
    stickers: 0,          // 지금 스티커 칸에 붙은 수 (0~4)
    stickersTotal: 0,     // 지금까지 받은 스티커 수
    roundsCompleted: 0,   // 끝까지 마친 판 수
    pendingGrapes: 0,     // 포도판에 아직 붙이지 않은 포도알 (5단계에서 사용)
    joinedFriends: [],    // NEW_FRIENDS 중 합류한 친구 id
    usage: {},            // 날짜별 이용 시간(초) { "2026-11-20": 615 } — 최근 30일만 보관
  };
}

const USAGE_DAYS_KEPT = 30;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function pruneUsage(usage) {
  const keys = Object.keys(usage).sort().reverse().slice(0, USAGE_DAYS_KEPT);
  return Object.fromEntries(keys.map((k) => [k, usage[k]]));
}

const int = (v, min, max, def) => (Number.isInteger(v) && v >= min && v <= max ? v : def);

export function sanitize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const p = makeDefaults();
  for (const g of GAMES) {
    const src = r.games?.[g.id] ?? {};
    const dst = p.games[g.id];
    dst.level = int(src.level, 1, 3, 1);
    dst.streak = int(src.streak, 0, 99, 0);
    dst.misses = int(src.misses, 0, 99, 0);
    for (const k of ['questions', ...RESULTS]) dst.stats[k] = int(src.stats?.[k], 0, BIG, 0);
    if (src.wrongNumbers && typeof src.wrongNumbers === 'object') {
      for (const [num, cnt] of Object.entries(src.wrongNumbers)) {
        if (int(Number(num), 1, 20, 0) && int(cnt, 1, BIG, 0)) dst.wrongNumbers[num] = cnt;
      }
    }
  }
  p.stickers = int(r.stickers, 0, STICKERS_PER_GRAPE - 1, 0);
  p.stickersTotal = int(r.stickersTotal, 0, BIG, 0);
  p.roundsCompleted = int(r.roundsCompleted, 0, BIG, 0);
  p.pendingGrapes = int(r.pendingGrapes, 0, BIG, 0);
  p.joinedFriends = Array.isArray(r.joinedFriends)
    ? [...new Set(r.joinedFriends.filter((id) => NEW_FRIENDS.some((f) => f.id === id)))]
    : [];
  if (r.usage && typeof r.usage === 'object') {
    for (const [day, sec] of Object.entries(r.usage)) {
      if (DAY_RE.test(day) && int(sec, 1, 86400, 0)) p.usage[day] = sec;
    }
    p.usage = pruneUsage(p.usage);
  }
  return p;
}

let memory = null; // 저장소를 쓸 수 없을 때(시크릿 모드 등) 이번 실행 동안만 기억

function load() {
  let t;
  try {
    t = localStorage.getItem(KEY);
  } catch {
    // 저장소를 쓸 수 없을 때만 이번 실행 동안의 메모리 기록을 쓴다
    return memory ? structuredClone(memory) : sanitize(null);
  }
  if (t === null) return sanitize(null); // 저장된 기록 없음 (복원·삭제 직후 포함) → 옛 메모리를 되살리지 않는다
  try {
    return sanitize(JSON.parse(t));
  } catch {
    return sanitize(null); // 깨진 값
  }
}

function save(p) {
  memory = structuredClone(p);
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch (e) {
    console.warn('[progress] 저장 실패 — 이번 실행 동안만 기억합니다', e);
  }
}

/* ---------- 읽기 ---------- */
export function getProgress() {
  return load();
}

export function getGame(id) {
  return load().games[id] ?? emptyGame();
}

export function getJoinedFriends() {
  return load().joinedFriends;
}

/* ---------- 게임 기록 ---------- */
// 적응형 상태 저장 (규칙은 play.js)
export function setAdaptive(id, { level, streak, misses }) {
  const p = load();
  const g = p.games[id];
  if (!g) return;
  Object.assign(g, { level, streak, misses });
  save(sanitize(p));
}

// 한 문제 결과 — 정답률 통계 (부모 화면 "학습 기록 보기"에서 사용)
// number: 오답일 때 정답이었던 수 (자주 틀리는 숫자)
export function recordAnswer(id, result, number) {
  if (!RESULTS.includes(result)) return;
  const p = load();
  const g = p.games[id];
  if (!g) return;
  g.stats.questions++;
  g.stats[result]++;
  if (result === 'wrong' && Number.isInteger(number) && number >= 1 && number <= 20) {
    g.wrongNumbers[number] = (g.wrongNumbers[number] ?? 0) + 1;
  }
  save(p);
}

/* ---------- 스티커 ---------- */
// 한 판 완료 시 호출. 반환: { count: 이번에 붙은 뒤 칸 수(1~5), full: 5칸이 찼는지, pendingGrapes }
export function addSticker() {
  const p = load();
  p.stickers++;
  p.stickersTotal++;
  p.roundsCompleted++;
  const count = p.stickers;
  const full = count >= STICKERS_PER_GRAPE;
  if (full) {
    p.stickers = 0;
    p.pendingGrapes++;
  }
  save(p);
  return { count, full, pendingGrapes: p.pendingGrapes };
}

// 받을 포도알 1개 꺼내기 (grapes.js가 포도판에 붙이기 직전에 호출). 없으면 false
export function takePendingGrape() {
  const p = load();
  if (p.pendingGrapes < 1) return false;
  p.pendingGrapes--;
  save(p);
  return true;
}

/* ---------- 이용 시간 (usage.js가 10초마다 모아서 기록) ---------- */
export function addUsageSeconds(day, seconds) {
  if (!DAY_RE.test(day) || !(seconds > 0)) return;
  const p = load();
  p.usage[day] = Math.min((p.usage[day] ?? 0) + Math.round(seconds), 86400);
  p.usage = pruneUsage(p.usage);
  save(p);
}

export function getUsageSeconds(day) {
  return load().usage[day] ?? 0;
}

/* ---------- 친구 (5단계) ---------- */
export function joinFriend(id) {
  const p = load();
  if (!NEW_FRIENDS.some((f) => f.id === id) || p.joinedFriends.includes(id)) return false;
  p.joinedFriends.push(id);
  save(p);
  return true;
}

// 아직 합류하지 않은 다음 친구를 합류시킨다. 반환: 합류한 친구 또는 null(모두 합류함)
export function joinNextFriend() {
  const joined = load().joinedFriends;
  const next = NEW_FRIENDS.find((f) => !joined.includes(f.id));
  return next && joinFriend(next.id) ? next : null;
}

/* ---------- 진행 초기화 (부모 설정 "기록 > 진행 초기화", 6단계에서 화면 연결) ----------
   단계·스티커·친구만 초기화한다. 포도판(별도 키)·받을 포도알·학습 통계는 남긴다. */
export function resetProgress() {
  const p = load();
  for (const g of Object.values(p.games)) Object.assign(g, { level: 1, streak: 0, misses: 0 });
  p.stickers = 0;
  p.joinedFriends = [];
  save(p);
}

/* ---------- 자동 삭제 방지 ---------- */
// 브라우저가 저장 공간이 부족할 때 기록을 지우지 않도록 요청한다. 반환: true/false/null(지원 안 함)
export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    const ok = await navigator.storage.persist();
    console.info(`[progress] 저장 공간 보호 요청: ${ok ? '허용' : '거부'}`);
    return ok;
  } catch {
    return null;
  }
}
