// 게임 ⑤ 징검다리 (설계서 §6)
// 강 위에 숫자가 적힌 돌이 있고, 숫자 순서대로 누르면 콩콩이가 깡충 뛰어 건넌다.
// - 돌은 이어지는 수(1단계 1~3, 2단계 4개, 3단계 1~10 안의 5개). 자리는 숫자 순서와 다르게 섞는다.
// - 맞는 돌: 콩콩이가 뛰어오르고 그 수를 읽는다(부모 설정 수 읽기 방식). 돌은 mark.
// - 틀린 돌: 부정 효과음 없음. 다음 돌이 흔들리고 그 수를 소리로 알려 준다.
//           이 문제에서 두 번째 오답부터(또는 직전 두 문제 연속 오답이면 첫 오답부터) 강한 힌트.
// - 다 건너면 건너편으로 뛰고 "와, 다 건넜다!" → 축하 친구.
// - 결과: 한 번에 'correct', 무응답 힌트 뒤 'hinted', 한 번이라도 틀리면 'wrong'(number = 처음 못 찾은 수).

import { createBuddy } from '../buddy.js';
import * as audio from '../audio.js';
import { pulse, wobble, mark, isReduceMotion } from '../effects.js';
import { cheerOne } from '../celebrate.js';
import { el, pickStoneRun, shuffleStoneSlots, MAX_IDLE_HINTS } from './common.js';

let lastStart = 0;
const finished = (anim) => anim.finished.then(() => {}, () => {});

