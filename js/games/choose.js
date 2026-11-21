// 게임 ② 몇 개일까? (설계서 §6)
// 물체 묶음을 보고 숫자 카드 2~3장 중 맞는 수를 고른다.
// - 1단계 카드 2장, 2·3단계 3장. 오답 카드는 정답과 가까운 수(±2)를 먼저 쓴다.
//   정답이 늘 제일 큰 수가 되지 않게 범위보다 하나 큰 수도 오답으로 쓴다(common.js pickChoices).
// - 오답: 부정 효과음 없음. 누른 카드의 수를 읽어 주고 그 카드는 흐려져 다시 누를 수 없다.
//         "다시 한번 해 볼까?" + 정답 카드를 살짝 흔든다.
// - 강한 힌트: 한 문제에서 2번째 오답(또는 직전 두 문제를 연달아 틀렸으면 첫 오답부터)
//         → 물체를 하나씩 소리 내어 세어 준 뒤 정답 카드가 커졌다 작아지며 흔들린다.
// - 결과: 한 번에 맞히면 'correct', 무응답 힌트 뒤 맞히면 'hinted', 한 번이라도 틀리면 'wrong'.

import { OBJECTS } from '../assets.js';
import * as audio from '../audio.js';
import { pulse, wobble, mark } from '../effects.js';
import { cheerOne } from '../celebrate.js';
import { el, makePicker, pickChoices, wait, MAX_IDLE_HINTS } from './common.js';

const MAX_PER_ROW = 5;
const picker = makePicker();

export default {
  id: 'choose',

  playQuestion(ctx) {
    const {
      stage, level, range, numberStyle, hintDelayMs, first, introNeeded, signal, misses = 0,
    } = ctx;
    const n = picker.count(range, level);
    const obj = picker.object(OBJECTS);
    const cardCount = level === 1 ? 2 : 3;
    const choices = pickChoices(n, range, cardCount);

    audio.preload([
      ...choices.flatMap((v) => audio.numberKeys(v, numberStyle)),
      ...Array.from({ length: n }, (_, i) => audio.numberKeys(i + 1, numberStyle)).flat(),
    ]);

    /* ---------- 화면 ---------- */
    const group = el('div', 'choose-group');
    group.style.setProperty('--per-row', String(Math.min(n, MAX_PER_ROW)));
    const items = Array.from({ length: n }, () => {
      const o = el('div', 'emoji-btn choose-obj');
      o.append(el('span', 'emoji', obj.emoji), el('span', 'num-badge'));
      group.append(o);
      return o;
    });

    const cardRow = el('div', 'choice-cards');
    const cards = choices.map((v) => {
      const c = el('button', 'choice-card', String(v));
      c.dataset.value = String(v);
      cardRow.append(c);
      return c;
    });
    const correctCard = cards.find((c) => Number(c.dataset.value) === n);

    stage.replaceChildren(group, cardRow);

    return new Promise((resolve) => {
      let done = false;
      let busy = false;     // 힌트로 세어 주는 동안에는 탭을 받지 않는다
      let wrongs = 0;
      let hinted = false;
      let hintLevel = 0;    // 이 문제에서 낸 무응답 힌트 수 (1번째는 약하게, 그다음부터 강하게)
      let idleHints = 0;    // 누르지 않고 연달아 낸 힌트 수 (MAX_IDLE_HINTS에서 멈춤)
      let hintTimer = 0;
      let counted = false;  // 물체에 순서 숫자를 이미 붙였는지

      function cleanup() {
        clearTimeout(hintTimer);
        cardRow.removeEventListener('click', onTap);
      }

      function finish(value) {
        cleanup();
        resolve(value);
      }

      signal.addEventListener('abort', () => finish({ aborted: true }), { once: true });

      function scheduleHint() {
        clearTimeout(hintTimer);
        if (done || idleHints >= MAX_IDLE_HINTS) return; // 3번 알려 줬으면 조용히 기다린다
        hintTimer = setTimeout(giveHint, hintDelayMs);
      }

      // 물체에 1, 2, 3… 숫자를 붙인다. withVoice면 하나씩 소리 내어 센다.
      async function countObjects(withVoice) {
        for (let i = 0; i < n; i++) {
          if (signal.aborted) return;
          const o = items[i];
          o.classList.add('counted');
          o.querySelector('.num-badge').textContent = String(i + 1);
          mark(o, true);
          pulse(o);
          if (withVoice) await audio.sayNumber(i + 1, { style: numberStyle });
          else await wait(220, signal);
        }
        counted = true;
      }

      async function strongHint() {
        busy = true;
        clearTimeout(hintTimer);
        await countObjects(true);
        if (signal.aborted || done) return;
        await pulse(correctCard, 3);
        if (signal.aborted || done) return;
        wobble(correctCard, 2);
        busy = false;
        scheduleHint();
      }

      // 무응답 힌트: 1차는 물체를 살짝 커지게 하며 다시 묻고, 2차부터는 강한 힌트
      async function giveHint() {
        if (done || busy || signal.aborted) return;
        hinted = true;
        hintLevel++;
        idleHints++;
        if (hintLevel === 1) {
          items.forEach((o) => pulse(o));
          audio.say('line_choose_q');
          scheduleHint();
        } else {
          await strongHint();
        }
      }

      async function onTap(e) {
        const card = e.target.closest('.choice-card');
        if (!card || done || busy || card.disabled || signal.aborted) return;
        clearTimeout(hintTimer);
        idleHints = 0; // 아이가 눌렀으니 다시 멈추면 힌트를 처음부터 줄 수 있다
        const value = Number(card.dataset.value);
        audio.sfx('tap');

        if (value === n) {
          complete();
          return;
        }

        // 오답: 부정 효과음 없이 그 카드를 흐리게 하고 다시 시도
        wrongs++;
        busy = true;
        card.disabled = true;
        card.classList.add('dim');
        await audio.sayNumber(value, { style: numberStyle });
        if (signal.aborted || done) return;
        if (wrongs >= 2 || misses >= 2) {
          await strongHint();
        } else {
          audio.say('line_retry');      // 다시 한번 해 볼까?
          wobble(correctCard);
          busy = false;
          scheduleHint();
        }
      }

      async function complete() {
        done = true;
        clearTimeout(hintTimer);
        cards.forEach((c) => { if (c !== correctCard) c.classList.add('gone'); });
        mark(correctCard, true);
        pulse(correctCard);
        audio.sfx('correct');
        await audio.sayNumber(n, { style: numberStyle });
        if (signal.aborted) return;

        if (!counted) await countObjects(false); // 맞힌 뒤 물체에 숫자를 붙여 확인 (소리 없이)
        if (signal.aborted) return;
        await audio.sayAmount(obj.id, n);          // "사과가 세 개" — 항상 고유어
        if (signal.aborted) return;

        if (introNeeded) {
          await audio.sayIntro(n);                 // "셋은 '삼'이라고도 해."
          if (signal.aborted) return;
        }

        await cheerOne({ signal });
        if (signal.aborted) return;

        let result = 'correct';
        if (wrongs > 0) result = 'wrong';
        else if (hinted) result = 'hinted';
        finish({ result, number: n });
      }

      cardRow.addEventListener('click', onTap);

      // 매 문제 "몇 개일까?", 한 판의 첫 문제에는 "맞는 숫자를 콕 눌러 줘!"도
      audio.say(first ? ['line_choose_q', 'line_choose_tap'] : 'line_choose_q');
      scheduleHint();
    });
  },
};
