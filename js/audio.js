// 오디오 (설계서 §7)
// - 음성: assets/audio/<키>.mp3를 먼저 쓰고, 없으면 한국어 TTS(ko-KR)로 읽는다.
//   여러 조각("사과가" + "세 개")은 조각 mp3가 모두 있을 때만 이어 붙여 재생하고,
//   하나라도 없으면 문장 전체를 TTS로 읽는다. (말투가 섞이지 않게)
// - 효과음: assets/audio/sfx_*.mp3가 없으면 부드러운 합성음으로 대신한다.
// - 첫 터치 전에는 소리가 막히므로 unlockAudio()를 반드시 탭 이벤트 안에서 호출한다.

import { LINES, SFX, numKey, objKey, NATIVE_MAX, SINO_MAX } from './lines.js';

// 이 모듈(js/audio.js) 위치 기준으로 계산 → 어느 페이지에서 불러도 같은 폴더를 가리킨다
export const AUDIO_DIR = new URL('../assets/audio/', import.meta.url).href;

// 부모 설정과 연결되는 값 (기본값은 설계서 §9 표)
const config = {
  volume: { voice: 70, sfx: 60 },          // 0~100 (배경음은 넣지 않는다, 설계서 §9)
  rate: 'slow',                            // 'slow'(0.85) | 'normal'(1.0) — TTS에만 적용
  numberStyle: 'native',                   // 'native' | 'sino' | 'both'
  voiceName: '',                           // TTS 목소리 이름 ('' = 자동: 가장 자연스러운 목소리)
  sfxStyle: 'glocken',                     // 효과음 소리 (SFX_STYLES 키)
};
const TTS_RATE = { slow: 0.85, normal: 1.0 };

let ctx = null;
let gains = null;
let unlocked = false;
let token = 0;            // 새 음성을 시작하면 증가 → 이전 재생은 스스로 멈춤
let currentSource = null;
let currentUtterance = null; // Chrome에서 재생 중 GC되지 않도록 참조 유지

const buffers = new Map(); // key → Promise<AudioBuffer|null>  (null = 파일 없음)

/* ---------- 설정 ---------- */
export function configure(opts = {}) {
  if (opts.volume) Object.assign(config.volume, opts.volume);
  if (opts.rate) config.rate = opts.rate;
  if (opts.numberStyle) config.numberStyle = opts.numberStyle;
  if (typeof opts.voiceName === 'string') config.voiceName = opts.voiceName;
  if (opts.sfxStyle && SFX_STYLES[opts.sfxStyle]) config.sfxStyle = opts.sfxStyle;
  applyGains();
}

export function getConfig() {
  return structuredClone(config);
}

/* ---------- AudioContext ---------- */
function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  gains = {
    voice: ctx.createGain(),
    sfx: ctx.createGain(),
  };
  gains.voice.connect(ctx.destination);
  // 효과음은 크게(SFX_BOOST배) 낸 뒤 리미터로 찌그러짐(클리핑)을 막는다 — 태블릿 스피커에서 잘 들리게 (설계서 §7)
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  // 벨은 2ms 만에 올라가 리미터가 다 잡기 전에 조금 튀어나간다(측정 최대 1.20) → 리미터 뒤에서 줄여 1 아래로
  const trim = ctx.createGain();
  trim.gain.value = SFX_TRIM;
  gains.sfx.connect(limiter).connect(trim).connect(ctx.destination);
  applyGains();
  return ctx;
}

const SFX_TRIM = 0.76; // 리미터 뒤 출력 (모든 소리 스타일의 최대값을 1 아래로)

function applyGains() {
  if (!gains) return;
  const level = (k) => Math.min(Math.max(config.volume[k], 0), 100) / 100;
  gains.voice.gain.value = level('voice');
  // 소리는 금방 줄어들어 크게 보낸다(소리마다 boost). 최대값은 리미터 + SFX_TRIM이 막는다.
  gains.sfx.gain.value = level('sfx') * (SFX_STYLES[config.sfxStyle] ?? SFX_STYLES.glocken).boost;
}

export function isUnlocked() {
  return unlocked;
}

