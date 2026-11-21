// 축하 친구들 (설계서 §2) · 스티커 칸
// - 문제 하나 정답: 친구 1명이 화면 옆에서 고개를 내밀고 짧게 반응 (약 1.3초) + 칭찬 음성
// - 한 판 완료: 친구 2~3명이 아래에서 함께 나와 통통 뛰며 축하 (약 2.6초)
// - 움직임은 위로 통통 튀기·옆에서 나오기·크기 변화만. 깜빡임 없음. 화면 일부(가장자리)에서만.
// - "움직임 줄이기"가 켜져 있으면 미끄러져 나오거나 튀지 않고, 나타나서 크기 변화만 한다.
// - 부모 설정 "좋아하는 친구"는 3배 더 자주 뽑힌다.

import { FRIENDS, NEW_FRIENDS, STICKER, createKong, createFriendArt } from './assets.js';
import { getSettings } from './settings.js';
import { getJoinedFriends, STICKERS_PER_GRAPE } from './progress.js';
import * as audio from './audio.js';
import { isReduceMotion, pulse } from './effects.js';

// 친구 이름이 들어간 칭찬은 그 친구가 나올 때만 쓴다
const FRIEND_PRAISE = { tino: 'praise_4', bureung: 'praise_5' };
const GENERIC_PRAISE = ['praise_1', 'praise_2', 'praise_3'];
const FAVORITE_WEIGHT = 3;

let lastFriend = '';
let lastPraise = '';

const layer = () => document.querySelector('#celebrate-layer');

/* ---------- 친구 고르기 ---------- */
export function friendPool() {
  const joined = getJoinedFriends();
  return [...FRIENDS, ...NEW_FRIENDS.filter((f) => joined.includes(f.id))];
}

function weightedPick(list, favorite) {
  const weights = list.map((f) => (f.id === favorite ? FAVORITE_WEIGHT : 1));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r < 0) return list[i];
  }
  return list[list.length - 1];
}

// k명을 서로 다르게 고른다. 첫 번째는 직전에 나온 친구를 피한다.
// 단, 좋아하는 친구는 연속으로 나와도 된다 (그래야 다른 친구보다 3배 자주 나온다).
export function pickFriends(k) {
  const favorite = getSettings().favoriteFriend;
  let pool = friendPool();
  const chosen = [];
  for (let i = 0; i < k && pool.length; i++) {
    const avoidRepeat = i === 0 && pool.length > 1 && lastFriend !== favorite;
    const candidates = avoidRepeat ? pool.filter((f) => f.id !== lastFriend) : pool;
    const f = weightedPick(candidates, favorite);
    chosen.push(f);
    pool = pool.filter((x) => x.id !== f.id);
  }
  if (chosen[0]) lastFriend = chosen[0].id;
  return chosen;
}

function praiseFor(friend) {
  if (FRIEND_PRAISE[friend.id]) return FRIEND_PRAISE[friend.id];
  const pool = GENERIC_PRAISE.filter((k) => k !== lastPraise);
  lastPraise = pool[Math.floor(Math.random() * pool.length)];
  return lastPraise;
}

/* ---------- 친구 그리기 ---------- */
function makeFriend(friend) {
  const el = document.createElement('div');
  el.className = 'friend';
  el.dataset.friend = friend.id;
  if (friend.image) {
    el.append(createFriendArt(friend));
  } else if (friend.emoji) {
    // 이모지는 연한 원형 받침 위에 (설계서 §1)
    const plate = document.createElement('div');
    plate.className = 'friend-plate';
    const span = document.createElement('span');
    span.className = 'friend-emoji';
    span.textContent = friend.emoji;
    plate.append(span);
    el.append(plate);
  } else {
    el.append(createKong({ idle: false }));
  }
  return el;
}

const finished = (anim) => anim.finished.then(() => {}, () => {});

function bounceFrames(from, hops, height, edge = 0.22) {
  // from: 들어오고 나가는 위치 (예: 'translateX(-130%)'), hops: 통통 튀는 횟수
  // edge: 들어오기·나가기에 쓰는 비율 (전체 시간 중 앞뒤 각각)
  const frames = [{ transform: from, offset: 0 }, { transform: 'none', offset: edge }];
  const span = (1 - edge * 2) / hops;
  for (let i = 0; i < hops; i++) {
    const start = edge + i * span;
    frames.push({ transform: `translateY(-${height}px)`, offset: start + span / 2 });
    frames.push({ transform: 'none', offset: start + span });
  }
  frames.push({ transform: from, offset: 1 });
  return frames;
}

// 움직임 줄이기: 나타나서 크기 변화만 하고 사라진다
async function calmShow(el, duration) {
  const appear = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'forwards' });
  await finished(appear);
  await pulse(el.firstElementChild, duration > 2000 ? 2 : 1);
  await finished(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }));
}

function untilAbort(signal, el) {
  const onAbort = () => el.remove();
  signal?.addEventListener('abort', onAbort, { once: true });
  return () => signal?.removeEventListener('abort', onAbort);
}

