// 鳥仕 FC · Match Centre
(function () {
  'use strict';

  const DRAFT_KEY = 'niaoshi-draft-v2';
  const DRAFT_V1 = 'niaoshi-draft-v1';
  const PREVIEW_KEY = 'niaoshi-preview';
  const EDITOR_KEY = 'niaoshi-editor';
  const CLOCK_KEY = 'niaoshi-clock';
  const CAUSES = ['定位球', '被反擊', '中路突破', '邊路傳中', '身後球', '遠射', '盯人漏人', '第二落點', '個人失誤', '門將失誤', '體能下降', '人數劣勢'];
  const CAUSE_ALIAS = { '反擊被打穿': '被反擊', '中路被推進': '中路突破', '盯人失位': '盯人漏人', '二點球沒搶到': '第二落點', '體能下滑': '體能下降', '換人或人數劣勢': '人數劣勢' };
  const causeName = c => CAUSE_ALIAS[c] || c;
  const WINDOWS = ["1'–10'", "11'–20'", "21'–30'", "31'–40'"];

  const app = document.getElementById('app');
  const D = { team: null, published: [], boards: [], ds: { base: {}, matches: {} }, draft: null, work: null };

  // ---------- 工具 ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch {} },
    sget(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    sset(k, v) { try { sessionStorage.setItem(k, v); } catch {} }
  };
  let EDITOR = (() => {
    try { if (/[?&]edit=1/.test(location.search)) localStorage.setItem(EDITOR_KEY, '1'); } catch {}
    return store.get(EDITOR_KEY) === '1';
  })();
  const clone = o => JSON.parse(JSON.stringify(o));
  const player = no => D.team.players.find(p => String(p.no) === String(no));
  const pname = no => { const p = player(no); return p ? p.name : (no != null && no !== '' ? '#' + no : '—'); };
  const pLabel = no => { const p = player(no); return p ? `${p.name} ${p.no}` : (no != null && no !== '' ? `#${no}` : '—'); };
  const short = n => String(n || '').replace(/(足球)?俱樂部$/, '');
  const fmtDate = (d, t) => { const [, m, dd] = d.split('-'); const wd = '日一二三四五六'[new Date(d + 'T00:00:00').getDay()]; return `${+m}/${+dd}（${wd}）${t || ''}`; };
  const halfLen = m => m.halfLength || D.team.halfLength || 20;
  const winIdx = min => min <= 10 ? 0 : min <= 20 ? 1 : min <= 30 ? 2 : 3;
  const sortEvents = evs => (evs || []).map((e, i) => [e, i]).sort((a, b) => (a[0].min - b[0].min) || (a[1] - b[1])).map(x => x[0]);
  const hScore = (m, us, them) => m.home ? `${us}–${them}` : `${them}–${us}`;
  const ytLink = (m, v) => {
    if (!v || !m.videos) return null;
    const vid = m.videos.find(x => x.half === v.half);
    if (!vid) return null;
    const [mm, ss] = String(v.t).split(':').map(Number);
    const sec = (mm || 0) * 60 + (ss || 0);
    return vid.url + (vid.url.includes('?') ? '&' : '?') + 't=' + sec;
  };
  const hm = () => new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

  function matches() {
    const preview = EDITOR && store.sget(PREVIEW_KEY) === '1' && store.get(DRAFT_KEY) && D.draft;
    return preview ? D.draft : D.published;
  }

  // ---------- 統計 ----------
  function scoreOf(m) {
    if (m.events && m.events.some(e => e.type === 'goal')) {
      const us = m.events.filter(e => e.type === 'goal' && e.side === 'us').length;
      const them = m.events.filter(e => e.type === 'goal' && e.side === 'them').length;
      return { us, them };
    }
    return m.score || { us: 0, them: 0 };
  }
  const resultOf = s => s.us > s.them ? 'W' : s.us < s.them ? 'L' : 'D';

  function onPitch(m) {
    if (!m.lineup || !m.lineup.starters || !m.lineup.starters.length) return null;
    if (m.lineup.subsKnown === false) return null;
    const len = halfLen(m) * 2;
    const on = new Map();
    const mins = {}, gf = {}, ga = {}, apps = new Set();
    m.lineup.starters.forEach(n => { on.set(String(n), 0); apps.add(String(n)); });
    const leave = (n, t) => { n = String(n); if (!on.has(n)) return; mins[n] = (mins[n] || 0) + Math.max(0, t - on.get(n)); on.delete(n); };
    const perEvent = new Map();
    sortEvents(m.events).forEach(e => {
      if (e.type === 'sub') {
        leave(e.off, e.min);
        if (e.on != null && e.on !== '') { on.set(String(e.on), e.min); apps.add(String(e.on)); }
      } else if (e.type === 'card' && e.color === 'red' && e.side === 'us') {
        leave(e.no, e.min);
      } else if (e.type === 'goal') {
        const list = [...on.keys()];
        perEvent.set(e, list);
        list.forEach(n => { if (e.side === 'us') gf[n] = (gf[n] || 0) + 1; else ga[n] = (ga[n] || 0) + 1; });
      }
    });
    [...on.keys()].forEach(n => leave(n, len));
    return { mins, gf, ga, apps, perEvent };
  }

  function seasonStats(list) {
    const played = list.filter(m => m.status === 'played');
    const s = { played, w: 0, d: 0, l: 0, gf: 0, ga: 0, win: [[0, 0, 0, 0], [0, 0, 0, 0]], halves: { us: [0, 0], them: [0, 0] }, scorers: {}, assists: {}, causes: {}, causesTentative: {}, tagged: 0, concededState: { lead: 0, draw: 0, trail: 0 }, players: {}, starts: {}, lineupMatches: 0, ps: {}, psMatches: 0 };
    played.forEach(m => {
      const sc = scoreOf(m);
      s.gf += sc.us; s.ga += sc.them;
      s[resultOf(sc).toLowerCase()]++;
      let us = 0, them = 0;
      sortEvents(m.events).forEach(e => {
        if (e.type !== 'goal') return;
        s.win[e.side === 'us' ? 0 : 1][winIdx(e.min)]++;
        s.halves[e.side === 'us' ? 'us' : 'them'][e.min <= halfLen(m) ? 0 : 1]++;
        if (e.side === 'us') {
          if (e.no != null) s.scorers[e.no] = (s.scorers[e.no] || 0) + 1;
          if (e.assist != null && e.assist !== '') s.assists[e.assist] = (s.assists[e.assist] || 0) + 1;
          us++;
        } else {
          s.concededState[us > them ? 'lead' : us === them ? 'draw' : 'trail']++;
          const cs = [...new Set((e.cause || []).map(causeName))];
          if (cs.length) s.tagged++;
          cs.forEach(c => { const bag = e.tentative ? s.causesTentative : s.causes; bag[c] = (bag[c] || 0) + 1; });
          them++;
        }
      });
      if (m.lineup && m.lineup.starters) m.lineup.starters.forEach(n => { s.starts[n] = (s.starts[n] || 0) + 1; });
      if (m.playerStats && Object.keys(m.playerStats).length) {
        s.psMatches++;
        Object.entries(m.playerStats).forEach(([n, v]) => {
          const t = s.ps[n] = s.ps[n] || { ok: 0, bad: 0, int: 0, games: 0 };
          t.ok += v.ok || 0; t.bad += v.bad || 0; t.int += v.int || 0; t.games++;
        });
      }
      const op = onPitch(m);
      if (op) {
        s.lineupMatches++;
        op.apps.forEach(n => {
          const p = s.players[n] = s.players[n] || { apps: 0, mins: 0, gf: 0, ga: 0 };
          p.apps++; p.mins += op.mins[n] || 0; p.gf += op.gf[n] || 0; p.ga += op.ga[n] || 0;
        });
      }
    });
    return s;
  }

  // 同一人多球合併：楊傑儒 12' 13' 15'
  function groupScorers(evs, side) {
    const map = new Map();
    evs.filter(e => e.type === 'goal' && e.side === side).forEach(e => {
      const key = side === 'us' ? 'n' + e.no : 'p' + (e.player || '對手');
      if (!map.has(key)) map.set(key, { name: side === 'us' ? pname(e.no) : (e.player || '對手'), mins: [] });
      map.get(key).mins.push(e.min);
    });
    return [...map.values()];
  }

  // ---------- 小元件 ----------
  const ICON = {
    goal: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.6l2.6 1.9-1 3H6.4l-1-3z" fill="currentColor"/></svg>',
    sub: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 6h8l-2.5-2.5M12 10H4l2.5 2.5"/></svg>',
    card: c => `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="2.5" width="7" height="11" rx="1.2" fill="${c === 'red' ? '#e5483b' : '#f5c518'}"/></svg>`,
    play: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5z" fill="currentColor"/></svg>',
    ext: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
  };
  const head = (kicker, title, aside = '') => `<div class="head"><div><span class="kicker">${kicker}</span><h2>${title}</h2></div>${aside ? `<div class="aside">${aside}</div>` : ''}</div>`;
  const resBadge = r => `<i class="${r}">${r === 'W' ? '勝' : r === 'L' ? '負' : '和'}</i>`;
  const daysTo = d => Math.ceil((new Date(d + 'T00:00:00+08:00') - Date.now()) / 86400000);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function countUp(root) {
    if (reduced()) return;
    root.querySelectorAll('[data-count]').forEach(el => {
      const end = +el.dataset.count, t0 = performance.now() + 200, dur = 700;
      if (end < 3) return;
      const step = t => {
        const p = Math.max(0, Math.min(1, (t - t0) / dur));
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      el.textContent = '0';
      requestAnimationFrame(step);
    });
  }

  let firstPaint = true;
  function view(html, title) {
    app.innerHTML = `<div class="view${firstPaint ? '' : ' quick'}">${html}</div>`;
    const v = app.firstElementChild;
    if (firstPaint) {
      [...v.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 5)));
      countUp(v);
      firstPaint = false;
    }
    document.title = title ? `${title} · 鳥仕 FC` : '鳥仕 FC';
    bindCommon();
    return v;
  }

  // ---------- 圖表 ----------
  function windowChart(s) {
    const max = Math.max(1, ...s.win[0], ...s.win[1]);
    const W = 520, H = 200, padX = 6, padB = 28, padT = 26, gw = (W - padX * 2) / 4, bw = 30;
    const y = v => H - padB - (v / max) * (H - padB - padT);
    let bars = '', d = 0;
    for (let i = 0; i < 4; i++) {
      const cx = padX + gw * i + gw / 2;
      [0, 1].forEach(side => {
        const v = s.win[side][i];
        const x = cx + (side === 0 ? -bw - 3 : 3);
        const top = y(v);
        bars += `<g class="bar-g"><title>${WINDOWS[i]} ${side === 0 ? '進球' : '失球'} ${v}</title>
          <rect x="${x - 2}" y="${padT}" width="${bw + 4}" height="${H - padB - padT}" class="hit"/>
          ${v > 0 ? `<path d="M${x},${H - padB} V${top + 5} q0,-5 5,-5 h${bw - 10} q5,0 5,5 V${H - padB} z" class="bar s${side} grow-y" style="--d:${d++}"/>` : ''}
          <text x="${x + bw / 2}" y="${top - 7}" class="v fade-in" style="--d:${d}">${v}</text></g>`;
      });
      bars += `<text x="${cx}" y="${H - padB + 18}" class="ax">${WINDOWS[i]}</text>`;
    }
    const mid = W / 2;
    return `<figure class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="進失球時段">
        <rect x="${mid}" y="${padT - 18}" width="${W / 2 - padX + 2}" height="${H - padB - padT + 18}" rx="8" class="half-bg"/>
        <text x="${padX + 4}" y="${padT - 6}" class="ax start">上半場</text>
        <text x="${mid + 8}" y="${padT - 6}" class="ax start">下半場</text>
        <line x1="${padX}" x2="${W - padX}" y1="${H - padB}" y2="${H - padB}" class="base"/>
        ${bars}
      </svg>
    </figure>`;
  }

  function hbar(rows, empty = '—', total) {
    if (!rows.length) return `<p class="empty">${empty}</p>`;
    const max = total || Math.max(...rows.map(r => r.v + (r.t || 0)), 1);
    return `<div class="hbars">${rows.map((r, i) => `
      <div class="hb-row">
        <span class="hb-k">${esc(r.k)}</span>
        <span class="hb-track">${r.v ? `<span class="hb-fill grow-x" style="width:${(r.v / max) * 100}%;--d:${i}"></span>` : ''}${r.t ? `<span class="hb-fill tentative grow-x" style="width:${(r.t / max) * 100}%;--d:${i}"></span>` : ''}</span>
        <span class="hb-v">${r.v + (r.t || 0)}</span>
      </div>`).join('')}</div>`;
  }

  // ---------- 共用 ----------
  function nav(key) {
    document.body.classList.toggle('editor', EDITOR);
    document.querySelectorAll('.nav a').forEach(a => {
      const on = a.dataset.nav === key;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function draftBanner() {
    if (!EDITOR || !store.get(DRAFT_KEY) || !D.draft) return '';
    const preview = store.sget(PREVIEW_KEY) === '1';
    const n = Object.keys(D.ds.matches).length;
    return `<div class="banner"><span>${preview ? '草稿預覽中' : `本機草稿 · ${n} 場`}</span>
      <span class="banner-act"><button class="btn small ghost" data-act="toggle-preview">${preview ? '正式版' : '預覽'}</button><a class="btn small ghost" href="#/log">記錄</a></span></div>`;
  }

  function bindCommon() {
    app.querySelectorAll('[data-act=toggle-preview]').forEach(b => b.onclick = () => {
      store.sset(PREVIEW_KEY, store.sget(PREVIEW_KEY) === '1' ? '0' : '1'); route();
    });
  }

  function fixtures(list) {
    const nx = matches().find(m => m.status !== 'played');
    return `<ul class="fx">${list.map(m => {
      const played = m.status === 'played';
      const sc = played ? scoreOf(m) : null;
      const isNext = nx && m.id === nx.id;
      const dn = isNext ? daysTo(m.date) : null;
      return `<li><a href="#/m/${m.id}" class="${isNext ? 'nx' : ''}">
        <span class="rd">R${m.round}</span>
        <span class="op">${esc(short(m.opponent))}<small>${m.home ? '主場' : '客場'} · ${fmtDate(m.date, m.time)}</small></span>
        ${played ? `<span class="res"><span class="num">${sc.us}–${sc.them}</span>${resBadge(resultOf(sc))}</span>`
          : isNext ? `<span class="pill gold num">${dn > 0 ? dn + ' 天' : dn === 0 ? '今天' : ''}</span>` : '<span></span>'}
      </a></li>`;
    }).join('')}</ul>`;
  }

  function standingRow(r, i, cls = '') {
    return `<tr class="${cls}"><td class="num rk">${i + 1}</td><td>${esc(short(r.team))}</td><td class="n">${r.p}</td><td class="n">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="n"><b>${r.pts}</b></td></tr>`;
  }
  const standingHead = '<thead><tr><th>#</th><th>球隊</th><th class="n">場</th><th class="n">淨勝球</th><th class="n">積分</th></tr></thead>';

  // ---------- 總覽 ----------
  function pageHome() {
    nav('home');
    const list = matches();
    const s = seasonStats(list);
    const next = list.find(m => m.status !== 'played');
    const last = s.played[s.played.length - 1];
    const st = D.team.standings;
    const rank = st.rows.findIndex(r => r.team === D.team.name) + 1;
    const pts = s.w * 3 + s.d, gd = s.gf - s.ga;
    const scorers = Object.entries(s.scorers).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const causes = Object.keys({ ...s.causes, ...s.causesTentative }).map(k => ({ k, v: s.causes[k] || 0, t: s.causesTentative[k] || 0 })).sort((a, b) => (b.v + b.t) - (a.v + a.t));
    const cs = s.concededState;
    const sh = s.halves.them[1], l10 = s.win[1][3];
    const form = s.played.map(m => { const sc = scoreOf(m), r = resultOf(sc); return `<a class="${r}" href="#/m/${m.id}" aria-label="R${m.round} ${esc(short(m.opponent))} ${sc.us}–${sc.them}">${r === 'W' ? '勝' : r === 'L' ? '負' : '和'}</a>`; }).join('');

    let latest = '';
    if (last) {
      const sc = scoreOf(last), r = resultOf(sc);
      const g = groupScorers(sortEvents(last.events), 'us').map(x => esc(x.name) + (x.mins.length > 1 ? ` ×${x.mins.length}` : '')).join('、');
      latest = `<a class="card next last ${r}" href="#/m/${last.id}">
        <div><span class="kicker">Latest · 第 ${last.round} 輪</span>
          <h3>${last.home ? '主場' : '客場'} <span class="num">${sc.us}–${sc.them}</span> ${esc(short(last.opponent))}</h3>
          <div class="when">${g || fmtDate(last.date, last.time)}</div></div>
        <span class="res">${resBadge(r)}</span>
      </a>`;
    }
    let nextCard = '';
    if (next) {
      const dn = daysTo(next.date);
      const oi = st.rows.findIndex(r => r.team === next.opponent);
      const or = st.rows[oi];
      nextCard = `<a class="card next" href="#/m/${next.id}">
        <div><span class="kicker">Next · 第 ${next.round} 輪</span>
          <h3>${next.home ? '主場' : '客場'} vs ${esc(short(next.opponent))}</h3>
          <div class="when">${fmtDate(next.date, next.time)}</div>
          ${or ? `<div class="opp num">#${oi + 1} · ${or.pts} 分</div>` : ''}</div>
        <div class="countdown"><b>${dn > 0 ? dn : dn === 0 ? '今天' : '—'}</b><span>${dn > 0 ? '天' : ''}</span></div>
      </a>`;
    }

    view(`${draftBanner()}
      <section class="hero">
        <img class="logo" src="assets/logo-180.png" width="96" height="96" alt="鳥仕 FC" decoding="async" fetchpriority="high">
        <div>
          <span class="kicker">${esc(D.team.season)} 賽季</span>
          <h1>${esc(D.team.name)}</h1>
          <div class="sub"><span>${esc(D.team.league)}</span></div>
          ${form ? `<div class="form">${form}</div>` : ''}
        </div>
        <div class="stats">
          <div class="stat"><b class="gold">#${rank || '–'}</b><span>排名</span></div>
          <div class="stat"><b data-count="${pts}">${pts}</b><span>積分</span></div>
          <div class="stat"><b>${s.w}–${s.d}–${s.l}</b><span>勝–和–負</span></div>
          <div class="stat"><b data-count="${s.gf}">${s.gf}</b><span>進球</span></div>
          <div class="stat"><b data-count="${s.ga}">${s.ga}</b><span>失球</span></div>
          <div class="stat"><b>${gd > 0 ? '+' : ''}${gd}</b><span>淨勝球</span></div>
        </div>
      </section>

      ${latest || nextCard ? `<div class="grid">${latest ? `<div class="${nextCard ? 'c6' : 'c12'} cell">${latest}</div>` : ''}${nextCard ? `<div class="${latest ? 'c6' : 'c12'} cell">${nextCard}</div>` : ''}</div>` : ''}

      ${s.played.length ? `<div class="grid">
        <section class="card c8">
          ${head('Goal timing', '進失球時段', `<span class="legend"><span><i class="sw s0"></i>進球</span><span><i class="sw s1"></i>失球</span></span>`)}
          ${windowChart(s)}
        </section>
        <section class="card c4 conc">
          ${head('Conceded', '失球分布')}
          <div class="tiles">
            <div class="tile"><div class="v num">${sh}<small>/${s.ga}</small></div><div class="k">下半場</div><div class="meter"><i class="grow-x" style="width:${s.ga ? sh / s.ga * 100 : 0}%"></i></div></div>
            <div class="tile"><div class="v num">${l10}<small>/${s.ga}</small></div><div class="k">31'–40'</div><div class="meter"><i class="grow-x" style="width:${s.ga ? l10 / s.ga * 100 : 0}%;--d:1"></i></div></div>
          </div>
          <div class="sublabel">失球時比分</div>
          ${hbar([{ k: '領先', v: cs.lead }, { k: '和局', v: cs.draw }, { k: '落後', v: cs.trail }], '—', s.ga)}
        </section>
      </div>` : ''}

      ${s.tagged ? `<section class="card">
        ${head('Causes', '失球原因', `已標記 ${s.tagged}/${s.ga}${Object.keys(s.causesTentative).length ? ' <span class="legend"><span><i class="sw tent"></i>初判</span></span>' : ''}`)}
        ${hbar(causes, '—', s.ga)}
      </section>` : ''}

      <div class="grid">
        <section class="card c8">
          ${head('Standings', '積分榜', `第 ${st.afterRound} 輪 · <a href="${D.team.links.standings}" target="_blank" rel="noopener">官網</a>`)}
          <table class="t">${standingHead}<tbody>
            ${st.rows.map((r, i) => standingRow(r, i, r.team === D.team.name ? 'me' : '')).join('')}
          </tbody></table>
        </section>
        <section class="card c4">
          ${head('Top scorers', '射手榜')}
          ${scorers.length ? `<ol class="rank">${scorers.map(([n, v]) => `<li><span class="pos">${scorers.findIndex(x => x[1] === v) + 1}</span><span class="shirt">${esc(n)}</span><span class="nm">${esc(pname(n))}</span><span class="g">${v}</span></li>`).join('')}</ol>` : '<p class="empty">—</p>'}
        </section>
      </div>

      <section class="card">
        ${head('Fixtures', '賽程', `<a href="#/matches">全部 →</a>`)}
        ${fixtures(s.played.slice(-2).concat(next ? [next] : []))}
      </section>`);
  }

  function pageMatches() {
    nav('matches');
    const list = matches();
    const played = list.filter(m => m.status === 'played'), up = list.filter(m => m.status !== 'played');
    view(`${draftBanner()}
      ${played.length ? `<section class="card">${head('Results', '賽果', `${played.length} 場`)}${fixtures(played)}</section>` : ''}
      ${up.length ? `<section class="card">${head('Fixtures', '賽程', `${up.length} 場`)}${fixtures(up)}</section>` : ''}`, '賽程');
  }

  // ---------- 單場 ----------
  function pageMatch(id, tab) {
    nav('matches');
    const m = matches().find(x => x.id === id);
    if (!m) { view('<a href="#/matches" class="back">← 賽程</a><p class="empty">找不到比賽</p>', '賽程'); return; }
    const played = m.status === 'played';
    const sc = scoreOf(m);
    const evs = sortEvents(m.events);
    const conceded = played ? evs.filter(e => e.type === 'goal' && e.side === 'them') : [];
    const rv = m.review || {};
    const hasReview = ['observations', 'good', 'improve', 'plan'].some(k => rv[k] && rv[k].length);
    const ps = !!(m.playerStats && Object.keys(m.playerStats).length);
    const hasData = ps || !!onPitch(m);
    const hasLineup = !!(m.lineup && m.lineup.starters && m.lineup.starters.length);
    const tabs = [['sum', '概要']];
    if (conceded.length) tabs.push(['goals', `失球<span class="cnt" aria-label="${conceded.length} 球">${conceded.length}</span>`]);
    if (hasLineup || hasData) tabs.push(['data', hasData ? '陣容與數據' : '先發']);
    if (hasReview) tabs.push(['review', '檢討']);
    if (!tabs.some(t => t[0] === tab)) tab = 'sum';

    const scorerList = side => groupScorers(evs, side).map(x => `${esc(x.name)}<span class="num">${x.mins.map(n => n + "'").join(' ')}</span>`).join('<br>');
    const usBadge = `<span class="badge"><img src="assets/logo-180.png" alt="" width="48" height="48"></span>`;
    const opBadge = `<span class="badge">${esc(short(m.opponent).slice(0, 1))}</span>`;
    const L = m.home ? { n: '鳥仕', b: usBadge, s: 'us' } : { n: short(m.opponent), b: opBadge, s: 'them', t: m.opponent };
    const R = m.home ? { n: short(m.opponent), b: opBadge, s: 'them', t: m.opponent } : { n: '鳥仕', b: usBadge, s: 'us' };
    const lsc = m.home ? sc.us : sc.them, rsc = m.home ? sc.them : sc.us;
    const title = played ? `R${m.round} ${L.n} ${lsc}–${rsc} ${R.n}` : `R${m.round} 鳥仕 vs ${short(m.opponent)}`;

    const v = view(`${draftBanner()}
      <a href="#/matches" class="back">← 賽程</a>
      <section class="scoreboard">
        <div class="meta"><span>D LEAGUE L3</span><span>第 ${m.round} 輪</span><span>${m.home ? '主場' : '客場'}</span><span>${fmtDate(m.date, m.time)}</span></div>
        <div class="sb">
          <div class="team">${L.b}<b${L.t ? ` title="${esc(L.t)}"` : ''}>${esc(L.n)}</b></div>
          <div>${played ? `<div class="score num"><b class="${lsc < rsc ? 'l' : ''}">${lsc}</b><i>:</i><b class="${rsc < lsc ? 'l' : ''}">${rsc}</b></div>
            <div class="ft-row"><span class="ft">FULL TIME</span><span class="res">${resBadge(resultOf(sc))}</span></div>` : '<div class="score vs">VS</div>'}</div>
          <div class="team">${R.b}<b${R.t ? ` title="${esc(R.t)}"` : ''}>${esc(R.n)}</b></div>
        </div>
        ${played && evs.some(e => e.type === 'goal') ? `<div class="scorers"><div>${scorerList(L.s)}</div><div>${scorerList(R.s)}</div></div>` : ''}
        <div class="links">
          ${m.official ? `<a href="${esc(m.official)}" target="_blank" rel="noopener">官方紀錄${ICON.ext}</a>` : ''}
          ${(m.videos || []).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${ICON.play}${x.half === 1 ? '上' : '下'}半場</a>`).join('')}
          ${EDITOR ? `<a href="#/log/${m.id}">✎ 記錄</a>` : ''}
        </div>
      </section>
      ${tabs.length > 1 ? `<div class="tabs" role="tablist" aria-label="比賽內容">${tabs.map(([k, t]) => `<button type="button" role="tab" id="tab-${k}" data-tab="${k}" aria-controls="panel" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</div>` : ''}
      <div class="panel" id="panel" role="tabpanel" aria-labelledby="tab-${tab}"></div>`, title);

    const panel = v.querySelector('#panel');
    const tabsEl = v.querySelector('.tabs');
    const ctx = { evs, conceded, played, rv };
    const show = (k, fromUser) => {
      let stuck = false, top = 0;
      if (fromUser && tabsEl) {
        top = parseFloat(getComputedStyle(tabsEl).top) || 0;
        stuck = tabsEl.getBoundingClientRect().top <= top + 1;
        panel.style.minHeight = panel.offsetHeight + 'px';
      }
      v.querySelectorAll('.tabs button').forEach(b => {
        const on = b.dataset.tab === k;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on);
        b.tabIndex = on ? 0 : -1;
        if (on && fromUser) b.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      });
      panel.setAttribute('aria-labelledby', 'tab-' + k);
      panel.innerHTML = '';
      panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
      ({ sum: panelSummary, goals: panelGoals, data: panelData, review: panelReview })[k](panel, m, ctx);
      if (fromUser) {
        try { history.replaceState(null, '', `#/m/${m.id}${k === 'sum' ? '' : '/' + k}`); } catch {}
        lastPage = 'm/' + m.id;
        requestAnimationFrame(() => {
          panel.style.minHeight = '';
          if (stuck) window.scrollTo(0, tabsEl.offsetTop - top);
        });
      }
    };
    if (tabsEl) {
      tabsEl.querySelectorAll('button').forEach(b => b.onclick = () => show(b.dataset.tab, true));
      tabsEl.addEventListener('keydown', e => {
        const bs = [...tabsEl.querySelectorAll('button')];
        const i = bs.indexOf(document.activeElement);
        if (i < 0) return;
        const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: bs.length - 1 }[e.key];
        if (j == null) return;
        e.preventDefault();
        const b = bs[(j + bs.length) % bs.length];
        b.focus(); show(b.dataset.tab, true);
      });
    }
    show(tab, false);
  }

  function panelSummary(panel, m, { evs, played, rv }) {
    if (!played) { panel.innerHTML = previewCards(m); return; }
    let us = 0, them = 0, halfShown = false;
    const hl = halfLen(m);
    const fmt = () => hScore(m, us, them);
    const row = e => {
      let pre = '';
      if (!halfShown && e.min > hl) { halfShown = true; pre = `<li><span class="half">HT ${fmt()}</span></li>`; }
      if (e.type === 'goal') { if (e.side === 'us') us++; else them++; }
      const link = ytLink(m, e.video);
      const vid = link ? `<a class="vid" href="${link}" target="_blank" rel="noopener" aria-label="影片">${ICON.play}</a>` : '';
      const mine = e.side === 'us' || e.type === 'sub';
      let body;
      if (e.type === 'goal') body = `${ICON.goal}<span>${esc(e.side === 'us' ? pname(e.no) : (e.player || '對手'))}${e.assist ? `<span class="muted small"> · ${esc(pname(e.assist))}</span>` : ''}</span><span class="sc num">${fmt()}</span>`;
      else if (e.type === 'sub') body = `${ICON.sub}<span>${esc(pname(e.on))} <span class="muted small">↔ ${esc(pname(e.off))}</span></span>`;
      else if (e.type === 'card') body = `${ICON.card(e.color)}<span>${esc(e.side === 'us' ? pname(e.no) : (e.player || e.no || '對手'))}</span>`;
      else body = esc(e.note || '');
      const left = m.home ? mine : !mine;
      const cls = e.type === 'goal' ? `goal-${e.side}` : '';
      return pre + `<li class="${cls}">${left ? `<span class="ev-l">${vid}${body}</span>` : '<span></span>'}<span class="m num">${e.min}'</span>${left ? '<span></span>' : `<span class="ev-r">${body}${vid}</span>`}</li>`;
    };
    const rows = evs.map(row).join('');
    const ht = halfShown ? '' : `<li><span class="half">HT ${fmt()}</span></li>`;
    const Ln = m.home ? '鳥仕' : esc(short(m.opponent)), Rn = m.home ? esc(short(m.opponent)) : '鳥仕';
    panel.innerHTML = `
      ${rv.summary ? `<section class="card">${head('Summary', '概要')}<p class="lead">${esc(rv.summary)}</p></section>` : ''}
      <section class="card">${head('Timeline', '比賽事件', `<span class="legend"><span>${Ln}</span><span>|</span><span>${Rn}</span></span>`)}
        ${evs.length ? `<ol class="tl">${rows}${ht}<li><span class="half">FT ${fmt()}</span></li></ol>` : '<p class="empty">—</p>'}
      </section>`;
  }

  function previewCards(m) {
    const st = D.team.standings;
    const me = st.rows.findIndex(r => r.team === D.team.name);
    const op = st.rows.findIndex(r => r.team === m.opponent);
    const rows = [[me, 'me'], [op, 'op']].filter(x => x[0] >= 0).sort((a, b) => a[0] - b[0]);
    const h2h = matches().filter(x => x.status === 'played' && x.opponent === m.opponent && x.round < m.round);
    return `<div class="grid">
      ${rows.length ? `<section class="card ${h2h.length ? 'c6' : 'c12'}">${head('Opponent', '對手', `第 ${st.afterRound} 輪後`)}
        <table class="t">${standingHead}<tbody>${rows.map(([i, c]) => standingRow(st.rows[i], i, c)).join('')}</tbody></table></section>` : ''}
      ${h2h.length ? `<section class="card ${rows.length ? 'c6' : 'c12'}">${head('Head to head', '本季交手')}${fixtures(h2h)}</section>` : ''}
    </div>`;
  }

  function panelGoals(panel, m, { conceded }) {
    const op = onPitch(m);
    let us = 0, them = 0;
    const state = new Map();
    sortEvents(m.events).forEach(e => {
      if (e.type !== 'goal') return;
      if (e.side === 'us') { us++; return; }
      state.set(e, { pre: hScore(m, us, them), post: hScore(m, us, them + 1) });
      them++;
    });
    panel.innerHTML = `<div class="goals">${conceded.map((e, i) => {
      const link = ytLink(m, e.video);
      const onList = op && op.perEvent.get(e);
      const hasD = e.diagram && e.diagram.frames && e.diagram.frames.length;
      const st = state.get(e);
      const causes = [...new Set((e.cause || []).map(causeName))];
      return `<article class="goal" style="--i:${Math.min(i, 4)}">
        <header><span class="gm num">${e.min}'</span><div><b>${esc(e.player || '對手')}${e.no ? ` <span class="muted num">#${esc(e.no)}</span>` : ''}</b>
          <div class="gs"><span class="num">${st.pre}</span> <span class="muted">→</span> <span class="num post">${st.post}</span></div></div>
          ${link ? `<a class="vid" href="${link}" target="_blank" rel="noopener">${ICON.play}<span class="num">${esc(e.video.t)}</span></a>` : ''}</header>
        ${causes.length ? `<div class="tags">${causes.map(c => `<span class="pill">${esc(c)}</span>`).join('')}${e.tentative ? '<span class="pill warn">初判</span>' : ''}</div>` : ''}
        ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
        ${onList ? `<p class="on">在場 ${onList.map(n => esc(pname(n))).join('、')}</p>` : ''}
        ${hasD ? `<div data-diagram="${i}"></div>` : EDITOR ? `<a class="btn small ghost add" href="#/log/${m.id}">＋ 站位圖</a>` : ''}
      </article>`;
    }).join('')}</div>`;
    panel.querySelectorAll('[data-diagram]').forEach(box => mountViewer(box, conceded[+box.dataset.diagram].diagram));
  }

  function panelData(panel, m) {
    const op = onPitch(m);
    const psHtml = psBlock(m);
    const side = op || psHtml;
    const xi = m.lineup && m.lineup.starters && m.lineup.starters.length
      ? `<section class="card ${side ? 'c5' : 'c12'}">${head('Lineup', '先發', `${m.lineup.starters.length} 人`)}
          <ul class="xi">${[...m.lineup.starters].sort((a, b) => a - b).map(n => `<li><span class="shirt">${esc(n)}</span>${esc(pname(n))}</li>`).join('')}</ul></section>`
      : '';
    panel.innerHTML = `<div class="grid">${xi}${side ? `<div class="${xi ? 'c7' : 'c12'} stack">${op ? lineupBlock(m, op) : ''}${psHtml}</div>` : ''}</div>`;
  }

  const rvList = (arr, cls) => `<ul class="rv-list ${cls}">${arr.map(o => `<li><b>${esc(o.title)}</b><span>${esc(o.text)}</span></li>`).join('')}</ul>`;

  function panelReview(panel, m, { rv }) {
    const cards = [
      rv.good && rv.good.length ? `<section class="card c4">${head('Strengths', '優點')}${rvList(rv.good, 'good')}</section>` : '',
      rv.improve && rv.improve.length ? `<section class="card c4">${head('Weaknesses', '待改進')}${rvList(rv.improve, 'bad')}</section>` : '',
      rv.plan && rv.plan.length ? `<section class="card c4">${head('Action plan', '下場重點')}${rvList(rv.plan, 'plan')}</section>` : ''
    ].filter(Boolean);
    const span = cards.length === 1 ? 'c12' : cards.length === 2 ? 'c6' : 'c4';
    const obs = (rv.observations || []).map(o => {
      const mm = /^(上|下)半場\s*(\d+:\d{2})$/.exec(o.video || '');
      const link = mm && ytLink(m, { half: mm[1] === '上' ? 1 : 2, t: mm[2] });
      const when = link
        ? `<a class="when vid" href="${link}" target="_blank" rel="noopener">${ICON.play}<span class="num">${esc(o.min)}</span><small>${esc(o.video)}</small></a>`
        : `<span class="when"><span class="num">${esc(o.min)}</span><small>${esc(o.video)}</small></span>`;
      return `<li>${when}<span>${esc(o.text)}</span></li>`;
    }).join('');
    panel.innerHTML = `<div class="rv">
      ${cards.map(c => c.replace('card c4', 'card ' + span)).join('')}
      ${obs ? `<section class="card c12">${head('Video notes', '影片筆記')}<ul class="obs">${obs}</ul></section>` : ''}
    </div>`;
  }

  function psBlock(m) {
    const ps = m.playerStats;
    if (!ps || !Object.keys(ps).length) return '';
    const rows = Object.entries(ps).map(([n, v]) => ({ n, ok: v.ok || 0, bad: v.bad || 0, int: v.int || 0 }))
      .sort((a, b) => (b.ok + b.bad) - (a.ok + a.bad) || b.int - a.int);
    const tot = rows.reduce((t, r) => ({ ok: t.ok + r.ok, bad: t.bad + r.bad, int: t.int + r.int }), { ok: 0, bad: 0, int: 0 });
    const pct = (ok, bad) => ok + bad ? Math.round(ok / (ok + bad) * 100) + '%' : '–';
    return `<section class="card">${head('Passing', '傳球與攔截')}
      <div class="scroll"><table class="t"><thead><tr><th>球員</th><th class="n">傳球</th><th class="n">成功</th><th class="n">成功率</th><th class="n">攔截</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><span class="num shirt-s">${esc(r.n)}</span>${esc(pname(r.n))}</td><td class="n">${r.ok + r.bad}</td><td class="n">${r.ok}</td><td class="n">${pct(r.ok, r.bad)}</td><td class="n">${r.int}</td></tr>`).join('')}
      <tr class="total"><td>全隊</td><td class="n">${tot.ok + tot.bad}</td><td class="n">${tot.ok}</td><td class="n">${pct(tot.ok, tot.bad)}</td><td class="n">${tot.int}</td></tr>
      </tbody></table></div></section>`;
  }

  function lineupBlock(m, op) {
    const rows = [...op.apps].map(n => ({ n, mins: op.mins[n] || 0, gf: op.gf[n] || 0, ga: op.ga[n] || 0, starter: m.lineup.starters.map(String).includes(n) }))
      .sort((a, b) => b.mins - a.mins);
    return `<section class="card">${head('On pitch', '在場進失球')}
      <div class="scroll"><table class="t"><thead><tr><th>球員</th><th class="n">時間</th><th class="n">在場進</th><th class="n">在場失</th><th class="n">+/−</th></tr></thead><tbody>
      ${rows.map(r => { const pm = r.gf - r.ga; return `<tr><td><span class="num shirt-s">${esc(r.n)}</span>${esc(pname(r.n))}${r.starter ? '' : ' <span class="pill">替補</span>'}</td><td class="n">${r.mins}'</td><td class="n">${r.gf}</td><td class="n">${r.ga}</td><td class="n ${pm > 0 ? 'up' : pm < 0 ? 'down' : ''}">${pm > 0 ? '+' : ''}${pm}</td></tr>`; }).join('')}
      </tbody></table></div></section>`;
  }

  // 站位圖檢視：切換畫面時球員滑動
  function mountViewer(box, diagram) {
    const frames = (diagram && diagram.frames) || [];
    if (!frames.length) return;
    const kinds = new Set(frames.flatMap(f => (f.arrows || []).map(a => a.kind || 'pass')));
    box.innerHTML = `${frames.length > 1
      ? `<div class="frames" role="group">${frames.map((f, i) => `<button type="button" class="chip${i ? '' : ' on'}" aria-pressed="${!i}" data-i="${i}">${i + 1} · ${esc(f.label || '')}</button>`).join('')}</div>`
      : (frames[0].label ? `<div class="frames"><span class="chip on">${esc(frames[0].label)}</span></div>` : '')}
      <div class="pitch-wrap"></div>${legendPitch(kinds)}`;
    const { svg } = Pitch.render(box.querySelector('.pitch-wrap'), frames[0], { label: frames[0].label });
    box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
      box.querySelectorAll('[data-i]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
      Pitch.update(svg, frames[+b.dataset.i]);
    });
  }

  const legendPitch = kinds => {
    const K = { pass: '傳球', run: '跑位', dribble: '帶球', shot: '射門' };
    return `<div class="plegend"><span><i class="tk us"></i>鳥仕</span><span><i class="tk them"></i>對手</span>
      ${Object.keys(K).filter(k => kinds.has(k)).map(k => `<span><i class="ln ${k}"></i>${K[k]}</span>`).join('')}</div>`;
  };

  // ---------- 球員 ----------
  let pSort = { k: 'goals', asc: false };
  function pagePlayers() {
    nav('players');
    const s = seasonStats(matches());
    const rows = D.team.players.map(p => {
      const st = s.players[String(p.no)] || { apps: 0, mins: 0, gf: 0, ga: 0 };
      const ps = s.ps[String(p.no)];
      const passes = ps ? ps.ok + ps.bad : 0;
      return { no: p.no, name: p.name, ...st, goals: s.scorers[p.no] || 0, starts: s.starts[p.no] || 0, ast: s.assists[p.no] || 0, passes, acc: passes ? ps.ok / passes : -1, int: ps ? ps.int : 0, pm: st.gf - st.ga };
    });
    const cols = [['no', '#'], ['name', '球員'], ['goals', '進球'], ['starts', '先發']];
    if (Object.keys(s.assists).length) cols.push(['ast', '助攻']);
    if (s.psMatches) cols.push(['passes', '傳球'], ['acc', '成功率'], ['int', '攔截']);
    if (s.lineupMatches) cols.push(['apps', '出場'], ['mins', '時間'], ['gf', '在場進'], ['ga', '在場失'], ['pm', '+/−']);
    if (!cols.some(c => c[0] === pSort.k)) pSort = { k: 'goals', asc: false };
    let tbl;
    const render = () => {
      const { k, asc } = pSort;
      const sorted = [...rows].sort((a, b) => {
        const x = a[k], y = b[k];
        const c = typeof x === 'string' ? x.localeCompare(y, 'zh-Hant') : (x - y);
        return (asc ? c : -c) || (b.goals - a.goals) || (a.no - b.no);
      });
      const cell = (r, c) => {
        const v = r[c];
        if (c === 'no') return `<td class="num rk-no">${v}</td>`;
        if (c === 'name') return `<td>${esc(v)}</td>`;
        if (c === 'acc') return `<td class="n">${v >= 0 ? Math.round(v * 100) + '%' : '<span class="muted">–</span>'}</td>`;
        if (c === 'starts') return `<td class="n">${v || '<span class="muted">–</span>'}</td>`;
        if (['gf', 'ga', 'pm', 'mins', 'apps'].includes(c) && !r.apps) return `<td class="n muted">–</td>`;
        if (c === 'pm') return `<td class="n ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${v}</td>`;
        return `<td class="n">${v || '<span class="muted">0</span>'}</td>`;
      };
      tbl.innerHTML = `<thead><tr>${cols.map(([c, t]) => { const on = k === c; return `<th class="sort ${['no', 'name'].includes(c) ? '' : 'n'} ${on ? 'on' + (asc ? ' asc' : '') : ''}" aria-sort="${on ? (asc ? 'ascending' : 'descending') : 'none'}"><button type="button" class="th-btn" data-k="${c}">${t}</button></th>`; }).join('')}</tr></thead>
        <tbody>${sorted.map(r => `<tr>${cols.map(([c]) => cell(r, c)).join('')}</tr>`).join('')}</tbody>`;
      tbl.querySelectorAll('.th-btn').forEach(b => b.onclick = () => {
        const c = b.dataset.k;
        pSort = pSort.k === c ? { k: c, asc: !pSort.asc } : { k: c, asc: c === 'name' || c === 'no' };
        render();
        const nb = tbl.querySelector(`.th-btn[data-k="${c}"]`); if (nb) nb.focus();
      });
    };
    const v = view(`${draftBanner()}
      <div class="grid">
        <section class="card c8">
          ${head('Squad', '球員', `${s.played.length} 場`)}
          <div class="scroll"><table class="t sticky players" id="ptbl"></table></div>
        </section>
        <section class="card c4">${head('Staff', '職員')}
          <ul class="staff">${D.team.staff.map(x => `<li><span>${esc(x.role)}</span><b>${esc(x.name)}</b></li>`).join('')}</ul>
        </section>
      </div>`, '球員');
    tbl = v.querySelector('#ptbl');
    render();
  }

  // ---------- 戰術板 ----------
  function pageBoard() {
    nav('board');
    const SCRATCH = 'niaoshi-board-scratch';
    let scratch = null;
    try { scratch = JSON.parse(store.get(SCRATCH) || 'null'); } catch {}
    if (!scratch || !scratch.frames || !scratch.frames.length) scratch = { frames: [Pitch.blankFrame()] };
    const v = view(`<div class="grid">
      ${D.boards.map((b, i) => `<section class="card ${D.boards.length > 1 ? 'c6' : 'c12'}">${head(esc(b.kicker || 'Board'), esc(b.title))}<div data-board="${i}"></div></section>`).join('')}
      </div>
      <section class="card">${head('Whiteboard', '戰術板', '<button class="btn small ghost" id="scratch-reset">清空</button>')}
        <div id="scratch" class="board-ed"></div>
      </section>`, '戰術板');
    v.querySelectorAll('[data-board]').forEach(box => mountViewer(box, D.boards[+box.dataset.board]));
    const mount = () => Pitch.editor(document.getElementById('scratch'), scratch, { onChange: d => store.set(SCRATCH, JSON.stringify(d)), nameOf: pname });
    mount();
    document.getElementById('scratch-reset').onclick = () => {
      if (!confirm('清空戰術板？')) return;
      scratch = { frames: [Pitch.blankFrame()] }; store.del(SCRATCH); mount();
    };
  }

  // ---------- 草稿 ----------
  function loadDraft() {
    const pub = Object.fromEntries(D.published.map(p => [p.id, JSON.stringify(p)]));
    let ds = null;
    try { ds = JSON.parse(store.get(DRAFT_KEY) || 'null'); } catch {}
    if (!ds) {
      ds = { base: {}, matches: {} };
      let v1 = null;
      try { v1 = JSON.parse(store.get(DRAFT_V1) || 'null'); } catch {}
      if (Array.isArray(v1)) {
        v1.forEach(m => { if (m && pub[m.id] && JSON.stringify(m) !== pub[m.id]) { ds.matches[m.id] = m; ds.base[m.id] = pub[m.id]; } });
        if (Object.keys(ds.matches).length) store.set(DRAFT_KEY, JSON.stringify(ds));
        store.del(DRAFT_V1);
      }
    }
    ds.base = ds.base || {}; ds.matches = ds.matches || {};
    Object.keys(ds.matches).forEach(id => { if (!pub[id] || JSON.stringify(ds.matches[id]) === pub[id]) { delete ds.matches[id]; delete ds.base[id]; } });
    if (!Object.keys(ds.matches).length) store.del(DRAFT_KEY);
    D.ds = ds;
    refreshDraft();
  }
  function refreshDraft() {
    D.draft = Object.keys(D.ds.matches).length ? D.published.map(p => D.ds.matches[p.id] || p) : null;
  }
  function buildWork() {
    D.work = D.published.map(p => D.ds.matches[p.id] || clone(p));
  }
  function saveDraft() {
    const ds = D.ds;
    const pub = Object.fromEntries(D.published.map(p => [p.id, JSON.stringify(p)]));
    D.work.forEach(m => {
      if (JSON.stringify(m) !== pub[m.id]) { ds.matches[m.id] = m; if (!ds.base[m.id]) ds.base[m.id] = pub[m.id]; }
      else { delete ds.matches[m.id]; delete ds.base[m.id]; }
    });
    let ok = true;
    if (Object.keys(ds.matches).length) ok = store.set(DRAFT_KEY, JSON.stringify(ds));
    else store.del(DRAFT_KEY);
    refreshDraft();
    const st = document.getElementById('save-state');
    if (st) { st.textContent = ok ? '已存 ' + hm() : '未儲存'; st.className = 'save ' + (ok ? 'ok' : 'err'); }
    return ok;
  }
  const exportJSON = () => JSON.stringify(D.published.map(p => D.ds.matches[p.id] || p), null, 2) + '\n';

  // ---------- 計時 ----------
  const clock = (() => { try { return JSON.parse(store.get(CLOCK_KEY) || 'null') || {}; } catch { return {}; } })();
  let clockTimer = null;
  const clockFor = m => clock.start && clock.id === m.id;
  function clockElapsed(m) {
    if (!clockFor(m)) return null;
    return Math.max(0, (Date.now() - clock.start) / 1000) + (clock.half === 2 ? halfLen(m) * 60 : 0);
  }
  function clockMinute(m) {
    const s = clockElapsed(m);
    if (s == null) return null;
    const cap = halfLen(m) * (clock.half === 1 ? 1 : 2) + 10;
    return Math.min(cap, Math.floor(s / 60) + 1);
  }
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ---------- 記錄 ----------
  function recalc(m) {
    const g = side => (m.events || []).filter(e => e.type === 'goal' && e.side === side).length;
    if (m.status === 'played') m.score = { us: g('us'), them: g('them') };
    else delete m.score;
  }

  function pageLog(id) {
    EDITOR = true;
    store.set(EDITOR_KEY, '1');
    nav('log');
    if (!D.work) buildWork();
    const list = D.work;
    const m = list.find(x => x.id === id) || list.find(x => x.status !== 'played') || list[0];
    const players = D.team.players;
    const repo = repoInfo();
    const optsPlayers = sel => `<option value="">—</option>${players.map(p => `<option value="${p.no}" ${String(sel) === String(p.no) ? 'selected' : ''}>${p.no} ${esc(p.name)}</option>`).join('')}`;
    const starters = () => (m.lineup && m.lineup.starters || []).map(String);
    const evList = () => m.events || (m.events = []);
    const stale = D.ds.matches[m.id] && D.ds.base[m.id] && D.ds.base[m.id] !== JSON.stringify(D.published.find(p => p.id === m.id));

    const v = view(`
      <section class="card">
        ${head('Match log', '比賽記錄', `<span class="save" id="save-state">${D.ds.matches[m.id] ? '草稿' : ''}</span>`)}
        <select id="lg-match" aria-label="比賽">${list.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>R${x.round} · ${esc(short(x.opponent))} · ${fmtDate(x.date)}${x.status === 'played' ? ' ✓' : ''}${D.ds.matches[x.id] ? ' ●' : ''}</option>`).join('')}</select>
        ${stale ? `<div class="banner warn" id="stale"><span>網站資料已更新</span><span class="banner-act"><button class="btn small ghost" id="keep-draft">保留草稿</button><button class="btn small ghost" id="use-site">改用網站版</button></span></div>` : ''}
      </section>

      <div class="grid">
        <section class="card c5">
          ${head('Clock', '計時')}
          <div class="seg status" role="group" aria-label="狀態"><button type="button" data-st="upcoming">未賽</button><button type="button" data-st="played">完賽</button></div>
          <div class="clock" id="clkbox"><span class="t num" id="clk">0:00</span>
            <div class="seg"><button type="button" data-clk="1">上半場</button><button type="button" data-clk="2">下半場</button><button type="button" data-clk="0">停止</button></div></div>
        </section>
        <section class="card c7">
          ${head('Lineup', '先發', `<span id="lg-lineup-n" class="num">${starters().length}</span> 人`)}
          <div class="pgrid">${players.map(p => `<label class="pchk"><input type="checkbox" value="${p.no}" ${starters().includes(String(p.no)) ? 'checked' : ''}><b>${p.no}</b>${esc(p.name)}</label>`).join('')}</div>
          <label class="field gk">門將 <select id="lg-gk">${optsPlayers(m.lineup && m.lineup.gk)}</select></label>
        </section>
      </div>

      <section class="card">
        ${head('Add event', '新增事件')}
        <div class="seg" id="lg-type">
          <button type="button" data-t="us">進球</button><button type="button" data-t="them">失球</button>
          <button type="button" data-t="sub">換人</button><button type="button" data-t="card">紅黃牌</button>
        </div>
        <div class="fgrid" id="lg-form"></div>
      </section>

      <section class="card">
        ${head('Events', '事件', `<span class="num lg-score" id="lg-score"></span>`)}
        <div id="lg-events"></div>
      </section>

      <section class="card">
        ${head('Passing', '傳球與攔截', '<label class="chip-chk toggle"><input type="checkbox" id="ps-undo">− 修正</label>')}
        <div id="ps-box"></div>
      </section>

      <section class="card">
        ${head('Publish', '發佈')}
        <ol class="steps">
          <li>複製資料</li>
          <li>開啟&nbsp;<a href="${repo.edit}" target="_blank" rel="noopener">data/matches.json</a></li>
          <li>全部取代 → Commit changes</li>
        </ol>
        <div class="pub-row"><button class="btn" id="lg-copy">複製資料</button><button class="btn ghost" id="lg-dl">下載 JSON</button><button class="btn small danger" id="lg-discard">捨棄草稿</button></div>
      </section>`, '記錄');

    document.getElementById('lg-match').onchange = e => { location.hash = '#/log/' + e.target.value; };
    if (stale) {
      document.getElementById('keep-draft').onclick = () => { D.ds.base[m.id] = JSON.stringify(D.published.find(p => p.id === m.id)); saveDraft(); document.getElementById('stale').remove(); };
      document.getElementById('use-site').onclick = () => {
        if (!confirm('改用網站上的資料？此場草稿會刪除。')) return;
        delete D.ds.matches[m.id]; delete D.ds.base[m.id];
        buildWork(); saveDraft(); route();
      };
    }

    // 狀態
    const setStatusBtns = () => v.querySelectorAll('[data-st]').forEach(b => { const on = (m.status === 'played' ? 'played' : 'upcoming') === b.dataset.st; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    v.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { m.status = b.dataset.st; recalc(m); saveDraft(); setStatusBtns(); renderEvents(); });
    setStatusBtns();

    // 計時
    const setClk = () => {
      const c = document.getElementById('clk');
      if (!c) { clearInterval(clockTimer); clockTimer = null; return; }
      const run = clockFor(m);
      const s = clockElapsed(m);
      c.textContent = s == null ? '0:00' : mmss(s);
      document.getElementById('clkbox').classList.toggle('run', run);
      v.querySelectorAll('[data-clk]').forEach(b => b.classList.toggle('on', run ? +b.dataset.clk === clock.half : b.dataset.clk === '0'));
      const mf = document.getElementById('f-min');
      if (mf && !mf.dataset.edited && run) mf.value = clockMinute(m);
    };
    v.querySelectorAll('[data-clk]').forEach(b => b.onclick = () => {
      const n = +b.dataset.clk;
      if (!n) { clock.start = null; clock.id = null; }
      else {
        if (clockFor(m) && clock.half === n && !confirm('重新開始計時？')) return;
        clock.start = Date.now(); clock.half = n; clock.id = m.id;
      }
      store.set(CLOCK_KEY, JSON.stringify(clock));
      clearInterval(clockTimer); clockTimer = clock.start ? setInterval(setClk, 1000) : null;
      setClk();
    });
    clearInterval(clockTimer); clockTimer = clockFor(m) ? setInterval(setClk, 1000) : null;

    // 先發
    v.querySelectorAll('.pchk input').forEach(cb => cb.onchange = () => {
      m.lineup = m.lineup || { starters: [] };
      m.lineup.starters = [...v.querySelectorAll('.pchk input:checked')].map(x => +x.value);
      if (!m.lineup.starters.length && !m.lineup.gk) m.lineup = null;
      document.getElementById('lg-lineup-n').textContent = m.lineup ? m.lineup.starters.length : 0;
      saveDraft(); renderEvents(); renderPS();
    });
    document.getElementById('lg-gk').onchange = e => {
      m.lineup = m.lineup || { starters: [] };
      if (e.target.value) m.lineup.gk = +e.target.value; else delete m.lineup.gk;
      saveDraft();
    };

    // 新增事件
    let type = 'us';
    const form = document.getElementById('lg-form');
    function drawForm() {
      v.querySelectorAll('#lg-type button').forEach(b => { const on = b.dataset.t === type; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      const cm = clockMinute(m);
      form.innerHTML = `<label class="field">分鐘<input type="number" id="f-min" min="0" max="60" inputmode="numeric" value="${cm ?? ''}" placeholder="分鐘"></label>` + {
        us: `<label class="field">進球<select id="f-no">${optsPlayers('')}</select></label><label class="field">助攻<select id="f-ast">${optsPlayers('')}</select></label>`,
        them: `<label class="field">對手球員<input id="f-pl" placeholder="姓名"></label><label class="field">背號<input id="f-pno" inputmode="numeric"></label>`,
        sub: `<label class="field">上場<select id="f-on">${optsPlayers('')}</select></label><label class="field">下場<select id="f-off">${optsPlayers('')}</select></label>`,
        card: `<label class="field">隊伍<select id="f-side"><option value="us">鳥仕</option><option value="them">對手</option></select></label><label class="field">球員<select id="f-cno">${optsPlayers('')}</select></label><label class="field">牌<select id="f-col"><option value="yellow">黃牌</option><option value="red">紅牌</option></select></label>`
      }[type] + `<button type="button" class="btn" id="f-add">＋ 新增</button>`;
      const mf = document.getElementById('f-min');
      mf.oninput = () => { mf.dataset.edited = '1'; mf.classList.remove('err'); };
      document.getElementById('f-add').onclick = () => {
        const live = mf.dataset.edited ? null : clockMinute(m);
        const raw = live ?? (mf.value === '' ? null : +mf.value);
        if (raw == null || isNaN(raw)) { mf.classList.add('err'); mf.focus(); return; }
        const min = raw;
        const val = s => (document.getElementById(s) || {}).value;
        let e;
        if (type === 'us') e = { min, type: 'goal', side: 'us', no: val('f-no') ? +val('f-no') : null, ...(val('f-ast') ? { assist: +val('f-ast') } : {}) };
        if (type === 'them') e = { min, type: 'goal', side: 'them', player: val('f-pl') || '', ...(val('f-pno') ? { no: val('f-pno') } : {}) };
        if (type === 'sub') { if (!val('f-on') || !val('f-off')) return; e = { min, type: 'sub', on: +val('f-on'), off: +val('f-off') }; if (m.lineup) delete m.lineup.subsKnown; }
        if (type === 'card') e = { min, type: 'card', side: val('f-side'), no: val('f-cno') ? +val('f-cno') : null, color: val('f-col') };
        evList().push(e);
        recalc(m); saveDraft(); drawForm(); renderEvents(); renderPS();
      };
    }
    v.querySelectorAll('#lg-type button').forEach(b => b.onclick = () => { type = b.dataset.t; drawForm(); });
    drawForm();
    setClk();

    // 事件列表
    function renderEvents() {
      const box = document.getElementById('lg-events');
      const evs = sortEvents(m.events);
      const op = onPitch(m);
      const sc = scoreOf(m);
      document.getElementById('lg-score').textContent = `${sc.us} : ${sc.them}`;
      box.innerHTML = evs.length ? '' : '<p class="empty">—</p>';
      evs.forEach(e => {
        const card = document.createElement('div');
        card.className = 'lg-ev ' + (e.side || '') + ' ' + e.type;
        const title = e.type === 'goal' ? (e.side === 'us' ? `進球 · ${pLabel(e.no)}` : `失球 · ${e.player || '對手'}${e.no ? ` #${e.no}` : ''}`)
          : e.type === 'sub' ? `換人 · ${pname(e.on)} ↔ ${pname(e.off)}`
          : `${e.color === 'red' ? '紅牌' : '黃牌'} · ${e.side === 'us' ? pLabel(e.no) : '對手'}`;
        card.innerHTML = `<div class="row"><input type="number" class="ev-min num" value="${e.min}" aria-label="分鐘"><strong>${esc(title)}</strong>
          <button type="button" class="btn small ghost ev-del" aria-label="刪除">✕</button></div>`;
        card.querySelector('.ev-min').onchange = ev => { if (ev.target.value === '') return; e.min = +ev.target.value; recalc(m); saveDraft(); renderEvents(); };
        card.querySelector('.ev-del').onclick = () => {
          if (!confirm('刪除這個事件？')) return;
          m.events.splice(m.events.indexOf(e), 1);
          recalc(m); saveDraft(); renderEvents(); renderPS();
        };
        if (e.type === 'goal') {
          const extra = document.createElement('div');
          extra.className = 'ev-extra';
          const onList = op && op.perEvent.get(e);
          const cur = (e.cause || []).map(causeName);
          extra.innerHTML = `
            ${e.side === 'them' ? `<div class="causes">${CAUSES.map(c => `<label class="chip-chk"><input type="checkbox" value="${esc(c)}" ${cur.includes(c) ? 'checked' : ''}>${esc(c)}</label>`).join('')}<label class="chip-chk toggle"><input type="checkbox" class="ev-tent" ${e.tentative ? 'checked' : ''}>初判</label></div>` : ''}
            <textarea class="ev-note" rows="2" placeholder="備註">${esc(e.note || '')}</textarea>
            <div class="fgrid tight"><label class="field">影片<select class="ev-vh"><option value="">—</option><option value="1" ${e.video && e.video.half === 1 ? 'selected' : ''}>上半場</option><option value="2" ${e.video && e.video.half === 2 ? 'selected' : ''}>下半場</option></select></label>
            <label class="field">時間<input class="ev-vt" placeholder="mm:ss" value="${esc(e.video ? e.video.t : '')}"></label>
            <button type="button" class="btn small ${e.diagram ? '' : 'ghost'} ev-diag">${e.diagram ? '站位圖' : '＋ 站位圖'}</button></div>
            ${onList ? `<p class="small muted">在場 ${onList.map(pname).join('、')}</p>` : ''}
            <div class="ev-diag-box"></div>`;
          extra.querySelectorAll('.causes input:not(.ev-tent)').forEach(cb => cb.onchange = () => {
            const sel = [...extra.querySelectorAll('.causes input:not(.ev-tent):checked')].map(x => x.value);
            if (sel.length) e.cause = sel; else delete e.cause;
            saveDraft();
          });
          const tent = extra.querySelector('.ev-tent'); if (tent) tent.onchange = () => { if (tent.checked) e.tentative = true; else delete e.tentative; saveDraft(); };
          extra.querySelector('.ev-note').oninput = ev => { if (ev.target.value) e.note = ev.target.value; else delete e.note; saveDraft(); };
          const vh = extra.querySelector('.ev-vh'), vt = extra.querySelector('.ev-vt');
          const setV = () => { if (vh.value && vt.value.trim()) e.video = { half: +vh.value, t: vt.value.trim() }; else delete e.video; saveDraft(); };
          vh.onchange = setV; vt.oninput = setV;
          extra.querySelector('.ev-diag').onclick = () => {
            const bx = extra.querySelector('.ev-diag-box');
            if (bx.childElementCount) { bx.innerHTML = ''; return; }
            if (!e.diagram) {
              e.diagram = { frames: [Pitch.blankFrame(onList ? orderGK(onList, m) : (starters().length ? orderGK(starters(), m) : []))] };
              e.diagram.frames[0].us.forEach(p => { if (p.no !== '') p.name = pname(p.no); });
              saveDraft();
            }
            const holder = document.createElement('div');
            bx.appendChild(holder);
            Pitch.editor(holder, e.diagram, { onChange: () => saveDraft(), nameOf: pname });
            const rm = document.createElement('button');
            rm.type = 'button'; rm.className = 'btn small danger rm-diag'; rm.textContent = '刪除站位圖';
            rm.onclick = () => { if (confirm('刪除這張站位圖？')) { delete e.diagram; saveDraft(); renderEvents(); } };
            bx.appendChild(rm);
          };
          card.appendChild(extra);
        }
        box.appendChild(card);
      });
    }
    renderEvents();

    // 傳球與攔截
    function renderPS() {
      const box = document.getElementById('ps-box');
      const ps = m.playerStats || {};
      const inGame = new Set([...starters(), ...(m.events || []).filter(e => e.type === 'sub').map(e => String(e.on))]);
      Object.keys(ps).forEach(n => inGame.add(n));
      const row = p => {
        const x = ps[p.no] || {};
        return `<div class="ps-row" data-no="${p.no}"><span class="ps-name"><b>${p.no}</b>${esc(p.name)}</span>
          <button type="button" class="ps-btn ok" data-k="ok">成功<b>${x.ok || 0}</b></button>
          <button type="button" class="ps-btn bad" data-k="bad">失誤<b>${x.bad || 0}</b></button>
          <button type="button" class="ps-btn int" data-k="int">攔截<b>${x.int || 0}</b></button></div>`;
      };
      const main = players.filter(p => inGame.has(String(p.no)));
      const rest = players.filter(p => !inGame.has(String(p.no)));
      box.innerHTML = `${main.map(row).join('')}
        ${rest.length ? `<details class="more" ${main.length ? '' : 'open'}><summary>${main.length ? `其他球員 ${rest.length}` : '全部球員'}</summary>${rest.map(row).join('')}</details>` : ''}`;
      box.querySelectorAll('.ps-btn').forEach(b => b.onclick = () => {
        const no = b.closest('.ps-row').dataset.no, k = b.dataset.k;
        m.playerStats = m.playerStats || {};
        const x = m.playerStats[no] = m.playerStats[no] || {};
        const undo = document.getElementById('ps-undo').checked;
        x[k] = Math.max(0, (x[k] || 0) + (undo ? -1 : 1));
        if (!x[k]) delete x[k];
        b.querySelector('b').textContent = x[k] || 0;
        if (!x.ok && !x.bad && !x.int) delete m.playerStats[no];
        if (!Object.keys(m.playerStats).length) delete m.playerStats;
        b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
        if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
        saveDraft();
      });
    }
    document.getElementById('ps-undo').onchange = e => document.getElementById('ps-box').classList.toggle('undo-on', e.target.checked);
    renderPS();

    // 發佈
    document.getElementById('lg-copy').onclick = async ev => {
      const b = ev.currentTarget, txt = exportJSON();
      try { await navigator.clipboard.writeText(txt); }
      catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      b.textContent = '已複製 ✓';
      setTimeout(() => b.textContent = '複製資料', 2000);
    };
    document.getElementById('lg-dl').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
      a.download = 'matches.json'; a.click();
    };
    document.getElementById('lg-discard').onclick = () => {
      if (!confirm('捨棄本機草稿？')) return;
      store.del(DRAFT_KEY); D.ds = { base: {}, matches: {} }; D.draft = null; D.work = null; store.sset(PREVIEW_KEY, '0');
      location.hash = '#/';
    };
  }

  // 門將排第一個
  function orderGK(list, m) {
    const gk = m.lineup && m.lineup.gk != null ? String(m.lineup.gk) : null;
    const arr = list.map(String);
    if (gk && arr.includes(gk)) return [gk, ...arr.filter(x => x !== gk)].map(Number);
    return arr.map(Number);
  }

  function repoInfo() {
    const host = location.hostname;
    let owner = 'WazzaBenedict', repo = 'niaoshi-fc';
    if (host.endsWith('.github.io')) {
      owner = host.split('.')[0];
      const seg = location.pathname.split('/').filter(Boolean)[0];
      if (seg) repo = seg;
    }
    return { edit: `https://github.com/${owner}/${repo}/edit/main/data/matches.json` };
  }

  // ---------- 路由 ----------
  try { history.scrollRestoration = 'manual'; } catch {}
  const scrollPos = new Map();
  let lastPage = null, popNav = false;
  window.addEventListener('popstate', () => { popNav = true; });
  function route() {
    const [, page, arg, sub] = (location.hash || '#/').split('/');
    const key = (page || '') + '/' + (arg || '');
    if (lastPage != null) scrollPos.set(lastPage, window.scrollY);
    const changed = key !== lastPage;
    const restore = popNav && changed ? scrollPos.get(key) || 0 : null;
    popNav = false;
    lastPage = key;
    if (!page) pageHome();
    else if (page === 'matches') pageMatches();
    else if (page === 'm') pageMatch(arg, sub);
    else if (page === 'players') pagePlayers();
    else if (page === 'board') pageBoard();
    else if (page === 'log') pageLog(arg);
    else pageHome();
    if (restore != null) requestAnimationFrame(() => window.scrollTo(0, restore));
    else if (changed) window.scrollTo(0, 0);
  }

  async function boot() {
    document.body.classList.toggle('editor', EDITOR);
    try {
      const [team, ms, boards] = await Promise.all(['data/team.json', 'data/matches.json', 'data/boards.json'].map(u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(u); return r.json(); })));
      D.team = team; D.published = ms; D.boards = boards;
      loadDraft();
      window.addEventListener('hashchange', route);
      window.addEventListener('pagehide', () => { if (D.work) saveDraft(); });
      route();
    } catch (err) {
      console.error(err);
      app.innerHTML = `<p class="empty fail">資料載入失敗，請重新整理</p>`;
    }
  }
  boot();
})();
