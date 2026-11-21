// 그림 경로·이모지를 한 곳에서 관리한다. (설계서 §10)
// 나중에 assets/images/ 그림으로 바꿀 때는 image 값만 채우면 된다.
// title·name은 부모 화면에서만 쓰는 글자다 (아이 화면에는 글자를 쓰지 않는다).

export const GAMES = [
  { id: 'count',   emoji: '🍎', image: null, title: '콕콕 세어 보기' },
  { id: 'choose',  emoji: '🐥', image: null, title: '몇 개일까?' },
  { id: 'basket',  emoji: '🧺', image: null, title: '바구니 채우기' },
  { id: 'compare', emoji: '🍽️', image: null, title: '어느 쪽이 많아?' },
  { id: 'stones',  emoji: '🐸', image: null, title: '징검다리' },
];

export const GRAPES = { emoji: '🍇', image: null };

// 게임에 나오는 물체 — id는 js/lines.js의 OBJECT_NAMES와 맞춘다 (이름 음성)
export const OBJECTS = [
  { id: 'apple',      emoji: '🍎', image: null },
  { id: 'strawberry', emoji: '🍓', image: null },
  { id: 'chick',      emoji: '🐥', image: null },
  { id: 'fish',       emoji: '🐟', image: null },
  { id: 'flower',     emoji: '🌼', image: null },
  { id: 'balloon',    emoji: '🎈', image: null },
];

// 콩콩이 (지금은 CSS로 그림 — 나중에 그림 파일로 바꿀 때 이 함수만 고친다)
export function createKong({ small = false, idle = true } = {}) {
  const el = document.createElement('div');
  el.className = `kong${small ? ' small' : ''}${idle ? ' idle' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<span class="eye l"></span><span class="eye r"></span>'
    + '<span class="cheek l"></span><span class="cheek r"></span><span class="mouth"></span>';
  return el;
}

// 친구 그림 파일 경로. 이 모듈 위치 기준이라 dev/ 화면에서 불러도 같은 파일을 찾는다.
const friendImage = (name) => new URL(`../assets/images/friends/${name}.svg`, import.meta.url).href;

// 축하 친구 (설계서 §2) — 처음부터 함께하는 친구
// emoji는 그림이 없을 때의 대체이자 부모 화면 표시용이다.
export const FRIENDS = [
  { id: 'kongkong', emoji: null,  image: null, name: '콩콩이' }, // CSS로 그림 (createKong)
  { id: 'tino',     emoji: '🦖', image: friendImage('tino'),    name: '티노' },
  { id: 'bureung',  emoji: '🚌', image: friendImage('bureung'), name: '부릉이' },
];

// 포도송이를 채우면 차례로 합류하는 친구 (5단계에서 사용, 오리지널)
export const NEW_FRIENDS = [
  { id: 'elephant', emoji: '🐘', image: friendImage('elephant'), name: '아기 코끼리' },
  { id: 'train',    emoji: '🚂', image: friendImage('train'),    name: '뚜뚜' },
];

// 친구 SVG 그리기 (설계서 §2 "친구 그림")
// <img>로 넣으면 SVG 안의 var(--sage) 등이 풀리지 않는다. <use>로 참조하면 :root 변수가 상속된다.
const SVG_NS = 'http://www.w3.org/2000/svg';
export function createFriendArt(friend) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'friend-art');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${friend.image}#art`);
  svg.append(use);
  return svg;
}

// 스티커 (한 판 완료 보상)
export const STICKER = { emoji: '⭐', image: null };
