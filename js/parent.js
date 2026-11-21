// 부모 설정 화면 (설계서 §9) — 부모 영역이므로 글자 사용 허용 (CLAUDE.md UX 원칙 1 예외)
// 데이터는 js/settings.js가 관리하고, 이 파일은 화면만 그린다.
// 아직 기능이 연결되지 않은 항목은 값만 저장하고 "값만 저장 · N단계에서 연결" 표시를 단다.

import {
  getSetting, setSetting, isStorageAvailable, exportBackup, importBackup,
  REWARD_EMOJIS, REWARD_TEXT_MAX,
} from './settings.js';
import { GAMES, FRIENDS, NEW_FRIENDS } from './assets.js';
import { currentBuddy } from './buddy.js';
import * as audio from './audio.js';
import { getGrapes, markRewardGiven, startNewBoard, totalGrapes, BUNCHES } from './grapes.js';
import { getProgress, resetProgress } from './progress.js';
import { usedToday, currentLockReason, remainingSeconds, recentDays, flush as flushUsage } from './usage.js';

const PARENT_IDLE_MS = 3 * 60 * 1000; // 3분 동안 조작이 없으면 아이 화면으로 (아이가 집어 들었을 때 대비)

/* ---------- 항목 정의 ----------
   kind: choice | games | range | hours | rewards | action | backup
   live: true → 지금 바로 동작에 반영됨 / stage: N → 값만 저장, N단계에서 연결 */
