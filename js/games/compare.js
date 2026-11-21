// 게임 ④ 어느 쪽이 많아? (설계서 §6)
// 같은 물체를 담은 접시 두 개 중 많은 쪽 접시를 탭한다. 접시 전체가 누르는 대상이다.
// - 물체는 접시 안에 한 줄 5개씩 (5개 묶음으로 보이게). 두 접시의 크기·물체 크기는 같다.
// - 정답: 두 접시에 개수 숫자가 붙고 "사과가 다섯 개" → "이쪽이 더 많아!" → 축하 친구.
// - 오답: 부정 효과음 없음. "다시 한번 해 볼까?" + 많은 쪽 접시를 살짝 흔든다.
// - 강한 힌트: 한 문제 두 번째 오답(또는 직전 두 문제 연속 오답이면 첫 오답부터)
//            → 두 접시를 하나씩 소리 내어 센 뒤 많은 쪽 접시가 커졌다 작아지며 흔들린다.
// - 결과: 한 번에 'correct', 무응답 힌트 뒤 'hinted', 한 번이라도 틀리면 'wrong'(number = 많은 쪽 수).

import { OBJECTS } from '../assets.js';
import * as audio from '../audio.js';
import { pulse, wobble, mark } from '../effects.js';
import { cheerOne } from '../celebrate.js';
import { el, makePicker, makeSidePicker, pickComparePair, wait, MAX_IDLE_HINTS } from './common.js';

const picker = makePicker();
const pickSide = makeSidePicker();
let lastPair = '';

export default {
  id: 'compare',

  playQuestion(ctx) {
    const { stage, level, range, numberStyle, hintDelayMs, first, introNeeded, signal, misses = 0 } = ctx;
    const [small, big] = pickComparePair(level, range, lastPair);
    lastPair = `${small},${big}`;
    const obj = picker.object(OBJECTS);
    const bigSide = pickSide();
    const counts = bigSide === 'left' ? [big, small] : [small, big];

    audio.preload(Array.from({ length: big }, (_, i) => audio.numberKeys(i + 1, numberStyle)).flat());

    /* ---------- 화면: 접시 두 개 ---------- */
    const row = el('div', 'compare-row');
    const plates = counts.map((c, i) => {
      const plate = el('button', 'compare-plate');
      plate.dataset.count = String(c);
      plate.dataset.side = i === 0 ? 'left' : 'right';
      plate.setAttribute('aria-label', i === 0 ? '왼쪽 접시' : '오른쪽 접시'); // 화면 낭독용 (보이지 않음)
      const grid = el('div', 'compare-items');
      grid.style.setProperty('--per-row', String(Math.min(c, 5)));
      for (let k = 0; k < c; k++) {
        const it = el('span', 'compare-item');
        it.append(el('span', 'emoji', obj.emoji), el('span', 'num-badge'));
        grid.append(it);
      }
      plate.append(grid, el('span', 'plate-count', String(c)));
      row.append(plate);
      return plate;
    });
    const bigPlate = plates.find((p) => Number(p.dataset.count) === big);
    stage.replaceChildren(row);

    return new Promise((resolve) => {
      let done = false;
      let busy = false;
      let wrongs = 0;
      let hinted = false;
      let hintLevel = 0;
      let idleHints = 0;
      let hintTimer = 0;
      let countedAloud = false;

      function cleanup() {
        clearTimeout(hintTimer);
        row.removeEventListener('click', onTap);
      }
      function finish(value) {
        cleanup();
        resolve(value);
      }
      signal.addEventListener('abort', () => finish({ aborted: true }), { once: true });

      function scheduleHint() {
        clearTimeout(hintTimer);
        if (done || idleHints >= MAX_IDLE_HINTS) return;
        hintTimer = setTimeout(giveHint, hintDelayMs);
      }

      // 두 접시를 하나씩 소리 내어 센다 (물체에 순서 숫자)
      async function countBoth() {
        for (const plate of plates) {
          const items = [...plate.querySelectorAll('.compare-item')];
          items.forEach((it) => { it.classList.remove('counted'); mark(it, false); });
          for (let k = 0; k < items.length; k++) {
            if (signal.aborted || done) return;
            items[k].classList.add('counted');
            items[k].querySelector('.num-badge').textContent = String(k + 1);
            mark(items[k], true);
            await audio.sayNumber(k + 1, { style: numberStyle });
          }
          await wait(300, signal);
        }
        countedAloud = true;
      }

      async function strongHint() {
        busy = true;
        clearTimeout(hintTimer);
        await countBoth();
        if (signal.aborted || done) return;
        await pulse(bigPlate, 3);
        if (signal.aborted || done) return;
        wobble(bigPlate, 2);
        busy = false;
        scheduleHint();
      }

      async function giveHint() {
        if (done || busy || signal.aborted) return;
        hinted = true;
        hintLevel++;
        idleHints++;
        if (hintLevel === 1) {
          plates.forEach((p) => pulse(p));
          audio.say('line_compare_q');      // 어느 쪽이 더 많아?
          scheduleHint();
        } else {
          await strongHint();
        }
      }

      async function onTap(e) {
        const plate = e.target.closest('.compare-plate');
        if (!plate || done || busy || signal.aborted) return;
        clearTimeout(hintTimer);
        idleHints = 0;
        audio.sfx('tap');

        if (plate === bigPlate) {
          complete();
          return;
        }

        // 오답: 부정 효과음 없이 다시 시도
        wrongs++;
        pulse(plate);
        if (wrongs >= 2 || misses >= 2) {
          busy = true;                        // "다시 한번 해 볼까?"를 끝까지 말한 뒤 함께 센다
          await audio.say('line_retry');
          if (signal.aborted || done) return;
          await strongHint();
        } else {
          audio.say('line_retry');            // 다시 한번 해 볼까?
          wobble(bigPlate);
          scheduleHint();
        }
      }

      async function complete() {
        done = true;
        clearTimeout(hintTimer);
        mark(bigPlate, true);
        pulse(bigPlate);
        audio.sfx('correct');
        row.classList.add('answered');        // 두 접시에 개수 숫자가 나타난다
        await audio.sayAmount(obj.id, big);   // "사과가 다섯 개" — 항상 고유어
        if (signal.aborted) return;
        if (introNeeded) {
          await audio.sayIntro(big);
          if (signal.aborted) return;
        }
        pulse(bigPlate);
        await audio.say('line_compare_ans');  // 이쪽이 더 많아!
        if (signal.aborted) return;
        await cheerOne({ signal });
        if (signal.aborted) return;
        let result = 'correct';
        if (wrongs > 0) result = 'wrong';
        else if (hinted) result = 'hinted';
        finish({ result, number: big, countedAloud });
      }

      row.addEventListener('click', onTap);
      audio.say('line_compare_q');            // 매 문제 "어느 쪽이 더 많아?"
      if (first) audio.preload(['line_compare_ans']);
      scheduleHint();
    });
  },
};
