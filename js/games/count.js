// 게임 ① 콕콕 세어 보기 (설계서 §6)
// 물체를 탭할 때마다 살짝 커지며 테두리가 생기고(mark) 그 물체에 순서 숫자가 붙는다.
// 탭할 때마다 수를 읽는다 (부모 설정 "수 읽기 방식"). 다 세면 "사과가 세 개!" (항상 고유어).
// 틀리는 경우가 없으므로: 힌트 없이 끝내면 'correct', 힌트가 나왔으면 'hinted'.

import { OBJECTS } from '../assets.js';
import { createBuddy } from '../buddy.js';
import * as audio from '../audio.js';
import { pulse, wobble, mark } from '../effects.js';
import { cheerOne } from '../celebrate.js';
import { el, makePicker, MAX_IDLE_HINTS } from './common.js';
import { OBJECT_NAMES } from '../lines.js';

const MAX_PER_ROW = 5;

// 직전 문제와 같은 수·물체는 피한다. 2단계 이상은 2개부터 (common.js)
const picker = makePicker();

export default {
  id: 'count',

  playQuestion(ctx) {
    const { stage, level, range, numberStyle, hintDelayMs, first, introNeeded, signal } = ctx;
    const n = picker.count(range, level);
    const obj = picker.object(OBJECTS);

    // 미리 불러 두기 (mp3가 있으면 탭 반응이 빨라짐)
    audio.preload([
      ...Array.from({ length: n }, (_, i) => audio.numberKeys(i + 1, numberStyle)).flat(),
    ]);

    /* ---------- 화면 ---------- */
    const area = el('div', 'count-area');
    area.style.setProperty('--per-row', String(Math.min(n, MAX_PER_ROW)));
    const items = Array.from({ length: n }, () => {
      const b = el('button', 'emoji-btn count-obj');
      b.setAttribute('aria-label', OBJECT_NAMES[obj.id]?.name ?? obj.id); // 화면 낭독용 (보이지 않음)
      b.append(el('span', 'emoji', obj.emoji), el('span', 'num-badge'));
      area.append(b);
      return b;
    });

    const kong = createBuddy({ small: true });
    const bigNum = el('div', 'big-num', String(n));
    const result = el('div', 'count-result');
    result.append(kong, bigNum);

    stage.replaceChildren(area, result);

    return new Promise((resolve) => {
      let counted = 0;
      let done = false;
      let hinted = false;
      let hintLevel = 0;   // 이 문제에서 낸 힌트 수 (1번째는 약하게, 그다음부터 강하게)
      let idleHints = 0;   // 누르지 않고 연달아 낸 힌트 수 (MAX_IDLE_HINTS에서 멈춤)
      let hintTimer = 0;

      const nextTarget = () => items.find((b) => !b.classList.contains('counted'));

      function cleanup() {
        clearTimeout(hintTimer);
        area.removeEventListener('click', onTap);
      }

      function finish(value) {
        cleanup();
        resolve(value);
      }

      signal.addEventListener('abort', () => finish({ aborted: true }), { once: true });

      /* ---------- 힌트: 가만히 있으면 다음에 셀 물체를 알려 준다 ---------- */
      function scheduleHint() {
        clearTimeout(hintTimer);
        if (done || idleHints >= MAX_IDLE_HINTS) return; // 3번 알려 줬으면 조용히 기다린다
        hintTimer = setTimeout(giveHint, hintDelayMs);
      }

      async function giveHint() {
        if (done || signal.aborted) return;
        const target = nextTarget();
        if (!target) return;
        hinted = true;
        hintLevel++;
        idleHints++;
        if (hintLevel === 1) {
          pulse(target, 2);
          audio.say('line_hint');
        } else {
          // 강한 힌트: 커졌다 작아지며 흔들림 (설계서 §5)
          audio.say('line_count_intro');
          await pulse(target, 3);
          if (!done && !signal.aborted) wobble(target, 2);
        }
        scheduleHint();
      }

      /* ---------- 탭 ---------- */
      function onTap(e) {
        const b = e.target.closest('.count-obj');
        if (!b || done || signal.aborted) return;
        idleHints = 0; // 아이가 눌렀으니 다시 멈추면 힌트를 처음부터 줄 수 있다

        // 이미 센 것을 다시 누르면: 부정 반응 없이 다음에 셀 물체만 살짝 알려 준다
        if (b.classList.contains('counted')) {
          pulse(nextTarget());
          scheduleHint();
          return;
        }

        counted++;
        b.classList.add('counted');
        b.querySelector('.num-badge').textContent = String(counted);
        mark(b, true);
        pulse(b);
        audio.sfx('tap');

        if (counted < n) {
          audio.sayNumber(counted, { style: numberStyle });
          scheduleHint();
        } else {
          complete();
        }
      }

      async function complete() {
        done = true;
        clearTimeout(hintTimer);
        await audio.sayNumber(n, { style: numberStyle });
        if (signal.aborted) return;

        audio.sfx('correct');
        result.classList.add('show');
        pulse(bigNum);
        await audio.sayAmount(obj.id, n);          // "사과가 세 개" — 항상 고유어
        if (signal.aborted) return;

        if (introNeeded) {
          await audio.sayIntro(n);                 // "셋은 '삼'이라고도 해."
          if (signal.aborted) return;
        }

        pulse(kong, 2);
        await cheerOne({ signal });                // 축하 친구 1명 + 칭찬 음성
        if (signal.aborted) return;

        finish({ result: hinted ? 'hinted' : 'correct' });
      }

      area.addEventListener('click', onTap);

      // 시작 안내: 한 판의 첫 문제에서만 말한다 (탭하면 끊고 바로 센다)
      if (first) audio.say('line_count_intro');
      scheduleHint();
    });
  },
};