const SECTIONS = [
  {
    id: 'learn', title: '학습', items: [
      {
        kind: 'choice', path: 'difficulty', label: '난이도', live: true,
        options: [['auto', '자동'], [1, '1단계 (1~3)'], [2, '2단계 (1~5)'], [3, '3단계 (1~10)']],
        help: '자동: 3연속 정답이면 한 단계 위, 힌트 후에도 틀리면 한 단계 아래. 단계를 고르면 그 단계로 고정됩니다.',
      },
      {
        kind: 'choice', path: 'numberStyle', label: '수 읽기 방식', live: true,
        options: [['native', '고유어 (하나·둘)'], ['sino', '한자어 (일·이)'], ['both', '둘 다']],
        help: '개수("사과가 세 개")는 설정과 관계없이 항상 고유어로 읽습니다.',
        preview: () => audio.sayNumber(3),
      },
      { kind: 'games', path: 'gamesEnabled', label: '게임 켜기·끄기', live: true, help: '꺼 둔 게임은 메인 화면에서 사라집니다. 최소 1개는 켜져 있어야 합니다.' },
      {
        kind: 'choice', path: 'questionsPerRound', label: '한 판 문제 수', live: true, liveText: '다음 판부터 적용',
        options: [[3, '3문제'], [4, '4문제'], [5, '5문제']],
      },
      {
        kind: 'choice', path: 'hintDelaySec', label: '힌트 나오는 시점', live: true,
        options: [[0, '바로'], [5, '5초 후'], [10, '10초 후']],
        help: '아이가 답하지 않고 있을 때 힌트가 나오기까지의 시간입니다.',
      },
    ],
  },
  {
    id: 'time', title: '시간', items: [
      { kind: 'usageStatus', label: '오늘 이용 현황', live: true, liveText: '지금 상태' },
      {
        kind: 'choice', path: 'dailyLimitMin', label: '하루 이용 시간', live: true,
        options: [[5, '5분'], [10, '10분'], [15, '15분'], [20, '20분']],
        help: '아이 화면(메인·게임·포도판)을 보고 있는 시간만 셉니다. 다 되면 콩콩이가 "오늘은 여기까지!" 하고 잠금 화면을 보여 줍니다. 게임 중이면 지금 문제가 끝난 뒤(최대 2분) 잠급니다. 늘려 주면 바로 풀립니다.',
      },
      {
        kind: 'choice', path: 'breakReminderMin', label: '쉬는 시간 알림', live: true,
        options: [[0, '끔'], [5, '5분마다'], [10, '10분마다']],
        help: '연속으로 이 시간만큼 하면 "눈도 쉬어야 해" 화면이 나오고, 20초 쉰 뒤 ▶로 계속합니다. 게임 중이면 문제 사이에 나옵니다. 앱을 1분 이상 떠나 있었으면 다시 처음부터 셉니다.',
      },
      {
        kind: 'hours', path: 'allowedHours', label: '이용 가능 시간대', live: true,
        help: '지정한 시간 밖에는 잠금 화면이 나오고, 시간이 되면 저절로 풀립니다. 끝 시각이 시작보다 이르면 다음 날 그 시각까지로 봅니다(예: 20:00~07:00). 시작과 끝이 같으면 하루 종일 잠깁니다.',
      },
    ],
  },
  {
    id: 'sound', title: '소리', items: [
      { kind: 'range', path: 'volume.voice', label: '음성 음량', live: true, preview: () => audio.sayPraise() },
      { kind: 'range', path: 'volume.sfx', label: '효과음 음량', live: true, preview: () => audio.sfx('correct') },
      {
        kind: 'choice', path: 'voiceRate', label: '음성 속도', live: true,
        options: [['slow', '느리게'], ['normal', '보통']],
        help: '기계 음성(TTS)에만 적용됩니다. 녹음한 음성은 처음부터 천천히 녹음합니다.',
        preview: () => audio.say('line_pick_game'),
      },
      {
        kind: 'voicePick', path: 'voiceName', label: '목소리', live: true,
        help: '녹음한 음성이 없는 문장을 읽는 기계 목소리입니다. "자동"은 이 기기에서 가장 자연스러운 목소리를 고릅니다. "인터넷 필요" 목소리는 인터넷이 끊기면 기기 목소리로 바뀝니다.',
      },
      {
        kind: 'voiceDiag', label: '음성 진단', live: true, liveText: '문제 확인용',
        help: '음성이 들리지 않을 때 원인을 찾는 곳입니다. 시험 1~3을 하나씩 눌러 소리가 나는지 듣고, 아래 결과를 그대로 알려 주세요. (기기 미디어 음량을 먼저 올려 주세요)',
      },
    ],
  },
  {
    id: 'screen', title: '화면', items: [
      {
        kind: 'choice', path: 'dimScreen', label: '화면 밝기 낮춤', live: true,
        options: [[false, '끔'], [true, '켬']],
        help: '화면 전체에 옅은 따뜻한 색 막을 씌워 눈부심을 줄입니다.',
      },
      {
        kind: 'choice', path: 'reduceMotion', label: '움직임 줄이기', live: true,
        options: [[false, '끔'], [true, '켬']],
        help: '켜면 흔들림 없이 크기 변화만 사용합니다.',
      },
    ],
  },
  {
    id: 'reward', title: '보상', items: [
      {
        kind: 'choice', path: 'favoriteFriend', label: '좋아하는 친구', live: true,
        options: [[null, '없음 (골고루)'], ...FRIENDS.map((f) => [f.id, `${f.emoji ? `${f.emoji} ` : ''}${f.name}`])],
        help: '고른 친구가 축하할 때 다른 친구보다 훨씬 자주(약 3~4배) 나옵니다.',
      },
      {
        kind: 'buddy', label: '메인 캐릭터', live: true, liveText: '다음 판부터 적용',
        help: '메인 화면과 게임 안에서 함께하는 캐릭터가 한 판을 마칠 때마다 바뀝니다(직전 캐릭터는 다시 나오지 않음). "우선순위대로"를 고르면 위에 있는 친구일수록 자주 나옵니다(한 칸 위마다 2배). 합류 전인 친구는 포도송이를 채워 합류한 뒤부터 나옵니다. 시작·잠금·쉬는 시간·포도판 화면은 늘 콩콩이입니다.',
      },
      {
        kind: 'choice', path: 'grapesPerBunch', label: '송이당 포도알 수', live: true, liveText: '새 포도판부터 적용',
        options: [[5, '5알'], [10, '10알'], [15, '15알'], [20, '20알']],
        help: '포도알이 들어 있는 포도판에는 바뀌지 않고, 새 포도판부터 적용됩니다. (포도알이 하나도 없는 판은 바로 바뀝니다)',
      },
      {
        kind: 'rewards', path: 'rewards', label: '송이별 보상 등록', live: true,
        help: '포도송이를 다 채우면 보물 상자 화면에 그림이 크게, 글이 작게 나옵니다.',
      },
      { kind: 'rewardGive', label: '보상 줌 처리', live: true, help: '보상을 준 뒤 눌러 주세요. 포도판의 그 송이에 리본(🎀 ✔)이 붙습니다. 누르기 전까지는 "보상 대기"(🎁)로 남습니다.' },
      { kind: 'newBoard', label: '포도판 새로 시작', live: true, help: '지금 포도판을 기록에 남기고 빈 포도판으로 시작합니다. (확인 2회)' },
    ],
  },
  {
    id: 'record', title: '기록', items: [
      { kind: 'records', label: '학습 기록', live: true, liveText: '열 때마다 새로 계산' },
      { kind: 'resetProgress', label: '진행 초기화', live: true, help: '게임별 단계·스티커 칸·합류한 친구를 처음으로 되돌립니다. 포도판, 받을 포도알, 학습 기록(정답률·이용 시간)은 지워지지 않습니다. (확인 2회)' },
      { kind: 'backup', label: '백업·복원', live: true, help: '설정과 진행 상황(포도판 포함)을 파일로 내보내거나 불러옵니다. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 내보내 두세요.' },
    ],
  },
];

