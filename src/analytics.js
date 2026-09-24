// 計測：GA4（山道具ラボと同じプロパティ）＋ Amplitude（このサイト専用プロジェクト）
//
// いちばん大事なのは「外部リンクがどこから押されたか」。
// 外に出るリンクには必ず data-placement を付け、1つのクリックを3か所に残す:
//   ① GA4    … イベント名そのものに場所を入れる（ym_click_<場所>）。イベント名は標準の項目なので、
//               カスタムディメンションの登録なしで当日から読める（山道具ラボの click_tracking.js と同じ考え方）
//   ② Amplitude … 'Outbound Click' に placement ほかをプロパティで付ける
//   ③ リンク先のURL … App Store は ct=seriessite_<場所>、自サイトへは ?from=seriessite_<場所>。
//               計測がブロックされても、長押しで開かれても、ここは必ずリンク先に届く（App Store Connect で見える）
import * as amplitude from '@amplitude/analytics-browser';

const GA_ID = 'G-2Z80ZT15T1';
const AMPLITUDE_KEY = '8e96c1aaac7b129689dabe493b50a660'; // Amplitude プロジェクト「山の名人 Web」（org 446307）のクライアントキー。ページに埋め込む公開用の値

const params = new URLSearchParams(location.search);
const isTest = params.has('test'); // ?test を付けたアクセスは「テスト」として区別する

// ---- どこから来たか（セッションの最初の値を持ち回る） ----
function entrySource() {
  const KEY = 'ym_entry';
  try { const saved = sessionStorage.getItem(KEY); if (saved) return JSON.parse(saved); } catch {}
  let ref = '';
  try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch {}
  if (ref === location.hostname) ref = ''; // 再読み込み・サイト内移動は流入元にしない
  const src = {
    entry_from: params.get('from') || params.get('utm_source') || (ref || '(direct)'),
    entry_campaign: params.get('utm_campaign') || '',
    entry_referrer: ref || '(none)',
  };
  try { sessionStorage.setItem(KEY, JSON.stringify(src)); } catch {}
  return src;
}
const entry = entrySource();

// ---- GA4 ----
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
{
  const s = document.createElement('script');
  s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
  gtag('js', new Date());
  gtag('config', GA_ID, {
    ...(isTest ? { traffic_type: 'internal', debug_mode: true } : {}),
    site_name: 'yama-meijin',
    // 広告目的の追跡はしない（ページ下部の説明と一致させる）。プロパティ側で Google シグナルが有効でも、このサイトからは送らない
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
}

// ---- Amplitude ----
let ampReady = false;
if (AMPLITUDE_KEY) {
  amplitude.init(AMPLITUDE_KEY, {
    transport: 'beacon', // 別タブで開く・ページを閉じる直前でも送り切る
    autocapture: { pageViews: true, sessions: true, attribution: true, formInteractions: false, fileDownloads: false, elementInteractions: false },
  });
  const id = new amplitude.Identify().setOnce('initial_from', entry.entry_from).set('last_from', entry.entry_from).set('is_test', isTest);
  amplitude.identify(id);
  ampReady = true;
}

// ---- 共通の送信 ----
let state = { section: 'top', quiz_done: 0, quiz_score: 0 };
export function setState(patch) { Object.assign(state, patch); }

function send(gaName, ampName, props) {
  const p = { ...entry, ...state, ...props, is_test: isTest };
  gtag('event', gaName, { ...p, transport_type: 'beacon' });
  if (ampReady) amplitude.track(ampName, p);
}

// セクションに初めて入った（どこまで登ったか）
const seen = new Set();
export function trackSection(id) {
  state.section = id;
  if (seen.has(id)) return;
  seen.add(id);
  send(`ym_reach_${id}`, 'Section Reached', { section: id, order: seen.size });
}
export function trackQuiz(app, correct) { send(`ym_quiz_${app}_${correct ? 'right' : 'wrong'}`, 'Quiz Answered', { app, correct }); }
export function trackSound(on) { send(on ? 'ym_video_sound_on' : 'ym_video_sound_off', 'Video Sound', { on }); }

// ---- 外に出るリンク ----
// リンク先URL（ct= / from=）は index.html に直接書いてある＝JS が動かなくても場所が残る。
// ここでは「書き忘れ・食い違い」を開発中に見つけるための点検だけをする。
export function checkLinks() {
  document.querySelectorAll('a[href]').forEach(a => {
    if (a.hostname === location.hostname || a.id === 'share') return;
    const pl = a.dataset.placement;
    if (!pl) console.warn('[計測] data-placement が無い外部リンク:', a.href);
    else if (/apps\.apple\.com/.test(a.href) && !a.href.includes(`ct=seriessite_${pl}`)) console.warn('[計測] ct と placement が食い違う:', pl, a.href);
  });
}

function onLinkActivate(e) {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || a.hostname === location.hostname) return;
  if (e.type === 'auxclick' && e.button !== 1) return; // 中クリック（新しいタブで開く）だけ拾う
  const placement = a.dataset.placement || `unlabeled_${state.section}`; // 付け忘れても消えない
  send(`ym_click_${placement}`, 'Outbound Click', {
    placement,
    app: a.dataset.app || '',
    link_url: a.href,
    link_domain: a.hostname,
    link_text: (a.textContent || '').trim().slice(0, 40),
    open_method: e.type === 'auxclick' ? 'middle_click' : (e.metaKey || e.ctrlKey ? 'new_tab_key' : 'click'),
  });
}
// 捕捉フェーズで拾う＝ページ側の処理より先に必ず通る
document.addEventListener('click', onLinkActivate, true);
document.addEventListener('auxclick', onLinkActivate, true);
