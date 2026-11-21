// 숫자 친구 콩콩이 — 앱 진입점
import { GAMES, GRAPES } from './assets.js';
import { unlockAudio, configure as configureAudio } from './audio.js';
import { pulse, wobble, setReduceMotion } from './effects.js';
import { loadSettings, onSettingsChange } from './settings.js';
import { initParent, openParent } from './parent.js';
import { initPlay, isPlayable, startGame, stopGame } from './play.js';
import { requestPersist } from './progress.js';
import { initGrapes, openGrapes, stopGrapes } from './grapes.js';
import { initUsage, currentLockReason } from './usage.js';
import { say, stop as stopAudio } from './audio.js';
import { createBuddy, currentBuddy } from './buddy.js';

const PARENT_HOLD_MS = 3000;   // 부모 메뉴: 3초 길게 누르기
const GATE_IDLE_MS = 30000;    // 부모 확인 화면에서 30초 동안 입력이 없으면 아이 화면으로

const $ = (sel) => document.querySelector(sel);

/* ---------- 화면 전환 ---------- */
let currentScreen = 'start';

// 메인으로 가려 할 때 잠금 상태(하루 시간 다 씀·시간대 밖)면 잠금 화면으로 보낸다.
// 시작 버튼, 부모 메뉴 나가기, 게임·포도판의 처음으로 버튼 모두 이 한 곳을 지난다.
function showScreen(name) {
  if (name === 'main' && currentLockReason()) name = 'lock';
  const entering = name !== currentScreen;
  document.querySelectorAll('.screen').forEach((s) => {
    s.classList.toggle('active', s.id === `screen-${name}`);
  });
  currentScreen = name;
  if (name === 'main') renderMainBuddy();
  if (name === 'lock' && entering) say('line_bye_today'); // 오늘은 여기까지! 내일 또 만나~
}

// 메인 화면 아래의 메인 캐릭터 (한 판마다 바뀜, 설계서 §2 "메인 캐릭터")
function renderMainBuddy() {
  const old = $('.main-bottom .kong');
  const id = currentBuddy()?.id;
  if (old && old.dataset.buddy === id) return; // 같은 캐릭터면 숨쉬기 애니메이션을 끊지 않는다
  const el = createBuddy({ small: true, idle: true });
  el.dataset.buddy = id;
  old?.replaceWith(el);
}

// 게임·포도판을 멈추고 잠금 화면으로 (usage.js가 부른다)
function lockApp() {
  stopGame();
  stopGrapes();
  stopAudio();
  showScreen('lock');
}

/* ---------- 실수 방지 (UX 원칙 6) ---------- */
function preventAccidents() {
  // 길게 눌러 메뉴
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  // 두 손가락 확대 (iOS·일부 브라우저)
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  // 더블탭 확대 (touch-action으로 대부분 막히지만 한 번 더)
  document.addEventListener('dblclick', (e) => e.preventDefault());
  // 드래그로 그림 끌기
  document.addEventListener('dragstart', (e) => e.preventDefault());
}