/* ---------- 상태 ---------- */
let showScreen = () => {};
let activeTab = SECTIONS[0].id;
let idleTimer = 0;
let toastTimer = 0;
let modalResolve = null;

const $ = (sel) => document.querySelector(sel);

// 작은 DOM 도우미 (글자는 항상 textContent로 넣는다)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* ---------- 열기·닫기 ---------- */
export function initParent(opts) {
  showScreen = opts.showScreen;
  $('#parent-exit').addEventListener('click', exitParent);
  const screen = $('#screen-parent');
  ['pointerdown', 'input', 'keydown'].forEach((t) => screen.addEventListener(t, resetIdle, true));
  $('#ps-file').addEventListener('change', onRestoreFile);
  $('#ps-modal-ok').addEventListener('click', () => closeModal(true));
  $('#ps-modal-cancel').addEventListener('click', () => closeModal(false));
  // 목소리 목록은 늦게 불러와지는 기기가 있다 → 소리 탭을 보고 있으면 다시 그린다
  window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
    if (screen.classList.contains('active') && activeTab === 'sound') renderPanel();
  });
}

export function openParent() {
  activeTab = SECTIONS[0].id;
  renderNav();
  renderPanel();
  showScreen('parent');
  resetIdle();
}

function exitParent() {
  clearTimeout(idleTimer);
  closeModal(false);
  audio.stop();
  showScreen('main');
}

function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(exitParent, PARENT_IDLE_MS);
}

