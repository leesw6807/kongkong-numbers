// 터치 도움 (설계서 §1 "터치 도움", 부모 설정 touchHelp)
// 아이 화면의 버튼 탭을 너그럽게 받는다.
// - 빗나가도 인정: 댄 곳이 버튼 밖이면 반경 안의 가장 가까운 버튼 (두 버튼이 거의 같은 거리면 무시)
// - 미끄러져도 인정: 뗀 곳이 그 버튼에서 max(반경, 24px) 안이면 탭. 2초 넘게 누른 것은 무시.
// - 손가락(pointerId)마다 따로 본다. 인정되면 버튼에 click()을 보내고, 브라우저의 원래 클릭은 막는다.
// - 'off'면 아무것도 하지 않는다(브라우저 기본 클릭).

const RADIUS = { off: 0, normal: 24, wide: 48 };
const SLIDE_MIN = 24;     // 미끄러짐 허용 최소 거리(px)
const MAX_PRESS_MS = 2000; // 이보다 오래 누르면 탭이 아니다(손바닥을 올려 둔 경우 등)
const TIE_PX = 2;          // 가장 가까운 두 버튼의 거리 차가 이보다 작으면 어느 쪽인지 모르므로 무시

// 아이 화면 (부모 화면은 제외)
const KID_AREAS = '#screen-main.active, #screen-game.active, #screen-grapes.active, #break-layer:not([hidden])';
// 터치 도움을 쓰지 않는 버튼: 시작(소리 활성화에 브라우저 원래 탭이 필요), 부모 진입(3초 누르기)
const EXCLUDE = '#btn-start, .btn-parent';

let mode = 'normal';
const presses = new Map(); // pointerId → { button, t }

export function setTouchHelp(value) {
  mode = RADIUS[value] !== undefined ? value : 'normal';
  document.documentElement.dataset.touchHelp = mode;
}

const enabled = () => mode !== 'off';

// 점에서 사각형까지 거리 (안이면 0)
function distance(x, y, r) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

// 지금 눌릴 수 있는 버튼인지: 비활성이 아니고, 그 버튼 한가운데를 누르면 실제로 그 버튼이 눌리는지(가려짐·숨김·pointer-events:none 제외)
function tappable(btn) {
  if (btn.disabled || btn.matches(EXCLUDE)) return false;
  const r = btn.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit?.closest('button') === btn;
}

function kidArea(el) {
  return el?.closest?.(KID_AREAS) ?? null;
}

// 댄 곳에서 누를 버튼 찾기
function findButton(x, y, target) {
  const direct = target?.closest?.('button');
  if (direct && kidArea(direct)) return direct.disabled || direct.matches(EXCLUDE) ? null : direct;
  const radius = RADIUS[mode];
  const areas = [...document.querySelectorAll(KID_AREAS)];
  const ranked = areas.flatMap((a) => [...a.querySelectorAll('button')])
    .filter(tappable)
    .map((b) => ({ b, d: distance(x, y, b.getBoundingClientRect()) }))
    .filter((c) => c.d <= radius)
    .sort((p, q) => p.d - q.d);
  if (!ranked.length) return null;
  if (ranked[1] && ranked[1].d - ranked[0].d < TIE_PX) return null;
  return ranked[0].b;
}

function onDown(e) {
  if (!enabled() || e.button > 0) return;
  if (!kidArea(e.target)) return; // 부모 화면 등은 그대로
  const button = findButton(e.clientX, e.clientY, e.target);
  if (button) presses.set(e.pointerId, { button, t: performance.now() });
}

function onUp(e) {
  const p = presses.get(e.pointerId);
  presses.delete(e.pointerId);
  if (!p || !enabled()) return;
  if (performance.now() - p.t > MAX_PRESS_MS) return;
  if (!p.button.isConnected || p.button.disabled) return;
  const slide = Math.max(RADIUS[mode], SLIDE_MIN);
  if (distance(e.clientX, e.clientY, p.button.getBoundingClientRect()) > slide) return;
  p.button.click(); // 사용자가 뗀 순간(사용자 탭 처리 중)에 보낸다
}

// 브라우저의 원래 클릭은 막는다 (터치 도움이 대신 보내므로 두 번 눌리지 않게)
function onClick(e) {
  if (!enabled() || !e.isTrusted) return;
  const btn = e.target?.closest?.('button');
  if (btn?.matches(EXCLUDE)) return;
  if (!kidArea(e.target)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

export function initTouch(initialMode) {
  setTouchHelp(initialMode);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', (e) => presses.delete(e.pointerId), true);
  document.addEventListener('click', onClick, true);
}

// 개발·검사용: 지금 반경
export function touchRadius() {
  return RADIUS[mode];
}