// resume()은 기기·상황에 따라 끝나지 않을 수 있다 → 최대 RESUME_WAIT_MS만 기다린다 (설계서 §7, 시작 화면 멈춤 방지)
const RESUME_WAIT_MS = 800;
function resumeCtx(c) {
  if (c.state !== 'suspended') return Promise.resolve();
  return Promise.race([
    c.resume().catch(() => {}),
    new Promise((r) => setTimeout(r, RESUME_WAIT_MS)),
  ]);
}

// 반드시 사용자 탭 이벤트 안에서 호출해야 브라우저가 소리를 허용한다.
export async function unlockAudio() {
  try {
    const c = ensureCtx();
    if (c) {
      await resumeCtx(c);
      const buffer = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      src.start(0);
    }
  } catch (e) {
    console.warn('[audio] AudioContext 활성화 실패', e);
  }
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.lang = 'ko-KR';
      window.speechSynthesis.speak(u);
    }
  } catch (e) {
    console.warn('[audio] speechSynthesis 활성화 실패', e);
  }
  unlocked = true;
}

/* ---------- mp3 불러오기 ---------- */
function loadBuffer(key) {
  if (buffers.has(key)) return buffers.get(key);
  const p = (async () => {
    try {
      const res = await fetch(`${AUDIO_DIR}${key}.mp3`);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      const c = ensureCtx();
      if (!c) return null;
      return await c.decodeAudioData(data);
    } catch {
      return null;
    }
  })();
  buffers.set(key, p);
  return p;
}

// 해당 키의 mp3가 있는지 (테스트 화면용)
export async function hasFile(key) {
  return (await loadBuffer(key)) !== null;
}

// 앞으로 쓸 음성을 미리 불러 둔다 (게임 시작 전 등)
export function preload(keys) {
  return Promise.all(keys.map(loadBuffer));
}