/* ---------- 알림·확인 창 ---------- */
function toast(message) {
  const t = $('#ps-toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

const saved = () => toast(isStorageAvailable() ? '저장했어요' : '저장 공간을 쓸 수 없어 이번 실행 동안만 적용돼요');

export function confirmDialog(message, okLabel = '확인') {
  closeModal(false);
  $('#ps-modal-text').textContent = message;
  $('#ps-modal-ok').textContent = okLabel;
  $('#ps-modal').hidden = false;
  return new Promise((resolve) => { modalResolve = resolve; });
}

// 되돌리기 어려운 작업용: 두 번 확인 (포도판 새로 시작, 진행 초기화)
export async function confirmTwice(first, second, okLabel = '확인') {
  return (await confirmDialog(first, '계속')) && confirmDialog(second, okLabel);
}

function closeModal(result) {
  const m = $('#ps-modal');
  if (!m || m.hidden) return;
  m.hidden = true;
  const r = modalResolve;
  modalResolve = null;
  r?.(result);
}

/* ---------- 그리기 ---------- */
function renderNav() {
  const nav = $('#ps-nav');
  nav.replaceChildren(...SECTIONS.map((s) => h('button', {
    class: 'ps-tab',
    'aria-pressed': String(s.id === activeTab),
    onclick: () => { activeTab = s.id; renderNav(); renderPanel(true); },
  }, s.title)));
}

function renderPanel(scrollTop = false) {
  const panel = $('#ps-panel');
  const keep = panel.scrollTop;
  const section = SECTIONS.find((s) => s.id === activeTab);
  panel.replaceChildren(h('h2', {}, section.title), ...section.items.map(itemEl));
  panel.scrollTop = scrollTop ? 0 : keep;
}

function badge(item) {
  if (item.live) return h('span', { class: 'badge live' }, item.liveText ?? '바로 적용');
  if (item.kind === 'action') return h('span', { class: 'badge wait' }, `준비 중 · ${item.stage}단계`);
  return h('span', { class: 'badge stored' }, `값만 저장 · ${item.stageText ?? `${item.stage}단계에서 연결`}`);
}

function itemEl(item) {
  const control = h('div', { class: 'ps-control' });
  const builders = {
    choice, games, range, hours, rewards, action, backup, rewardGive, newBoard, usageStatus, records, resetProgress: resetProgressItem, voicePick, buddy, voiceDiag,
  };
  builders[item.kind](item, control);
  return h('div', { class: 'ps-item' },
    h('div', { class: 'ps-item-head' }, h('h3', {}, item.label), badge(item)),
    item.help ? h('p', { class: 'ps-help' }, item.help) : null,
    control);
}

function chip(label, pressed, onclick, extra = '') {
  return h('button', { class: `chip ${extra}`.trim(), 'aria-pressed': String(pressed), onclick }, label);
}

function choice(item, box) {
  const cur = getSetting(item.path);
  item.options.forEach(([value, label]) => {
    box.append(chip(label, Object.is(cur, value), () => {
      if (Object.is(getSetting(item.path), value)) return;
      if (setSetting(item.path, value)) {
        saved();
        renderPanel();
        item.preview?.();
      }
    }));
  });
  if (item.preview) box.append(chip('🔈 들어 보기', false, () => item.preview(), 'ghost'));
}

function games(item, box) {
  const cur = getSetting(item.path);
  GAMES.forEach((g) => {
    box.append(chip(`${g.emoji} ${g.title}`, cur[g.id], () => {
      if (setSetting(`${item.path}.${g.id}`, !getSetting(`${item.path}.${g.id}`))) {
        saved();
        renderPanel();
      } else {
        toast('게임은 최소 1개는 켜 두어야 해요');
      }
    }));
  });
}

function range(item, box) {
  const value = h('span', { class: 'range-value' }, getSetting(item.path));
  const input = h('input', { type: 'range', min: 0, max: 100, step: 5, value: getSetting(item.path), 'aria-label': item.label });
  input.addEventListener('input', () => {
    value.textContent = input.value;
    setSetting(item.path, Number(input.value));
  });
  input.addEventListener('change', () => {
    saved();
    item.preview?.();
  });
  box.append(h('div', { class: 'range-row' }, input, value));
  if (item.preview) box.append(chip('🔈 들어 보기', false, () => item.preview(), 'ghost'));
}

function hours(item, box) {
  const cur = getSetting(item.path);
  const set = (key, v) => {
    if (setSetting(`${item.path}.${key}`, v)) { saved(); return true; }
    return false;
  };
  box.append(
    chip('제한 없음', !cur.enabled, () => { if (set('enabled', false)) renderPanel(); }),
    chip('시간 지정', cur.enabled, () => { if (set('enabled', true)) renderPanel(); }),
  );
  const timeInput = (key) => {
    const input = h('input', { type: 'time', value: cur[key], disabled: !cur.enabled, 'aria-label': key === 'start' ? '시작 시각' : '끝 시각' });
    input.addEventListener('change', () => {
      if (!set(key, input.value)) {
        input.value = getSetting(`${item.path}.${key}`);
        toast('시각을 다시 골라 주세요');
        return;
      }
      const now = getSetting(item.path);
      if (now.start === now.end) toast('시작과 끝이 같으면 하루 종일 쓸 수 없어요');
    });
    return input;
  };
  box.append(h('div', { class: 'time-row' }, timeInput('start'), h('span', {}, '부터'), timeInput('end'), h('span', {}, '까지')));
}

function rewards(item, box) {
  const list = getSetting(item.path);
  const rows = list.map((r, i) => {
    let timer = 0;
    const input = h('input', {
      type: 'text', maxlength: REWARD_TEXT_MAX, value: r.text,
      placeholder: '예: 아이스크림 먹기', 'aria-label': `${i + 1}번 송이 보상 글`,
    });
    const save = () => {
      clearTimeout(timer);
      if (getSetting(`${item.path}.${i}.text`) === input.value) return;
      if (setSetting(`${item.path}.${i}.text`, input.value)) saved();
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 500); });
    input.addEventListener('blur', save);

    const emojis = h('div', { class: 'emoji-pick' },
      chip('없음', r.emoji === '', () => pickEmoji(i, ''), 'small'),
      ...REWARD_EMOJIS.map((e) => chip(e, r.emoji === e, () => pickEmoji(i, e), 'small emoji-chip')));

    return h('div', { class: 'reward-row' },
      h('div', { class: 'reward-head' }, h('span', { class: 'reward-no' }, `${i + 1}번 송이`), input),
      emojis);
  });

  function pickEmoji(i, e) {
    if (setSetting(`${item.path}.${i}.emoji`, e)) { saved(); renderPanel(); }
  }

  box.classList.add('column');
  box.append(...rows);
}

function action(item, box) {
  box.append(h('button', { class: 'chip', disabled: true }, item.label));
}

