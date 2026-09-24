import './style.css';
import { createScene } from './scene.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- 紙目（ページ全体とカードに重ねる） ----
{
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); const img = g.createImageData(256, 256);
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < img.data.length; i += 4) { const v = 225 + r() * 30; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  const url = `url(${c.toDataURL()})`;
  document.documentElement.style.setProperty('--grain-url', url);
  document.querySelector('.grain').style.backgroundImage = url;
}

// ---- App Store へのリンク（ct= で「どこから押されたか」を App Store Connect で見分ける） ----
const IDS = { hana: '6789052002', tori: '6795488069', kumo: '6793737365' };
document.querySelectorAll('a.store').forEach(a => {
  const where = a.closest('section')?.id || 'top';
  a.href = `https://apps.apple.com/app/apple-store/id${IDS[a.dataset.app]}?pt=1080680&ct=seriessite_${where}&mt=8`;
  a.target = '_blank'; a.rel = 'noopener';
});

// ---- 3D ----
let scene = null;
try { scene = createScene(document.getElementById('scene'), { reduced }); }
catch (e) { document.body.classList.add('no-webgl'); console.warn('WebGL unavailable', e); }

// ---- スクロール → カメラ位置・標高 ----
const secs = [...document.querySelectorAll('section[data-cam]')];
const altEl = document.getElementById('altNum');
const altRoot = document.documentElement;
const jump = document.querySelector('.jump');
function onScroll() {
  const y = scrollY, vh = innerHeight;
  const spans = secs.map(s => { const top = s.offsetTop, bot = top + s.offsetHeight; const a = top - vh * .35; return [a, Math.max(a, bot - vh * .9)]; });
  let f = 0;
  for (let i = 0; i < spans.length; i++) {
    const [a, b] = spans[i];
    if (y < a) { f = i === 0 ? 0 : i - 1 + (y - spans[i - 1][1]) / (a - spans[i - 1][1]); break; }
    if (y <= b) { f = i; break; }
    f = i;
  }
  f = Math.max(0, Math.min(secs.length - 1, f));
  scene?.setProgress(f);
  const i = Math.min(secs.length - 2, Math.floor(f)), t = f - i;
  const alt = +secs[i].dataset.alt + (+secs[i + 1].dataset.alt - +secs[i].dataset.alt) * t;
  altEl.textContent = Math.round(alt / 10) * 10 >= 1000 ? (Math.round(alt / 10) * 10).toLocaleString('ja-JP') : Math.round(alt / 10) * 10;
  jump.classList.toggle('hide', f > secs.length - 1.6);
  altRoot.style.setProperty('--climb', ((alt - 800) / (3190 - 800)).toFixed(4));
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);
onScroll();

if (matchMedia('(pointer: fine)').matches) {
  addEventListener('pointermove', e => scene?.setPointer(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1), { passive: true });
}

// ---- カードの出現（ストップモーション） ----
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .18 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// ---- 動画：見えている間だけ再生。音は押したときだけ ----
const video = document.getElementById('promo');
const soundBtn = document.getElementById('soundBtn');
new IntersectionObserver(([e]) => {
  if (e.isIntersecting) { video.preload = 'auto'; video.play().catch(() => {}); }
  else video.pause();
}, { threshold: .4 }).observe(video);
soundBtn.addEventListener('click', () => {
  const on = video.muted;
  video.muted = !on;
  if (on) { video.currentTime = 0; video.play().catch(() => {}); }
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.textContent = on ? '♪ 音を消す' : '♪ 音を出す';
});

// ---- クイズ ----
const KEY = 'yama-meijin-quiz';
let answers = {};
try { answers = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { answers = {}; }
const quizzes = [...document.querySelectorAll('.quiz')];

function showAnswer(q, picked) {
  const correct = +q.dataset.answer;
  const btns = [...q.querySelectorAll('.quiz__opts button')];
  btns.forEach((b, i) => { b.disabled = true; if (i === correct) b.classList.add('is-right'); else if (i === picked) b.classList.add('is-wrong'); });
  const ans = q.querySelector('.quiz__ans'); ans.hidden = false;
  const v = q.querySelector('.quiz__verdict');
  if (picked === correct) { v.textContent = '正解！'; v.className = 'quiz__verdict ok'; }
  else { v.textContent = `おしい！「${btns[picked].textContent}」ではありません`; v.className = 'quiz__verdict ng'; }
}
quizzes.forEach(q => {
  const id = q.dataset.quiz;
  q.querySelectorAll('.quiz__opts button').forEach((b, i) => b.addEventListener('click', () => {
    answers[id] = i === +q.dataset.answer;
    answers[id + '_pick'] = i;
    try { localStorage.setItem(KEY, JSON.stringify(answers)); } catch {}
    showAnswer(q, i); updateResult();
  }));
  if (id + '_pick' in answers) showAnswer(q, answers[id + '_pick']);
});

function updateResult() {
  const done = quizzes.filter(q => q.dataset.quiz in answers).length;
  const score = quizzes.filter(q => answers[q.dataset.quiz] === true).length;
  document.getElementById('score').textContent = score;
  const rank = document.getElementById('rank');
  if (done < 3) rank.textContent = done === 0 ? '途中の3問、まだ間に合います。' : `あと${3 - done}問。少し戻って挑戦できます。`;
  else rank.textContent = ['見習い。伸びしろしかありません。', '見習い。ここからが面白いところ。', '初段の腕前。あと一歩で名人。', '全問正解。名人の素質あり！'][score];
  const share = document.getElementById('share');
  const text = done < 3 ? '山の名人シリーズ｜花・鳥・雲の名前がわかる図鑑クイズ' : `山の名人クイズ、${score}/3問正解でした。花・鳥・雲、あなたはいくつわかる？`;
  share.href = `https://www.threads.net/intent/post?text=${encodeURIComponent(text + '\n' + location.href.split('#')[0])}`;
}
updateResult();