function playBuffer(buf, gain, myToken) {
  return new Promise((resolve) => {
    if (myToken !== undefined && myToken !== token) return resolve();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.onended = () => {
      if (currentSource === src) currentSource = null;
      resolve();
    };
    if (myToken !== undefined) currentSource = src;
    src.start();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- TTS ---------- */
let voices = [];
function refreshVoices() {
  try { voices = window.speechSynthesis?.getVoices() ?? []; } catch { voices = []; }
}
if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}

// 목소리 자연스러움 점수 (설계서 §7): 신경망(Natural·Neural) > Google·Samsung > 그 밖 > 오래된 기계 음성
export function voiceScore(v) {
  const n = v.name ?? '';
  let s = 0;
  if (/natural|neural/i.test(n)) s += 10;
  if (/google|samsung/i.test(n)) s += 6;
  if (/선히|sunhi/i.test(n)) s += 3;
  if (/online/i.test(n)) s += 2;
  if (/multilingual/i.test(n)) s -= 1;
  if (/heami/i.test(n)) s -= 5;
  if (v.lang === 'ko-KR') s += 1;
  return s;
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

// 지금 쓸 수 있는 한국어 목소리 (점수 높은 순). 오프라인이면 기기에 저장된 목소리만.
export function getKoreanVoices({ includeOffline = false } = {}) {
  if (!voices.length) refreshVoices();
  return voices
    .filter((v) => v.lang?.toLowerCase().startsWith('ko'))
    .filter((v) => includeOffline || isOnline() || v.localService)
    .sort((a, b) => voiceScore(b) - voiceScore(a));
}

// 부모 설정에서 고른 목소리가 지금 쓸 수 있으면 그것, 아니면 가장 자연스러운 목소리
export function getKoreanVoice() {
  const list = getKoreanVoices();
  return (config.voiceName && list.find((v) => v.name === config.voiceName)) || list[0] || null;
}

function bestLocalVoice() {
  return getKoreanVoices({ includeOffline: true }).find((v) => v.localService) ?? null;
}

// TTS가 기호 이름("물결표" 등)을 읽지 않게 글자·숫자·띄어쓰기·문장부호(. , ! ?)만 남긴다 (설계서 §7)
// lines.js 문장은 녹음 대본이기도 해서 "~" 같은 억양 표시는 데이터에 그대로 두고, 읽기 직전에만 지운다.
export function cleanForSpeech(text) {
  return String(text)
    .replace(/[~～〜]/g, '') // 물결표는 그냥 지운다 ("만나~" → "만나")
    // 나머지 기호(따옴표·괄호·가운뎃점·말줄임·이모지 등)는 띄어쓰기로.
    // 따옴표 자리를 띄워야 "둘은 '이'라고도" → "둘은 이 라고도"로 숫자가 조사에 묻히지 않는다.
    .replace(/[^\p{L}\p{N}\s.,!?]/gu, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function tts(rawText, myToken, forceVoice = null) {
  const text = cleanForSpeech(rawText ?? '');
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth || !text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    const v = forceVoice ?? getKoreanVoice();
    if (v) u.voice = v;
    u.rate = TTS_RATE[config.rate] ?? 0.85;
    u.volume = Math.min(Math.max(config.volume.voice, 0), 100) / 100;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      if (currentUtterance === u) currentUtterance = null;
      resolve();
    };
    const logged = logTts(text, v);
    u.onstart = () => { logged.result = '시작됨'; };
    u.onend = () => { logged.result = logged.result === '시작됨' ? '끝까지 말함' : '끝(시작 신호 없음)'; finish(); };
    u.onerror = (e) => {
      logged.result = `오류: ${e?.error ?? '알 수 없음'}`;
      // 온라인 목소리가 실패하면(인터넷 끊김 등) 기기 목소리로 한 번 다시 읽는다
      const local = bestLocalVoice();
      if (!forceVoice && v && !v.localService && local && myToken === token && e?.error !== 'interrupted' && e?.error !== 'canceled') {
        done = true;
        clearTimeout(guard);
        tts(text, myToken, local).then(resolve);
        return;
      }
      finish();
    };
    // 일부 기기에서 onend가 오지 않는 경우 대비
    const guard = setTimeout(() => {
      if (logged.result === '요청함') logged.result = '응답 없음(시간 초과)';
      finish();
    }, 3000 + text.length * 450);

    currentUtterance = u;
    // Chrome: cancel 직후 바로 speak하면 무시되는 경우가 있어 잠깐 띄운다
    setTimeout(() => {
      if (myToken !== token) return finish();
      synth.speak(u);
    }, 60);
  });
}

/* ---------- 음성 진단 (부모 설정 → 소리 → 음성 진단) ----------
   기기에서 TTS가 안 들릴 때 원인을 보려고, 최근 말하기 결과와 목소리 목록을 보여 준다. 저장하지 않는다. */
const ttsLog = [];
function logTts(text, voice) {
  const entry = { at: new Date(), text: text.slice(0, 20), voice: voice?.name ?? '(지정 안 함)', result: '요청함' };
  ttsLog.unshift(entry);
  ttsLog.length = Math.min(ttsLog.length, 8);
  return entry;
}

export function getTtsLog() {
  return ttsLog.map((e) => ({ ...e }));
}

export function ttsInfo() {
  const s = window.speechSynthesis;
  if (!s) return { supported: false };
  refreshVoices();
  return {
    supported: true,
    online: isOnline(),
    total: voices.length,
    korean: voices.filter((v) => v.lang?.toLowerCase().startsWith('ko'))
      .map((v) => ({ name: v.name, lang: v.lang, local: v.localService, isDefault: v.default })),
    langs: [...new Set(voices.map((v) => v.lang))].slice(0, 12),
    audioState: ctx?.state ?? '없음',
  };
}

// 진단용 시험 말하기. mode:
//   'normal'   — 앱과 같은 방법 (멈춘 뒤 0.06초 쉬고, 고른 목소리로)
//   'noVoice'  — 목소리를 지정하지 않고 언어(ko-KR)만
//   'noCancel' — 멈추기(cancel) 없이 바로, 목소리 지정 없이
// 반환: 결과 문자열 (시작됨·끝까지 말함·오류 코드·응답 없음)
export function ttsTest(mode, text = '하나, 둘, 셋. 잘했어!') {
  const s = window.speechSynthesis;
  if (!s) return Promise.resolve('이 브라우저는 음성 합성을 지원하지 않음');
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.volume = 1;
    u.rate = TTS_RATE[config.rate] ?? 0.85;
    const v = mode === 'normal' ? getKoreanVoice() : null;
    if (v) u.voice = v;
    const entry = logTts(`[시험 ${mode}] ${text}`, v);
    let started = false;
    const end = (r) => { entry.result = r; clearTimeout(t); resolve(r); };
    u.onstart = () => { started = true; entry.result = '시작됨'; };
    u.onend = () => end(started ? '끝까지 말함' : '끝(시작 신호 없음)');
    u.onerror = (e) => end(`오류: ${e?.error ?? '알 수 없음'}`);
    const t = setTimeout(() => end(started ? '시작했지만 끝 신호 없음' : '응답 없음(8초)'), 8000);
    currentUtterance = u;
    if (mode === 'noCancel') {
      s.speak(u);
    } else {
      stop();
      setTimeout(() => s.speak(u), 60);
    }
  });
}