/* ---------- 메인 캐릭터 (buddy.js, 설계서 §2) ---------- */
function buddy(item, box) {
  const mode = getSetting('buddyMode');
  const order = getSetting('buddyOrder');
  const joined = getProgress().joinedFriends;
  const all = [...FRIENDS, ...NEW_FRIENDS];
  const byId = (id) => all.find((f) => f.id === id);
  const label = (f) => `${f.emoji ? `${f.emoji} ` : ''}${f.name}`;

  const setMode = (v) => {
    if (getSetting('buddyMode') === v) return;
    if (setSetting('buddyMode', v)) { saved(); renderPanel(); }
  };
  const move = (i, d) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    if (setSetting('buddyOrder', next)) { saved(); renderPanel(); }
  };

  box.classList.add('column');
  box.append(
    h('div', { class: 'buddy-modes' },
      chip('골고루', mode === 'even', () => setMode('even')),
      chip('우선순위대로', mode === 'priority', () => setMode('priority'))),
    h('p', { class: 'ps-help' }, `지금 메인 캐릭터: ${label(currentBuddy())}`),
    h('ol', { class: `buddy-order${mode === 'priority' ? '' : ' is-off'}` },
      order.map((id, i) => {
        const f = byId(id);
        const waiting = NEW_FRIENDS.includes(f) && !joined.includes(id);
        return h('li', { class: 'buddy-row' },
          h('span', { class: 'buddy-rank' }, `${i + 1}`),
          h('span', { class: 'buddy-name' }, label(f), waiting ? h('small', {}, ' (합류 전)') : null),
          chip('▲', false, () => move(i, -1), `small${i === 0 ? ' is-hidden' : ''}`),
          chip('▼', false, () => move(i, 1), `small${i === order.length - 1 ? ' is-hidden' : ''}`));
      })),
  );
}

/* ---------- 포도판 (grapes.js) ---------- */
const shortDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
};

function rewardLabel(r) {
  return r && (r.emoji || r.text) ? `${r.emoji} ${r.text}`.trim() : '보상 미등록';
}

function rewardGive(item, box) {
  const { board } = getGrapes();
  const rewardsList = getSetting('rewards');
  box.classList.add('column');
  board.bunches.forEach((b, i) => {
    const full = b.filled === board.perBunch;
    let state;
    let cls = 'give-state';
    if (!full) state = `진행 중 · ${b.filled}/${board.perBunch}알`;
    else if (b.rewardGiven) state = `🎀 ✔ 보상 줌 ${shortDate(b.rewardGivenAt)}`.trim();
    else { state = '🎁 보상 대기'; cls += ' waiting'; }
    const label = rewardLabel(rewardsList[i]);
    box.append(h('div', { class: 'give-row' },
      h('span', { class: 'reward-no' }, `${i + 1}번 송이`),
      h('span', { class: cls }, state),
      h('span', { class: 'give-reward' }, label),
      full && !b.rewardGiven
        ? chip('🎀 보상 줌', false, async () => {
          const ok = await confirmDialog(`${i + 1}번 송이 보상(${label})을 주셨나요?`, '보상 줌');
          if (ok && markRewardGiven(i)) {
            toast('보상 줌으로 표시했어요');
            renderPanel();
          }
        })
        : null));
  });
}

function newBoard(item, box) {
  const g = getGrapes();
  const done = g.board.bunches.filter((b) => b.filled === g.board.perBunch).length;
  const next = getSetting('grapesPerBunch');
  box.classList.add('column');
  // box.append는 null을 "null" 글자로 붙이므로 빈 항목은 걸러낸다
  box.append(...[
    h('p', { class: 'ps-help' }, `지금 포도판: ${done}/${BUNCHES}송이 완성 · 포도알 ${totalGrapes(g.board)}개 · 송이당 ${g.board.perBunch}알`),
    h('p', { class: 'ps-help' }, `완성한 포도판 ${g.boardsCompleted}개 · 아직 넣지 않은 포도알 ${getProgress().pendingGrapes}개`),
    next !== g.board.perBunch
      ? h('p', { class: 'ps-help warn' }, `새 포도판은 송이당 ${next}알로 시작합니다.`)
      : null,
    h('div', { class: 'row' }, chip('🍇 포도판 새로 시작', false, async () => {
      const ok = await confirmTwice(
        '지금 포도판을 기록에 남기고 빈 포도판으로 시작합니다. 계속할까요?',
        '정말 새로 시작할까요? 지금 포도판은 아이 화면에서 다시 볼 수 없습니다.',
        '새로 시작',
      );
      if (!ok) return;
      startNewBoard();
      toast('새 포도판을 시작했어요');
      renderPanel();
    })),
  ].filter(Boolean));
}