/* ---------- 문제 하나 정답 ---------- */
// 친구 1명 + 칭찬 음성. 둘 다 끝나면 resolve.
// 2.5초: 옆에서 나오기 0.35초 → 통통 3번 → 들어가기 0.35초 (설계서 §2, 처음 1.3초는 너무 짧다는 의견으로 늘림)
const CHEER_ONE_MS = 2500;

export async function cheerOne({ signal } = {}) {
  if (signal?.aborted) return;
  const [friend] = pickFriends(1);
  if (!friend) return;
  const side = Math.random() < 0.5 ? 'left' : 'right';
  const el = makeFriend(friend);
  el.classList.add('peek', side);
  layer().append(el);
  const release = untilAbort(signal, el);

  const voice = audio.say(praiseFor(friend));
  const motion = isReduceMotion()
    ? calmShow(el, CHEER_ONE_MS)
    : finished(el.animate(
      bounceFrames(side === 'left' ? 'translateX(-130%)' : 'translateX(130%)', 3, 26, 0.14),
      { duration: CHEER_ONE_MS, easing: 'ease-in-out', fill: 'forwards' }
    ));

  await Promise.all([voice, motion]);
  release();
  el.remove();
}

/* ---------- 한 판 완료 ---------- */
// 친구 2~3명이 아래에서 함께 나와 통통. 음성은 부르는 쪽(play.js)이 말한다.
// friends를 넘기면 그 친구들로, duration으로 길이를 바꿀 수 있다 (송이 완성 등).
export async function cheerRound({ signal, friends, duration = 2600 } = {}) {
  if (signal?.aborted) return;
  if (!friends) {
    const pool = friendPool();
    const k = Math.min(pool.length, pool.length >= 3 && Math.random() < 0.5 ? 3 : 2);
    friends = pickFriends(k);
  }
  const row = document.createElement('div');
  row.className = 'round-friends';
  const els = friends.map(makeFriend);
  row.append(...els);
  layer().append(row);
  const release = untilAbort(signal, row);

  await Promise.all(els.map((el, i) => (isReduceMotion()
    ? calmShow(el, duration)
    : finished(el.animate(bounceFrames('translateY(140%)', 3, 34), {
      duration, delay: i * 140, easing: 'ease-in-out', fill: 'both',
    })))));
  release();
  row.remove();
}

/* ---------- 송이 완성·포도판 완성: 친구 전원 (3초, 화면 아래쪽) ---------- */
export function cheerAll({ signal, friends } = {}) {
  return cheerRound({ signal, friends: friends ?? friendPool(), duration: 3000 });
}

/* ---------- 새 친구 합류 ---------- */
// 화면 가운데에서 쏙 나타나 통통 뛰고 들어간다 (약 2.2초)
export async function showNewFriend(friend, { signal } = {}) {
  if (signal?.aborted || !friend) return;
  const wrap = document.createElement('div');
  wrap.className = 'new-friend-wrap';
  const el = makeFriend(friend);
  el.classList.add('new-friend');
  wrap.append(el);
  layer().append(wrap);
  const release = untilAbort(signal, wrap);
  audio.sfx('pop');
  if (isReduceMotion()) {
    await calmShow(el, 2200);
  } else {
    await finished(el.animate([
      { transform: 'scale(0)', offset: 0 },
      { transform: 'scale(1.2)', offset: 0.2 },
      { transform: 'scale(1)', offset: 0.3 },
      { transform: 'translateY(-30px)', offset: 0.42 },
      { transform: 'none', offset: 0.54 },
      { transform: 'translateY(-30px)', offset: 0.66 },
      { transform: 'none', offset: 0.78 },
      { transform: 'scale(0)', offset: 1 },
    ], { duration: 2200, easing: 'ease-in-out', fill: 'forwards' }));
  }
  release();
  wrap.remove();
}

/* ---------- 스티커 칸 ---------- */
// count: 이번에 붙은 뒤 칸 수(1~5). 반환된 popNew()를 부르면 새 스티커가 쏙 들어간다.
export function createStickerBoard(count) {
  const board = document.createElement('div');
  board.className = 'sticker-board';
  const slots = Array.from({ length: STICKERS_PER_GRAPE }, (_, i) => {
    const slot = document.createElement('div');
    slot.className = 'sticker-slot';
    if (i < count - 1) {
      slot.classList.add('filled');
      slot.textContent = STICKER.emoji;
    }
    board.append(slot);
    return slot;
  });

  async function popNew() {
    const slot = slots[count - 1];
    if (!slot) return;
    slot.classList.add('filled');
    const s = document.createElement('span');
    s.className = 'sticker-new';
    s.textContent = STICKER.emoji;
    slot.append(s);
    audio.sfx('pop');
    await finished(s.animate(
      [{ transform: 'scale(0)' }, { transform: 'scale(1.25)', offset: 0.6 }, { transform: 'scale(1)' }],
      { duration: 550, easing: 'ease-in-out' }
    ));
  }

  return { board, popNew };
}