/* ---------- 멈추기 ---------- */
export function stop() {
  token++;
  try { currentSource?.stop(); } catch { /* 이미 끝남 */ }
  currentSource = null;
  try { window.speechSynthesis?.cancel(); } catch { /* 무시 */ }
}

/* ---------- 말하기 ---------- */
// keys: 문자열 하나 또는 배열 (lines.js의 키)
// options.interrupt (기본 true): 말하고 있던 것을 끊고 새로 말한다
// options.joiner: TTS로 읽을 때 조각 사이 문자 (기본 ' ')
// 반환: 다 말하면 resolve되는 Promise
export async function say(keys, { interrupt = true, joiner = ' ' } = {}) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter((k) => {
    if (LINES[k]) return true;
    console.warn(`[audio] lines.js에 없는 음성 키: ${k}`);
    return false;
  });
  if (!list.length) return;

  if (interrupt) stop();
  const myToken = token;

  const bufs = await Promise.all(list.map(loadBuffer));
  if (myToken !== token) return;

  if (ctx && bufs.every(Boolean)) await resumeCtx(ctx);
  // 오디오가 아직 멈춰 있으면(활성화 실패) mp3는 끝 신호가 오지 않으므로 TTS로 읽는다
  if (ctx && ctx.state === 'running' && bufs.every(Boolean)) {
    for (let i = 0; i < bufs.length; i++) {
      if (myToken !== token) return;
      await playBuffer(bufs[i], gains.voice, myToken);
      if (i < bufs.length - 1) await wait(80);
    }
    return;
  }

  const text = list.map((k) => LINES[k].text).join(joiner);
  await tts(text, myToken);
}

// lines.js에 없는 임의 문장을 TTS로 읽기 (개발·테스트용)
export async function speakText(text) {
  stop();
  await tts(text, token);
}

/* ---------- 숫자 읽기 도우미 ---------- */
function checkRange(n, max) {
  const ok = Number.isInteger(n) && n >= 1 && n <= max;
  if (!ok) console.warn(`[audio] 지원 범위(1~${max}) 밖의 수: ${n}`);
  return ok;
}

// 수 읽기 방식에 따른 키 목록 (설계서 §4)
// - native: 하나, 둘, 셋
// - sino:   일, 이, 삼 (10 초과는 한자어 파일이 없어 고유어로)
// - both:   "셋, 삼!" (고유어 다음 한자어)
export function numberKeys(n, style = config.numberStyle) {
  if (!checkRange(n, NATIVE_MAX)) return [];
  if (style === 'sino' && n <= SINO_MAX) return [numKey.sino(n)];
  if (style === 'both' && n <= SINO_MAX) return [numKey.native(n), numKey.sino(n)];
  return [numKey.native(n)];
}

// 수 하나 읽기 (세기, 숫자 카드 등)
export function sayNumber(n, options = {}) {
  const style = options.style ?? config.numberStyle;
  return say(numberKeys(n, style), { joiner: ', ', ...options });
}

// 개수 말하기 — 설정과 관계없이 항상 고유어: "사과가 세 개"
export function sayAmount(objectId, n, options) {
  if (!checkRange(n, NATIVE_MAX)) return Promise.resolve();
  return say([objKey.subject(objectId), numKey.counter(n)], options);
}

// 바구니 문제: "딸기 네 개 담아 줘!"
export function sayBasketAsk(objectId, n, options) {
  if (!checkRange(n, NATIVE_MAX)) return Promise.resolve();
  return say([objKey.name(objectId), numKey.counter(n), 'line_basket_tail'], options);
}

// 포도알 개수: "포도알이 일곱 개"
export function sayGrapeCount(n, options) {
  if (!checkRange(n, NATIVE_MAX)) return Promise.resolve();
  return say(['line_grape_count_head', numKey.counter(n)], options);
}