export default {
  id: 'stones',

  playQuestion(ctx) {
    const { stage, level, numberStyle, hintDelayMs, introNeeded, signal, misses = 0 } = ctx;
    const { start, len } = pickStoneRun(level, lastStart);
    lastStart = start;
    const order = shuffleStoneSlots(len, level); // order[k] = (start + k)를 놓을 자리

    audio.preload(Array.from({ length: len }, (_, k) => audio.numberKeys(start + k, numberStyle)).flat());

    /* ---------- 화면: 왼쪽 강둑 · 강(돌) · 오른쪽 강둑 ---------- */
    const scene = el('div', 'stones-scene');
    const bankL = el('div', 'stones-bank left');
    const river = el('div', 'stones-river');
    river.style.setProperty('--cols', String(len));
    const bankR = el('div', 'stones-bank right');
    const goal = el('div', 'stones-goal');
    goal.append(el('span', 'emoji', '🌳'));
    bankR.append(goal);

    // 자리(slot)는 왼쪽부터 지그재그(위·아래 번갈아). 숫자는 섞어서 놓는다.
    const slots = Array.from({ length: len }, (_, i) => {
      const slot = el('div', 'stone-slot');
      slot.style.gridColumn = String(i + 1);
      slot.style.gridRow = i % 2 === 0 ? '1' : '2';
      river.append(slot);
      return slot;
    });
    const stones = Array.from({ length: len }, (_, k) => {
      const stone = el('button', 'stone', String(start + k));
      stone.dataset.n = String(start + k);
      slots[order[k]].append(stone);
      return stone;
    });

    const hopper = el('div', 'stones-kong');
    hopper.append(createBuddy({ small: true, idle: false }));

    scene.append(bankL, river, bankR, hopper);
    stage.replaceChildren(scene);

    // 콩콩이를 대상 위로 옮긴다 (처음엔 왼쪽 강둑). 움직임 줄이기면 뛰지 않고 바로 옮긴다.
    // center: 대상 한가운데(강둑) / 아니면 대상 위쪽에 선다(돌 숫자·나무가 가려지지 않게)
    function place(target, { hop = true, center = false } = {}) {
      const sr = scene.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      const hw = hopper.offsetWidth;
      const hh = hopper.offsetHeight;
      const x = r.left - sr.left + r.width / 2 - hw / 2;
      const y = center ? r.top - sr.top + r.height / 2 - hh / 2 : r.top - sr.top - hh * 0.55;
      const px = hopper.offsetLeft;
      const py = hopper.offsetTop;
      hopper.style.left = `${x}px`;
      hopper.style.top = `${y}px`;
      if (!hop || isReduceMotion()) return Promise.resolve();
      const dx = px - x;
      const dy = py - y;
      return finished(hopper.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: `translate(${dx / 2}px, ${dy / 2 - 70}px)`, offset: 0.5 },
        { transform: 'translate(0, 0)' },
      ], { duration: 450, easing: 'ease-in-out' }));
    }
    requestAnimationFrame(() => place(bankL, { hop: false, center: true }));

    return new Promise((resolve) => {
      let next = 0;            // 다음에 밟을 돌 (0 = start)
      let done = false;
      let busy = false;
      let wrongs = 0;
      let firstMissed = null;
      let hinted = false;
      let hintLevel = 0;
      let idleHints = 0;
      let hintTimer = 0;

      const nextStone = () => stones[next];

      function cleanup() {
        clearTimeout(hintTimer);
        river.removeEventListener('click', onTap);
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

      // 강한 힌트: 다음 돌이 커졌다 작아지며 흔들리고, 그 수를 들려준다
      async function strongHint() {
        const target = nextStone();
        audio.sayNumber(start + next, { style: numberStyle });
        await pulse(target, 3);
        if (!done && !signal.aborted) wobble(target, 2);
      }

      async function giveHint() {
        if (done || busy || signal.aborted) return;
        hinted = true;
        hintLevel++;
        idleHints++;
        if (hintLevel === 1) pulse(nextStone(), 2);   // 1차: 소리 없이 다음 돌만 살짝
        else await strongHint();
        scheduleHint();
      }

      async function onTap(e) {
        const stone = e.target.closest('.stone');
        if (!stone || done || busy || signal.aborted || stone.classList.contains('stepped')) return;
        clearTimeout(hintTimer);
        idleHints = 0;

        if (stone !== nextStone()) {
          // 틀린 돌: 부정 효과음 없이 다음 돌을 알려 준다
          wrongs++;
          if (firstMissed === null) firstMissed = start + next;
          pulse(stone);
          if (wrongs >= 2 || misses >= 2) {
            await strongHint();
          } else {
            audio.sayNumber(start + next, { style: numberStyle }); // "셋!" — 찾을 수를 들려준다
            wobble(nextStone());
          }
          scheduleHint();
          return;
        }

        // 맞는 돌: 콩콩이가 뛰어오르고 수를 읽는다
        busy = true;
        stone.classList.add('stepped');
        mark(stone, true);
        audio.sfx('tap');
        audio.sayNumber(start + next, { style: numberStyle });
        await place(stone);
        if (signal.aborted) return;
        pulse(stone);
        next++;
        busy = false;
        if (next >= len) complete();
        else scheduleHint();
      }

      async function complete() {
        done = true;
        clearTimeout(hintTimer);
        await new Promise((r) => setTimeout(r, 350));
        if (signal.aborted) return;
        await place(goal);                          // 건너편으로 깡충
        if (signal.aborted) return;
        audio.sfx('correct');
        pulse(goal, 2);
        await audio.say('line_stones_done');        // 와, 다 건넜다!
        if (signal.aborted) return;
        if (introNeeded) {
          await audio.sayIntro(start + len - 1);    // 마지막 돌 수의 한자어 소개
          if (signal.aborted) return;
        }
        await cheerOne({ signal });
        if (signal.aborted) return;
        let result = 'correct';
        if (wrongs > 0) result = 'wrong';
        else if (hinted) result = 'hinted';
        finish({ result, number: firstMissed ?? undefined });
      }

      river.addEventListener('click', onTap);
      audio.say('line_stones_intro');               // 처음부터 차례대로 건너 보자!
      scheduleHint();
    });
  },
};