/* ---------- 이용 시간 · 학습 기록 ---------- */
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (!m) return `${s}초`;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

function usageStatus(item, box) {
  flushUsage(); // 아직 저장 전인 초까지 반영
  const used = usedToday();
  const limit = getSetting('dailyLimitMin');
  const reason = currentLockReason();
  const state = {
    daily: '잠금 중 · 오늘 이용 시간을 다 썼어요 (하루 이용 시간을 늘리면 바로 풀려요)',
    hours: '잠금 중 · 지금은 이용 가능 시간대가 아니에요',
  }[reason] ?? '지금 사용할 수 있어요';
  box.classList.add('column');
  box.append(
    h('div', { class: 'usage-row' },
      h('span', { class: 'usage-big' }, fmtDuration(used)),
      h('span', {}, `/ 하루 ${limit}분 · 남은 시간 ${fmtDuration(remainingSeconds({ dailyLimitMin: limit }, used))}`)),
    h('p', { class: `ps-help${reason ? ' warn' : ''}` }, state),
  );
}

function records(item, box) {
  flushUsage();
  const p = getProgress();
  const difficulty = getSetting('difficulty');
  const limit = getSetting('dailyLimitMin');
  box.classList.add('column');

  // 1) 게임별 정답률 — 표 + "한 번에 맞힘" 막대 하나 (색 하나, 값은 글자로도 표시)
  const rows = GAMES.map((g) => {
    const game = p.games[g.id];
    const st = game?.stats ?? { questions: 0, correct: 0, hinted: 0, wrong: 0 };
    const q = st.questions;
    const pct = (v) => (q ? `${Math.round((v / q) * 100)}%` : '–');
    const level = difficulty === 'auto' ? `${game?.level ?? 1}단계 (자동)` : `${difficulty}단계 (고정)`;
    const detail = `${g.title}: ${q}문제 중 한 번에 ${st.correct} · 힌트 후 ${st.hinted} · 틀린 적 있음 ${st.wrong}`;
    return h('tr', {},
      h('td', { class: 'rec-game' }, `${g.emoji} ${g.title}`),
      h('td', { class: 'num' }, q ? `${q}문제` : '기록 없음'),
      h('td', {}, q
        ? h('button', { class: 'rec-bar', title: detail, onclick: () => toast(detail) },
          h('span', { class: 'rec-fill', style: `width:${((st.correct / q) * 100).toFixed(1)}%` }),
          h('span', { class: 'rec-val' }, pct(st.correct)))
        : '–'),
      h('td', { class: 'num' }, pct(st.hinted)),
      h('td', { class: 'num' }, pct(st.wrong)),
      h('td', {}, level));
  });
  const table = h('table', { class: 'rec-table' },
    h('thead', {}, h('tr', {}, ...['게임', '푼 문제', '한 번에 맞힘', '힌트 후 맞힘', '틀린 적 있음', '지금 단계'].map((t) => h('th', {}, t)))),
    h('tbody', {}, ...rows));

  // 2) 최근 7일 이용 시간 — 막대 7개 (색 하나), 막대마다 분 표시, 점선 = 하루 제한
  const days = recentDays(7);
  const secs = days.map((d) => p.usage[d.key] ?? 0);
  const maxMin = Math.max(limit, ...secs.map((s) => s / 60), 1);
  const CHART_H = 150;
  const limitY = Math.round((limit / maxMin) * CHART_H);
  const cols = days.map((d, i) => {
    const sec = secs[i];
    const min = sec / 60;
    const barH = sec ? Math.max(4, Math.round((min / maxMin) * CHART_H)) : 0;
    const today = i === days.length - 1;
    const label = `${d.date.getMonth() + 1}/${d.date.getDate()}(${DOW[d.date.getDay()]}) ${sec ? fmtDuration(sec) : '이용 없음'}`;
    let val = '0';
    if (sec) val = min < 1 ? '1분 미만' : `${Math.round(min)}분`;
    return h('button', { class: `week-col${today ? ' today' : ''}`, title: label, onclick: () => toast(label) },
      h('span', { class: 'week-val' }, val),
      h('span', { class: 'week-track', style: `height:${CHART_H}px` },
        h('span', { class: 'week-limit', style: `bottom:${limitY}px` }),
        h('span', { class: 'week-bar', style: `height:${barH}px` })),
      h('span', { class: 'week-day' }, today ? '오늘' : DOW[d.date.getDay()]),
      h('span', { class: 'week-date' }, `${d.date.getMonth() + 1}/${d.date.getDate()}`));
  });

  // 3) 자주 틀리는 숫자 — 모든 게임 합계 상위 5개
  const agg = {};
  for (const g of Object.values(p.games)) {
    for (const [num, c] of Object.entries(g.wrongNumbers)) agg[num] = (agg[num] ?? 0) + c;
  }
  const top = Object.entries(agg).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0])).slice(0, 5);
  const wrongBox = top.length
    ? h('div', { class: 'row' }, ...top.map(([num, c]) => h('span', { class: 'wrong-chip' }, h('b', {}, num), ` · ${c}번`)))
    : h('p', { class: 'ps-help' }, '아직 틀린 숫자가 없어요. (콕콕 세어 보기는 틀리는 경우가 없어서, 몇 개일까? 같은 게임에서 모입니다)');

  box.append(
    h('h4', { class: 'rec-h' }, '게임별 정답률'),
    h('p', { class: 'ps-help' }, '한 번에 맞힘 = 힌트·오답 없이 맞힌 문제. 막대를 누르면 자세한 수가 보여요.'),
    table,
    h('h4', { class: 'rec-h' }, '최근 7일 이용 시간'),
    h('div', { class: 'week-chart' }, ...cols),
    h('p', { class: 'ps-help' }, `점선 = 하루 이용 시간 제한 ${limit}분 · 막대를 누르면 날짜와 정확한 시간이 보여요`),
    h('h4', { class: 'rec-h' }, '자주 틀리는 숫자'),
    wrongBox,
    h('h4', { class: 'rec-h' }, '모은 것'),
    h('p', { class: 'ps-help' }, `끝까지 마친 판 ${p.roundsCompleted}번 · 받은 스티커 ${p.stickersTotal}개 · 완성한 포도판 ${getGrapes().boardsCompleted}개`),
  );
}