// 3단계 한자어 소개: "셋은 '삼'이라고도 해."
export function sayIntro(n, options) {
  if (!checkRange(n, SINO_MAX)) return Promise.resolve();
  return say(numKey.intro(n), options);
}

// 일반 칭찬: 직전과 같은 말은 피해서 돌려 쓴다.
// 친구 이름이 들어간 칭찬(praise_4 티노, praise_5 부릉이)은 celebrate.js가 그 친구가 나올 때만 쓴다.
const PRAISES = ['praise_1', 'praise_2', 'praise_3'];
let lastPraise = '';
export function sayPraise(options) {
  const pool = PRAISES.filter((k) => k !== lastPraise);
  lastPraise = pool[Math.floor(Math.random() * pool.length)];
  return say(lastPraise, options);
}

/* ---------- 효과음 ---------- */
// 합성음 (설계서 §7, 부정 효과음 없음). 부모 설정 "효과음 소리"로 고른다(기본 글로켄).
// - 음 하나 = 사인파 부분음 여러 개의 합. [주파수 비, 세기].
//   피아노·오르골은 정수배(맑은 음), 글로켄은 정수배가 아니어서(1 : 2.76 : 5.4 : 8.93) 종소리가 난다.
// - attack 만에 올라간 뒤 지수로 줄어들고, 높은 부분음일수록 빨리 사라진다.
// - boost: 소리마다 크기를 비슷하게 맞추는 값(측정으로 정함). 최대값은 리미터 + SFX_TRIM이 1 아래로 막는다.
export const SFX_STYLES = {
  glocken:   { partials: [[1, 1], [2.76, 0.35], [5.4, 0.12], [8.93, 0.05]], tau: 0.6,  attack: 0.002, boost: 2.4 },
  piano:     { partials: [[1, 1], [2, 0.45], [3, 0.22], [4, 0.12], [5, 0.06]], tau: 0.42, attack: 0.004, boost: 3.1 },
  softPiano: { partials: [[1, 1], [2, 0.3], [3, 0.1], [4, 0.04]],          tau: 0.5,  attack: 0.008, boost: 2.7 },
  musicBox:  { partials: [[1, 1], [2, 0.18], [3.01, 0.08], [4.2, 0.05]],    tau: 0.55, attack: 0.003, boost: 2.8 },
};

// freq: 기본 음(Hz), at: 시작 시각, len: 음 길이(초), amp: 세기(0~1), endFreq: 끝 음(쭉 올라가는 소리)
function bell(freq, at, len, amp = 1, endFreq = null) {
  const style = SFX_STYLES[config.sfxStyle] ?? SFX_STYLES.glocken;
  const sum = style.partials.reduce((s, [, x]) => s + x, 0);
  style.partials.forEach(([ratio, a], i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * ratio, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq * ratio, at + len * 0.5);
    const peak = (a / sum) * amp;
    const tau = (style.tau * len) / (1 + i * 0.9); // 높은 부분음일수록 빨리 줄어든다
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + style.attack);
    g.gain.setTargetAtTime(0, at + style.attack, tau);
    osc.connect(g).connect(gains.sfx);
    osc.start(at);
    osc.stop(at + len + 0.3);
  });
}

const SYNTH = {
  sfx_tap: (t) => bell(660, t, 0.35, 0.55),                                    // 톡 (자주 나므로 여리게)
  sfx_correct: (t) => { bell(784, t, 0.6); bell(1047, t + 0.16, 0.9); },        // 띵동
  sfx_pop: (t) => bell(440, t, 0.45, 1, 880),                                   // 쏙 (올라가는 소리)
  sfx_cheer: (t) => { bell(523, t, 0.6); bell(659, t + 0.15, 0.6); bell(784, t + 0.3, 1.1); }, // 짜잔
};

// name: 'tap' | 'correct' | 'pop' | 'cheer'
export async function sfx(name) {
  const key = `sfx_${name}`;
  if (!SFX[key]) return console.warn(`[audio] 없는 효과음: ${name}`);
  const c = ensureCtx();
  if (!c) return;
  await resumeCtx(c);
  if (c.state !== 'running') return; // 오디오가 막혀 있으면 효과음은 건너뛴다 (기다리다 멈추지 않게)
  const buf = await loadBuffer(key);
  if (buf) return playBuffer(buf, gains.sfx);
  SYNTH[key](c.currentTime + 0.01);
}
