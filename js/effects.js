// 시각 효과 공통 함수 (설계서 §1)
// 깜빡임(점멸·밝기 반복)은 쓰지 않는다. 크기 변화·흔들림만 사용한다.
//
//   pulse(el, times)  주목·힌트: 1.0 → 1.15배로 천천히 커졌다 돌아오기 (1회 0.8초, 최대 3회)
//   wobble(el, times) 정답 위치 알려 주기: 좌우로 살짝 흔들기 (±6도, 0.5초, 최대 2회)
//   mark(el, on)      선택됨·센 물체: 1.1배 커진 상태 유지 + 테두리 두껍게 (--ink 4px)
//
// pulse·wobble은 애니메이션이 끝나면 resolve되는 Promise를 돌려준다.
// 같은 요소에 새 효과를 걸면 진행 중이던 효과는 멈추고 새 효과로 바뀐다.

const running = new WeakMap();

function clamp(n, min, max) {
  return Math.min(Math.max(Math.round(n) || min, min), max);
}

export function isReduceMotion() {
  return document.documentElement.dataset.reduceMotion === 'on';
}

// 부모 설정 "움직임 줄이기" (on이면 흔들림 없이 크기 변화만 사용)
export function setReduceMotion(on) {
  document.documentElement.dataset.reduceMotion = on ? 'on' : 'off';
}

function run(el, keyframes, options) {
  if (!el || typeof el.animate !== 'function') return Promise.resolve();
  running.get(el)?.cancel();
  // composite: 'add' → mark()로 커져 있는 상태(scale 1.1) 위에 효과를 더한다
  const anim = el.animate(keyframes, { easing: 'ease-in-out', composite: 'add', ...options });
  running.set(el, anim);
  return anim.finished.then(
    () => { if (running.get(el) === anim) running.delete(el); },
    () => { /* 취소됨 */ }
  );
}

export function pulse(el, times = 1) {
  return run(
    el,
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.15)' },
      { transform: 'scale(1)' },
    ],
    { duration: 800, iterations: clamp(times, 1, 3) }
  );
}

export function wobble(el, times = 1) {
  if (isReduceMotion()) return pulse(el, times);
  return run(
    el,
    [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(-6deg)' },
      { transform: 'rotate(6deg)' },
      { transform: 'rotate(0deg)' },
    ],
    { duration: 500, iterations: clamp(times, 1, 2) }
  );
}

export function mark(el, on = true) {
  if (!el) return;
  el.classList.toggle('is-marked', on);
}

// 진행 중인 효과 멈추기 (화면 전환 시 등)
export function stopEffect(el) {
  running.get(el)?.cancel();
  running.delete(el);
}
