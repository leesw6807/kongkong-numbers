// 메인 캐릭터 (설계서 §2 "메인 캐릭터")
// - 메인 화면과 게임 안에서 아이와 함께 있는 캐릭터. 한 판을 끝까지 마칠 때마다 다른 친구로 바뀐다.
// - 후보: 기본 친구 + 합류한 친구. 직전 캐릭터는 고르지 않는다.
// - 부모 설정 buddyMode: 'even'(골고루) | 'priority'(buddyOrder 순서대로 가중치 2배씩)
// - 지금 캐릭터는 저장하지 않는다(설계서 §8). 앱을 켜면 콩콩이부터.

import { FRIENDS, NEW_FRIENDS, createKong, createFriendArt } from './assets.js';
import { getSettings } from './settings.js';
import { getJoinedFriends } from './progress.js';

const START_ID = 'kongkong';
let currentId = START_ID;

// 후보 목록 (우선순위 순서)
export function buddyCandidates(settings = getSettings(), joined = getJoinedFriends()) {
  const all = [...FRIENDS, ...NEW_FRIENDS];
  const available = all.filter((f) => FRIENDS.includes(f) || joined.includes(f.id));
  const rank = (f) => {
    const i = settings.buddyOrder.indexOf(f.id);
    return i < 0 ? all.length : i;
  };
  return available.sort((a, b) => rank(a) - rank(b));
}

// 후보별 가중치: 골고루면 모두 1, 우선순위면 1순위부터 2배씩 (3명이면 4:2:1)
export function buddyWeights(candidates, mode) {
  const n = candidates.length;
  return candidates.map((_, i) => (mode === 'priority' ? 2 ** (n - 1 - i) : 1));
}

export function currentBuddy() {
  const pool = buddyCandidates();
  return pool.find((f) => f.id === currentId) ?? pool[0];
}

// 다음 캐릭터로 바꾼다 (한 판을 끝까지 마쳤을 때 play.js가 부른다). 반환: 새 캐릭터
export function nextBuddy(random = Math.random) {
  const s = getSettings();
  const all = buddyCandidates(s);
  const prev = currentBuddy()?.id;
  const pool = all.length > 1 ? all.filter((f) => f.id !== prev) : all;
  // 가중치는 전체 순위 기준으로 매긴 뒤 직전 캐릭터만 뺀다 (순위가 한 칸씩 당겨지지 않게)
  const weightOf = new Map(all.map((f, i) => [f.id, buddyWeights(all, s.buddyMode)[i]]));
  const weights = pool.map((f) => weightOf.get(f.id));
  let r = random() * weights.reduce((a, b) => a + b, 0);
  let chosen = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) { chosen = pool[i]; break; }
  }
  currentId = chosen.id;
  return chosen;
}

// 개발 확인용
export function setBuddy(id) {
  currentId = id;
}

// 메인 캐릭터 그리기. 콩콩이 칸(.kong)과 같은 크기·위치 규칙을 쓴다.
export function createBuddy({ small = false, idle = true } = {}) {
  const f = currentBuddy();
  if (!f?.image) return createKong({ small, idle });
  const el = document.createElement('div');
  el.className = `kong art${small ? ' small' : ''}${idle ? ' idle' : ''}`;
  el.dataset.friend = f.id;
  el.setAttribute('aria-hidden', 'true');
  el.append(createFriendArt(f));
  return el;
}
