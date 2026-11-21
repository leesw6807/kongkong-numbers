// 게임 ③ 바구니 채우기 (설계서 §6)
// "딸기 네 개 담아 줘!" → 물체를 탭하면 바구니로 날아가 담기고 그때마다 수를 센다.
// - 화면에는 목표보다 2~3개 더 놓는다 (목표 개수에서 멈추기를 배우도록).
// - 목표 개수에 닿으면 자동으로 끝난다 → 넘치게 담을 수 없어 틀리는 경우가 없다 ("실패 없음").
//   끝나면 "딸기가 네 개" — 마지막에 센 수가 곧 개수라는 것을 매번 들려준다.
// - 결과: 힌트 없이 끝내면 'correct', 무응답 힌트가 나왔으면 'hinted'.

import { OBJECTS } from '../assets.js';
import { OBJECT_NAMES } from '../lines.js';
import * as audio from '../audio.js';
import { pulse, wobble, isReduceMotion } from '../effects.js';
import { cheerOne } from '../celebrate.js';
import { el, makePicker, MAX_IDLE_HINTS } from './common.js';

const MAX_PER_ROW = 5;
const MAX_ITEMS = 13;
// 바구니에 담기 자연스러운 것만 (병아리·풍선 제외)
const BASKET_OBJECTS = OBJECTS.filter((o) => ['apple', 'strawberry', 'flower', 'fish'].includes(o.id));

const picker = makePicker();
const finished = (anim) => anim.finished.then(() => {}, () => {});

// 물체가 바구니로 날아가는 모습 (움직임 줄이기면 생략)
async function flyToBasket(from, to, emoji, signal) {
  if (isReduceMotion()) return;
  const stageRect = from.closest('.game-stage').getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const fly = el('div', 'basket-fly', emoji);
  Object.assign(fly.style, {
    left: `${a.left - stageRect.left}px`,
    top: `${a.top - stageRect.top}px`,
    width: `${a.width}px`,
    height: `${a.height}px`,
  });
  from.closest('.game-stage').append(fly);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const onAbort = () => fly.remove();
  signal.addEventListener('abort', onAbort, { once: true });
  await finished(fly.animate([
    { transform: 'translate(0, 0) scale(1)' },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(0.8)`, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.35)` },
  ], { duration: 500, easing: 'ease-in-out' }));
  signal.removeEventListener('abort', onAbort);
  fly.remove();
}

export default {
  id: 'basket',

  playQuestion(ctx) {
    const { stage, level, range, numberStyle, hintDelayMs, first, introNeeded, signal } = ctx;
    const n = picker.count(range, level);
    const obj = picker.object(BASKET_OBJECTS);
    const extra = level === 1 ? 2 : 3;
    const total = Math.min(n + extra, MAX_ITEMS);

    audio.preload([
      ...Array.from({ length: n }, (_, i) => audio.numberKeys(i + 1, numberStyle)).flat(),
    ]);

    /* ---------- 화면: 왼쪽 물체들, 오른쪽 바구니 ---------- */
    const pool = el('div', 'basket-pool');
    pool.style.setProperty('--per-row', String(Math.min(total, MAX_PER_ROW)));
    const items = Array.from({ length: total }, () => {
      const b = el('button', 'emoji-btn basket-obj');
      b.setAttribute('aria-label', OBJECT_NAMES[obj.id]?.name ?? obj.id); // 화면 낭독용 (보이지 않음)
      b.append(el('span', 'emoji', obj.emoji));
      pool.append(b);
      return b;
    });

    const zone = el('div', 'basket-zone');
    const tray = el('div', 'basket-tray');           // 담긴 물체 (작게)
    const basket = el('div', 'basket-plate');
    basket.append(el('span', 'basket-emoji', '🧺'));
    const count = el('span', 'basket-count', '0');   // 담긴 개수 (숫자)
    basket.append(count);
    zone.append(tray, basket);

    const layout = el('div', 'basket-layout');
    layout.append(pool, zone);
    stage.replaceChildren(layout);

    return new Promise((resolve) => {
      let put = 0;
      let done = false;
      let hinted = false;
      let hintLevel = 0;
      let idleHints = 0;
      let hintTimer = 0;

      const remaining = () => items.filter((b) => !b.classList.contains('taken'));

      function cleanup() {
        clearTimeout(hintTimer);
        pool.removeEventListener('click', onTap);
      }
      function finish(value) {
        cleanup();
        resolve(value);
      }
      signal.addEventListener('abort', () => finish({ aborted: true }), { once: true });

      const ask = () => audio.sayBasketAsk(obj.id, n); // "딸기 네 개 담아 줘!"

      /* ---------- 무응답 힌트 (연달아 최대 3번) ---------- */
      function scheduleHint() {
        clearTimeout(hintTimer);
        if (done || idleHints >= MAX_IDLE_HINTS) return;
        hintTimer = setTimeout(giveHint, hintDelayMs);
      }

      async function giveHint() {
        if (done || signal.aborted) return;
        const target = remaining()[0];
        if (!target) return;
        hinted = true;
        hintLevel++;
        idleHints++;
        if (hintLevel === 1) {
          pulse(target, 2);
          pulse(basket);
        } else {
          // 강한 힌트: 담을 물체가 커졌다 작아지며 흔들리고, 요청을 다시 들려준다
          ask();
          await pulse(target, 3);
          if (!done && !signal.aborted) wobble(target, 2);
        }
        scheduleHint();
      }

      /* ---------- 담기 ---------- */
      async function onTap(e) {
        const b = e.target.closest('.basket-obj');
        if (!b || done || signal.aborted || b.classList.contains('taken')) return;
        idleHints = 0;
        clearTimeout(hintTimer);

        put++;
        const k = put;
        b.classList.add('taken');                  // 자리는 남기고 투명하게 (배치가 흔들리지 않게)
        audio.sfx('pop');
        if (k >= n) done = true;                   // 목표에 닿으면 더 담지 않는다

        await flyToBasket(b, basket, obj.emoji, signal);
        if (signal.aborted) return;
        tray.append(el('span', 'tray-item', obj.emoji));
        count.textContent = String(k);
        pulse(basket);

        if (k < n) {
          audio.sayNumber(k, { style: numberStyle });
          scheduleHint();
        } else {
          complete();
        }
      }

      async function complete() {
        clearTimeout(hintTimer);
        remaining().forEach((b) => b.classList.add('left')); // 남은 물체는 사라진다
        await audio.sayNumber(n, { style: numberStyle });
        if (signal.aborted) return;
        audio.sfx('correct');
        mark();
        await audio.sayAmount(obj.id, n);              // "딸기가 네 개" — 항상 고유어
        if (signal.aborted) return;
        if (introNeeded) {
          await audio.sayIntro(n);                     // "넷은 '사'라고도 해."
          if (signal.aborted) return;
        }
        await audio.say('line_basket_done');           // 바구니 가득! 고마워!
        if (signal.aborted) return;
        await cheerOne({ signal });
        if (signal.aborted) return;
        finish({ result: hinted ? 'hinted' : 'correct' });
      }

      function mark() {
        basket.classList.add('full');
        pulse(basket, 2);
      }

      pool.addEventListener('click', onTap);
      // 매 문제 요청을 들려준다 (목표 수를 듣는 것이 이 게임의 핵심). 첫 문제에서 마무리 문장도 미리 불러 둔다.
      ask();
      if (first) audio.preload(['line_basket_done']);
      scheduleHint();
    });
  },
};