/* ---------- TTS 목소리 고르기 ---------- */
// 이름을 짧게: "Microsoft 선히 Online (Natural) - Korean (Korea)" → "선히 (자연스러움)"
function voiceLabel(v) {
  const short = v.name
    .replace(/^Microsoft\s+/i, '')
    .replace(/\s*-\s*Korean.*$/i, '')
    .replace(/\s*\(Natural\)/i, '')
    .replace(/\s*Online/i, '')
    .trim();
  const tags = [];
  if (/natural|neural/i.test(v.name)) tags.push('자연스러움');
  if (!v.localService) tags.push('인터넷 필요');
  return tags.length ? `${short} (${tags.join(' · ')})` : short;
}

function voicePick(item, box) {
  const cur = getSetting(item.path);
  const list = audio.getKoreanVoices({ includeOffline: true });
  const autoVoice = audio.getKoreanVoices()[0];
  const preview = () => audio.say('line_hello'); // 안녕! 나는 콩콩이야. 같이 숫자 놀이 하자!
  const set = (name) => {
    if (setSetting(item.path, name)) { saved(); renderPanel(); preview(); }
  };
  box.append(chip(`자동${autoVoice ? ` (지금: ${voiceLabel(autoVoice)})` : ''}`, cur === '', () => set('')));
  list.forEach((v) => box.append(chip(voiceLabel(v), cur === v.name, () => set(v.name))));
  box.append(chip('🔈 들어 보기', false, preview, 'ghost'));
  if (!list.length) {
    box.append(h('p', { class: 'ps-help warn' }, '이 기기에서 한국어 목소리를 찾지 못했습니다. 이대로는 음성이 나오지 않을 수 있습니다. 삼성 기기는 Galaxy Store에서 삼성 TTS 한국어 음성을 내려받고(다른 기기는 설정 → 텍스트 음성 변환 → 한국어 음성 데이터 설치), 앱을 완전히 닫았다 다시 열어 주세요. 아래 "음성 진단"으로 확인할 수 있습니다.'));
  } else if (cur && !list.some((v) => v.name === cur)) {
    box.append(h('p', { class: 'ps-help warn' }, '고른 목소리를 이 기기에서 찾을 수 없어 자동으로 고른 목소리를 쓰고 있습니다.'));
  }
}