/* ---------- 전체 화면·가로 고정 (브라우저 탭에서 실행할 때) ---------- */
async function enterFullscreen() {
  const standalone = window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: standalone)').matches;
  try {
    if (!standalone && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch { /* PC 등 지원하지 않으면 무시 */ }
  try {
    await screen.orientation?.lock?.('landscape');
  } catch { /* 지원하지 않으면 무시 (manifest가 처리) */ }
}

/* ---------- 시작 화면 ---------- */
function setupStart() {
  $('#btn-start').addEventListener('click', async () => {
    await unlockAudio();
    requestPersist(); // 기록 자동 삭제 방지 (탭 안에서 요청해야 허용되는 브라우저가 있음)
    enterFullscreen();
    showScreen('main');
  });
}

/* ---------- 메인 화면 ---------- */
function makeEmojiButton(item, extraClass = '') {
  const btn = document.createElement('button');
  btn.className = `emoji-btn ${extraClass}`.trim();
  const span = document.createElement('span');
  span.className = 'emoji';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = item.emoji;
  btn.appendChild(span);
  return btn;
}

/* ---------- 부모 설정 적용 ---------- */
// 지금 동작과 연결된 설정만 적용한다. 나머지는 저장만 되어 있다가 각 단계에서 읽어 쓴다.
function applySettings(s) {
  configureAudio({ volume: s.volume, rate: s.voiceRate, numberStyle: s.numberStyle, voiceName: s.voiceName, sfxStyle: s.sfxStyle });
  setReduceMotion(s.reduceMotion);
  document.documentElement.dataset.dim = s.dimScreen ? 'on' : 'off';
  renderGames(s.gamesEnabled);
}

// 켜진 게임만 메인 화면에 보인다
function renderGames(enabled) {
  const row = $('#game-row');
  row.replaceChildren();
  GAMES.filter((g) => enabled[g.id]).forEach((game) => {
    const btn = makeEmojiButton(game);
    btn.dataset.game = game.id;
    btn.setAttribute('aria-label', game.title); // 화면 낭독용 (보이지 않음)
    btn.addEventListener('click', async () => {
      if (currentLockReason()) { lockApp(); return; }
      if (isPlayable(game.id)) {
        await pulse(btn);
        startGame(game.id);
      } else {
        pulse(btn);
        console.info(`[게임] ${game.id} — 아직 만들지 않음`);
      }
    });
    row.appendChild(btn);
  });
}

function setupMain() {
  const grapes = $('#btn-grapes');
  const g = makeEmojiButton(GRAPES).firstChild;
  grapes.appendChild(g);
  grapes.addEventListener('click', async () => {
    if (currentLockReason()) { lockApp(); return; }
    await pulse(grapes);
    openGrapes();
  });
}

/* ---------- 부모 메뉴 진입: 3초 길게 누르기 ----------
   메인 화면과 잠금 화면에 하나씩 있다 (잠금 중에도 부모가 설정을 바꿀 수 있게) */
function setupParentHold() {
  document.querySelectorAll('.btn-parent').forEach(bindParentHold);
}

function bindParentHold(btn) {
  const ring = btn.querySelector('.ring');
  const circumference = 2 * Math.PI * Number(ring.getAttribute('r'));
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${circumference}`;

  let startTime = 0;
  let rafId = 0;
  let pointerId = null;

  function setProgress(p) {
    ring.style.strokeDashoffset = `${circumference * (1 - p)}`;
  }

  function reset() {
    cancelAnimationFrame(rafId);
    rafId = 0;
    pointerId = null;
    btn.classList.remove('holding');
    setProgress(0);
  }

  function tick(now) {
    const p = Math.min((now - startTime) / PARENT_HOLD_MS, 1);
    setProgress(p);
    if (p >= 1) {
      reset();
      openGate();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  btn.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    e.preventDefault();
    pointerId = e.pointerId;
    try { btn.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
    btn.classList.add('holding');
    startTime = performance.now();
    rafId = requestAnimationFrame(tick);
  });

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => {
    btn.addEventListener(type, (e) => {
      if (e.pointerId === pointerId) reset();
    });
  });

  // 손가락이 버튼 밖으로 벗어나면 취소
  btn.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const r = btn.getBoundingClientRect();
    const out = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (out) reset();
  });

  // 짧게 누르는 것은 아무 반응 없음
  btn.addEventListener('click', (e) => e.preventDefault());
}

/* ---------- 부모 확인: 덧셈 ---------- */
const gate = { a: 0, b: 0, input: '', idleTimer: 0 };

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function newGateProblem() {
  // 받아올림이 있는 한 자리 수 덧셈 (예: 7+5) — 유아가 우연히 맞히기 어렵게
  do {
    gate.a = randInt(3, 9);
    gate.b = randInt(3, 9);
  } while (gate.a + gate.b < 10);
  gate.input = '';
  $('#gate-question').textContent = `${gate.a} + ${gate.b} = ?`;
  renderGateInput();
}

function renderGateInput() {
  $('#gate-answer').textContent = gate.input;
}

function resetGateIdle() {
  clearTimeout(gate.idleTimer);
  gate.idleTimer = setTimeout(closeGate, GATE_IDLE_MS);
}

function openGate() {
  newGateProblem();
  showScreen('gate');
  resetGateIdle();
}

function closeGate() {
  clearTimeout(gate.idleTimer);
  gate.input = '';
  showScreen('main');
}

function submitGate() {
  if (gate.input === '') return;
  if (Number(gate.input) === gate.a + gate.b) {
    clearTimeout(gate.idleTimer);
    gate.input = '';
    openParent();
  } else {
    wobble($('#gate-answer'));
    setTimeout(newGateProblem, 600);
  }
}

function setupGate() {
  $('#keypad').addEventListener('click', (e) => {
    const key = e.target.closest('button')?.dataset.key;
    if (!key) return;
    resetGateIdle();
    if (key === 'del') {
      gate.input = gate.input.slice(0, -1);
    } else if (key === 'ok') {
      submitGate();
      return;
    } else if (gate.input.length < 2) {
      gate.input += key;
    }
    renderGateInput();
  });
  $('#gate-cancel').addEventListener('click', closeGate);
}

/* ---------- service worker ---------- */
// 새 버전 적용 (설계서 §11-1): 캐시 우선이라 새 service worker가 들어와도 열려 있는 화면은 예전 파일이다.
// - 새 service worker가 화면을 넘겨받으면(controllerchange) 시작 화면일 때 바로 새로고침한다.
// - 게임 등 다른 화면이면 놀이를 끊지 않고, 앱을 떠났다 돌아올 때 새로고침한다.
// - 앱으로 돌아올 때마다 새 버전이 있는지 확인한다.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller); // 첫 설치 때는 새로고침하지 않는다
  let updateReady = false;
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (currentScreen === 'start') reload();
    else updateReady = true;
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (updateReady) { reload(); return; }
        reg.update().catch(() => {});
      });
    }).catch((e) => {
      console.warn('service worker 등록 실패', e);
    });
  });
}

/* ---------- 시작 ---------- */
preventAccidents();
applySettings(loadSettings());
onSettingsChange((s) => applySettings(s));
setupStart();
setupMain();
setupParentHold();
setupGate();
initParent({ showScreen });
initPlay({ showScreen });
initGrapes({ showScreen });
initUsage({
  getScreen: () => currentScreen,
  onLock: lockApp,
  onUnlock: () => showScreen('main'),
});
registerServiceWorker();