// 음성 진단: 기기의 TTS 상태와 시험 말하기 결과 (부모 영역이라 글자 허용)
const diagResults = {};
function voiceDiag(item, box) {
  const info = audio.ttsInfo();
  const tests = [
    ['normal', '▶ 시험 1 (앱 방식)'],
    ['noVoice', '▶ 시험 2 (목소리 지정 없이)'],
    ['noCancel', '▶ 시험 3 (멈춤 없이 바로)'],
  ];
  const lines = [];
  if (!info.supported) {
    lines.push('이 브라우저는 음성 합성(speechSynthesis)을 지원하지 않습니다.');
  } else {
    lines.push(`브라우저: ${navigator.userAgent.match(/SamsungBrowser\/[\d.]+|Chrome\/[\d.]+|Firefox\/[\d.]+|Version\/[\d.]+ Safari/)?.[0] ?? '알 수 없음'} · 인터넷 ${info.online ? '연결됨' : '끊김'} · 오디오 ${info.audioState}`);
    lines.push(`목소리 전체 ${info.total}개, 한국어 ${info.korean.length}개`);
    info.korean.forEach((v) => lines.push(`  - ${v.name} (${v.lang}${v.local ? ', 기기' : ', 인터넷'}${v.isDefault ? ', 기본' : ''})`));
    if (!info.korean.length && info.langs.length) lines.push(`  (있는 언어: ${info.langs.join(', ')})`);
  }
  box.classList.add('column');
  box.append(
    h('div', { class: 'row' }, tests.map(([mode, label]) => chip(label, false, async () => {
      diagResults[mode] = '듣는 중…';
      renderPanel();
      diagResults[mode] = await audio.ttsTest(mode);
      renderPanel();
    }))),
    h('pre', { class: 'diag-box' },
      tests.map(([mode, label]) => `${label.slice(2)}: ${diagResults[mode] ?? '아직 안 함'}`).join('\n'),
      '\n\n', lines.join('\n'),
      '\n\n최근 말하기:\n',
      audio.getTtsLog().map((e) => `${e.at.toTimeString().slice(0, 8)} ${e.result} · ${e.text} · ${e.voice}`).join('\n') || '(없음)'),
    h('div', { class: 'row' }, chip('↻ 결과 새로 보기', false, () => renderPanel(), 'ghost')),
  );
}

// 진행 초기화: 지금 상태를 보여 주고, 두 번 확인한 뒤 progress.resetProgress()
function resetProgressItem(item, box) {
  const p = getProgress();
  const levels = GAMES.map((g) => `${g.title} ${p.games[g.id]?.level ?? 1}단계`).join(' · ');
  box.classList.add('column');
  box.append(
    h('p', { class: 'ps-help' }, `지금: ${levels}`),
    h('p', { class: 'ps-help' }, `스티커 ${p.stickers}칸 · 합류한 친구 ${p.joinedFriends.length}명`),
    h('div', { class: 'row' }, chip('↺ 진행 초기화', false, async () => {
      const ok = await confirmTwice(
        '게임별 단계·스티커 칸·합류한 친구를 처음으로 되돌립니다. 포도판과 학습 기록은 그대로 둡니다. 계속할까요?',
        '정말 초기화할까요? 되돌릴 수 없습니다. 필요하면 먼저 아래 "파일로 내보내기"로 백업해 주세요.',
        '초기화',
      );
      if (!ok) return;
      resetProgress();
      toast('진행을 초기화했어요');
      renderPanel();
    })),
  );
}

function backup(item, box) {
  box.append(
    chip('📤 파일로 내보내기', false, onExport),
    chip('📥 파일에서 불러오기', false, () => $('#ps-file').click()),
  );
  if (!isStorageAvailable()) {
    box.append(h('p', { class: 'ps-help warn' }, '이 브라우저에서는 저장 공간을 쓸 수 없습니다. 시크릿 모드인지 확인해 주세요.'));
  }
}

/* ---------- 백업·복원 ---------- */
function onExport() {
  const data = exportBackup();
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `kongkong-backup-${stamp}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('백업 파일을 내보냈어요');
}

async function onRestoreFile(e) {
  const input = e.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('파일을 읽지 못했어요');
    return;
  }
  const ok = await confirmDialog('지금 저장된 설정과 기록을 이 파일 내용으로 바꿉니다. 불러올까요?', '불러오기');
  if (!ok) return;
  try {
    const n = importBackup(data);
    renderPanel();
    toast(`불러왔어요 (${n}개 항목)`);
  } catch (err) {
    toast(err.message);
  }
}
