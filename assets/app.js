// 鳥仕足球隊 分析網站
(function () {
  'use strict';

  const DRAFT_KEY = 'niaoshi-draft-v1';
  const PREVIEW_KEY = 'niaoshi-preview';
  const CAUSES = [
    '定位球', '反擊被打穿', '中路被推進', '邊路傳中', '身後球', '遠射',
    '盯人失位', '二點球沒搶到', '個人失誤', '門將失誤', '體能下滑', '換人或人數劣勢'
  ];
  const WINDOWS = ["1'–10'", "11'–20'", "21'–30'", "31'–40'"];

  const app = document.getElementById('app');
  const D = { team: null, published: [], boards: [], draft: null };

  // ---------- 工具 ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
    sget(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    sset(k, v) { try { sessionStorage.setItem(k, v); } catch {} }
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  const player = no => D.team.players.find(p => String(p.no) === String(no));
  const pname = no => { const p = player(no); return p ? p.name : (no != null && no !== '' ? '#' + no : '未知'); };
  const pLabel = no => { const p = player(no); return p ? `${p.name}（${p.no}）` : (no != null && no !== '' ? `#${no}` : '未知'); };
  const fmtDate = (d, t) => { const [y, m, dd] = d.split('-'); const wd = '日一二三四五六'[new Date(d + 'T00:00:00').getDay()]; return `${+m}/${+dd}（${wd}）${t ? ' ' + t : ''}`; };
  const halfLen = m => m.halfLength || D.team.halfLength || 20;
  const winIdx = min => min <= 10 ? 0 : min <= 20 ? 1 : min <= 30 ? 2 : 3;
  const sortEvents = evs => evs.map((e, i) => [e, i]).sort((a, b) => (a[0].min - b[0].min) || (a[1] - b[1])).map(x => x[0]);
  const ytLink = (m, v) => {
    if (!v || !m.videos) return null;
    const vid = m.videos.find(x => x.half === v.half);
    if (!vid) return null;
    const [mm, ss] = String(v.t).split(':').map(Number);
    const sec = (mm || 0) * 60 + (ss || 0);
    return vid.url + (vid.url.includes('?') ? '&' : '?') + 't=' + sec;
  };

  function matches() {
    const preview = store.sget(PREVIEW_KEY) === '1' && D.draft;
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

  // 依事件順序計算誰在場上
  function onPitch(m) {
    if (!m.lineup || !m.lineup.starters || !m.lineup.starters.length) return null;
    if (m.lineup.subsKnown === false) return null;
    const len = halfLen(m) * 2;
    const on = new Map(); // no -> entered minute
    const mins = {}, gf = {}, ga = {}, apps = new Set();
    m.lineup.starters.forEach(n => { on.set(String(n), 0); apps.add(String(n)); });
    const leave = (n, t) => { n = String(n); if (!on.has(n)) return; mins[n] = (mins[n] || 0) + Math.max(0, t - on.get(n)); on.delete(n); };
    const perEvent = new Map();
    sortEvents(m.events || []).forEach(e => {
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
    const s = { played, w: 0, d: 0, l: 0, gf: 0, ga: 0, win: [[0, 0, 0, 0], [0, 0, 0, 0]], halves: { us: [0, 0], them: [0, 0] }, scorers: {}, assists: {}, causes: {}, causesTentative: {}, concededState: { lead: 0, draw: 0, trail: 0 }, conceded: [] , players: {}, lineupMatches: 0, ps: {}, psMatches: 0 };
    played.forEach(m => {
      const sc = scoreOf(m);
      s.gf += sc.us; s.ga += sc.them;
      s[resultOf(sc).toLowerCase()]++;
      let us = 0, them = 0;
      sortEvents(m.events || []).forEach(e => {
        if (e.type !== 'goal') return;
        const side = e.side === 'us' ? 0 : 1;
        s.win[side][winIdx(e.min)]++;
        s.halves[e.side === 'us' ? 'us' : 'them'][e.min <= halfLen(m) ? 0 : 1]++;
        if (e.side === 'us') {
          if (e.no != null) s.scorers[e.no] = (s.scorers[e.no] || 0) + 1;
          if (e.assist != null && e.assist !== '') s.assists[e.assist] = (s.assists[e.assist] || 0) + 1;
          us++;
        } else {
          s.concededState[us > them ? 'lead' : us === them ? 'draw' : 'trail']++;
          (e.cause || []).forEach(c => { const bag = e.tentative ? s.causesTentative : s.causes; bag[c] = (bag[c] || 0) + 1; });
          s.conceded.push({ m, e });
          them++;
        }
      });
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


  // ---------- 小元件 ----------
  const ICON = {
    goal: '<svg class="ico" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.6l2.6 1.9-1 3H6.4l-1-3z" fill="currentColor"/></svg>',
    sub: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6h8l-2.5-2.5M12 10H4l2.5 2.5"/></svg>',
    card: c => `<svg class="ico" viewBox="0 0 16 16"><rect x="4.5" y="2.5" width="7" height="11" rx="1.2" fill="${c === 'red' ? '#e5483b' : '#f5c518'}"/></svg>`,
    play: '<svg class="ico" viewBox="0 0 16 16"><path d="M5 3.5v9l7.5-4.5z" fill="currentColor"/></svg>'
  };
  const head = (kicker, title, aside = '') => `<div class="head"><div><span class="kicker">${kicker}</span><h2>${title}</h2></div>${aside ? `<div class="aside">${aside}</div>` : ''}</div>`;
  const resBadge = r => `<i class="${r}">${r === 'W' ? '勝' : r === 'L' ? '負' : '和'}</i>`;
  const stagger = root => [...root.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 10)));
  const daysTo = d => Math.ceil((new Date(d + 'T00:00:00+08:00') - Date.now()) / 86400000);

  function countUp(root) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.querySelectorAll('[data-count]').forEach(el => {
      const end = +el.dataset.count, pre = el.dataset.pre || '', t0 = performance.now(), dur = 700;
      if (!end) return;
      const step = t => {
        const p = Math.min(1, (t - t0) / dur), v = Math.round(end * (1 - Math.pow(1 - p, 3)));
        el.textContent = pre + v;
        if (p < 1) requestAnimationFrame(step);
      };
      el.textContent = pre + '0';
      setTimeout(() => requestAnimationFrame(step), 200);
    });
  }

  function view(html) {
    app.innerHTML = `<div class="view">${html}</div>`;
    const v = app.firstElementChild;
    stagger(v);
    countUp(v);
    bindCommon();
    return v;
  }

  // ---------- 圖表 ----------
  function windowChart(s) {
    const max = Math.max(1, ...s.win[0], ...s.win[1]);
    const W = 340, H = 190, padX = 6, padB = 28, padT = 26, gw = (W - padX * 2) / 4, bw = 24;
    const y = v => H - padB - (v / max) * (H - padB - padT);
    let bars = '', d = 0;
    for (let i = 0; i < 4; i++) {
      const cx = padX + gw * i + gw / 2;
      [0, 1].forEach(side => {
        const v = s.win[side][i];
        const x = cx + (side === 0 ? -bw - 2 : 2);
        const top = y(v);
        bars += `<g class="bar-g"><title>${WINDOWS[i]} ${side === 0 ? '進球' : '失球'} ${v}</title>
          <rect x="${x - 2}" y="${padT}" width="${bw + 4}" height="${H - padB - padT}" class="hit"/>
          ${v > 0 ? `<path d="M${x},${H - padB} V${top + 5} q0,-5 5,-5 h${bw - 10} q5,0 5,5 V${H - padB} z" class="bar s${side} grow-y" style="--d:${d++}"/>` : ''}
          <text x="${x + bw / 2}" y="${top - 7}" class="v fade-in" style="--d:${d}">${v}</text></g>`;
      });
      bars += `<text x="${cx}" y="${H - padB + 18}" class="ax">${WINDOWS[i]}</text>`;
    }
    const mid = W / 2;
    return `<figure class="chart" style="margin:0">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="進失球時段分布">
        <rect x="${mid}" y="${padT - 18}" width="${W / 2 - padX + 2}" height="${H - padB - padT + 18}" rx="8" class="half-bg"/>
        <text x="${padX + 4}" y="${padT - 6}" class="ax start">上半場</text>
        <text x="${mid + 8}" y="${padT - 6}" class="ax start">下半場</text>
        <line x1="${padX}" x2="${W - padX}" y1="${H - padB}" y2="${H - padB}" class="base"/>
        ${bars}
      </svg>
      <details class="tbl"><summary>表格 ▾</summary><table><thead><tr><th>時段</th><th>進球</th><th>失球</th></tr></thead><tbody>
        ${WINDOWS.map((w, i) => `<tr><td>${w}</td><td>${s.win[0][i]}</td><td>${s.win[1][i]}</td></tr>`).join('')}
      </tbody></table></details>
    </figure>`;
  }

  function hbar(rows, empty = '—') {
    if (!rows.length) return `<p class="empty">${empty}</p>`;
    const max = Math.max(...rows.map(r => r.v + (r.t || 0)), 1);
    return `<div class="hbars">${rows.map((r, i) => `
      <div class="hb-row" title="${esc(r.k)} ${r.v + (r.t || 0)}${r.t ? `（${r.t} 初判）` : ''}">
        <span class="hb-k">${esc(r.k)}</span>
        <span class="hb-track">${r.v ? `<span class="hb-fill grow-x" style="width:${(r.v / max) * 100}%;--d:${i}"></span>` : ''}${r.t ? `<span class="hb-fill tentative grow-x" style="width:${(r.t / max) * 100}%;--d:${i}"></span>` : ''}</span>
        <span class="hb-v">${r.v + (r.t || 0)}</span>
      </div>`).join('')}</div>`;
  }

  // ---------- 共用 ----------
  function nav(key) {
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === key));
  }

  function draftBanner() {
    if (!D.draft) return '';
    const preview = store.sget(PREVIEW_KEY) === '1';
    return `<div class="banner"><span>${preview ? '草稿預覽中' : '本機有未發佈的草稿'}</span>
      <button class="btn small ghost" data-act="toggle-preview">${preview ? '回到正式版' : '預覽'}</button></div>`;
  }

  function bindCommon() {
    app.querySelectorAll('[data-act=toggle-preview]').forEach(b => b.onclick = () => {
      store.sset(PREVIEW_KEY, store.sget(PREVIEW_KEY) === '1' ? '0' : '1'); route();
    });
  }

  function fixtures(list) {
    return `<ul class="fx">${list.map(m => {
      const played = m.status === 'played';
      const sc = played ? scoreOf(m) : null;
      return `<li><a href="#/m/${m.id}">
        <span class="rd">R${m.round}</span>
        <span class="op">${esc(m.opponent)}<small>${m.home ? '主場' : '客場'} · ${fmtDate(m.date, m.time)}</small></span>
        ${played ? `<span class="res">${sc.us}–${sc.them} ${resBadge(resultOf(sc))}</span>` : `<span class="res up">${fmtDate(m.date)}</span>`}
      </a></li>`;
    }).join('')}</ul>`;
  }

  // ---------- 總覽 ----------
  function pageHome() {
    nav('home');
    const list = matches();
    const s = seasonStats(list);
    const next = list.find(m => m.status !== 'played');
    const st = D.team.standings;
    const rank = st.rows.findIndex(r => r.team === D.team.name) + 1;
    const pts = s.w * 3 + s.d, gd = s.gf - s.ga;
    const scorers = Object.entries(s.scorers).sort((a, b) => b[1] - a[1]);
    const causes = Object.keys({ ...s.causes, ...s.causesTentative }).map(k => ({ k, v: s.causes[k] || 0, t: s.causesTentative[k] || 0 })).sort((a, b) => (b.v + b.t) - (a.v + a.t));
    const cs = s.concededState;
    const sh = s.halves.them[1], l10 = s.win[1][3];
    const form = list.map(m => m.status === 'played' ? `<a class="${resultOf(scoreOf(m))}" href="#/m/${m.id}" title="R${m.round} ${esc(m.opponent)}">${resultOf(scoreOf(m)) === 'W' ? '勝' : resultOf(scoreOf(m)) === 'L' ? '負' : '和'}</a>` : '').join('');
    const dn = next ? daysTo(next.date) : 0;

    view(`${draftBanner()}
      <section class="hero">
        <img class="logo" src="assets/logo.webp" alt="鳥仕 FC">
        <div>
          <span class="kicker">${esc(D.team.season)} · D LEAGUE L3</span>
          <h1>${esc(D.team.name)}</h1>
          <div class="sub"><span class="pill gold">${esc(D.team.formation)}</span><span>${esc(D.team.league)}</span></div>
          <div class="form">${form}${next ? '<a class="U" title="下一場">?</a>' : ''}</div>
        </div>
        <div class="stats">
          <div class="stat"><b class="gold" data-count="${rank}" data-pre="#">#${rank || '–'}</b><span>排名</span></div>
          <div class="stat"><b data-count="${pts}">${pts}</b><span>積分</span></div>
          <div class="stat"><b>${s.w}-${s.d}-${s.l}</b><span>勝-和-負</span></div>
          <div class="stat"><b data-count="${s.gf}">${s.gf}</b><span>進球</span></div>
          <div class="stat"><b data-count="${s.ga}">${s.ga}</b><span>失球</span></div>
          <div class="stat"><b>${gd > 0 ? '+' : ''}${gd}</b><span>淨勝</span></div>
        </div>
      </section>

      ${next ? `<a class="card next" href="#/m/${next.id}">
        <div><span class="kicker">Next · 第 ${next.round} 輪</span>
          <h3>${next.home ? '主場' : '客場'} vs ${esc(next.opponent)}</h3>
          <div class="when">${fmtDate(next.date, next.time)}</div></div>
        <div class="countdown"><b>${dn > 0 ? dn : dn === 0 ? '今天' : '—'}</b><span>${dn > 0 ? '天後' : ''}</span></div>
      </a>` : ''}

      <div class="grid">
        <section class="card c8">
          ${head('Goal timing', '進失球時段', `<span class="legend"><span><i class="sw s0"></i>進球</span><span><i class="sw s1"></i>失球</span></span>`)}
          ${windowChart(s)}
        </section>
        <section class="card c4">
          ${head('Key insight', '失球集中')}
          <div class="tiles">
            <div class="tile"><div class="v num">${sh}<small>/${s.ga}</small></div><div class="k">下半場失球</div><div class="meter"><i class="grow-x" style="width:${s.ga ? sh / s.ga * 100 : 0}%"></i></div></div>
            <div class="tile"><div class="v num">${l10}<small>/${s.ga}</small></div><div class="k">31'–40' 失球</div><div class="meter"><i class="grow-x" style="width:${s.ga ? l10 / s.ga * 100 : 0}%;--d:1"></i></div></div>
          </div>
        </section>
      </div>

      <div class="grid">
        <section class="card c6">
          ${head('Conceded', '失球原因', `${s.conceded.filter(x => x.e.cause && x.e.cause.length).length}/${s.conceded.length} 已標記`)}
          ${hbar(causes, '尚未標記')}
          ${Object.keys(s.causesTentative).length ? '<p class="small muted" style="margin:10px 0 0">淡色為初判</p>' : ''}
        </section>
        <section class="card c6">
          ${head('Game state', '失球當下比分')}
          ${hbar([{ k: '領先', v: cs.lead }, { k: '平手', v: cs.draw }, { k: '落後', v: cs.trail }])}
        </section>
      </div>

      <div class="grid">
        <section class="card c5">
          ${head('Top scorers', '射手榜')}
          ${scorers.length ? `<ol class="rank">${scorers.map(([n, v], i) => { const p = player(n); return `<li><span class="pos">${i + 1}</span><span class="shirt">${esc(n)}</span><span class="nm">${esc(pname(n))}${p && p.pos ? `<small>${esc(p.pos)}</small>` : ''}</span><span class="g">${v}</span></li>`; }).join('')}</ol>` : '<p class="empty">—</p>'}
        </section>
        <section class="card c7">
          ${head('Standings', '積分榜', `第 ${st.afterRound} 輪 · <a href="${D.team.links.standings}" target="_blank" rel="noopener">官網 ↗</a>`)}
          <table class="t"><thead><tr><th>#</th><th>球隊</th><th class="n">場</th><th class="n">淨勝</th><th class="n">積分</th></tr></thead><tbody>
            ${st.rows.map((r, i) => `<tr class="${r.team === D.team.name ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.team)}</td><td class="n">${r.p}</td><td class="n">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="n"><b>${r.pts}</b></td></tr>`).join('')}
          </tbody></table>
        </section>
      </div>

      <section class="card">
        ${head('Fixtures', '賽程', `<a href="#/matches">全部 →</a>`)}
        ${fixtures(list)}
      </section>`);
  }

  function pageMatches() {
    nav('matches');
    view(`${draftBanner()}<section class="card">${head('Season 2026/27', '賽程與賽果')}${fixtures(matches())}</section>`);
  }

  // ---------- 單場 ----------
  function pageMatch(id, tab) {
    nav('matches');
    const m = matches().find(x => x.id === id);
    if (!m) { view('<p class="empty">找不到這場比賽</p>'); return; }
    const played = m.status === 'played';
    const sc = scoreOf(m);
    const evs = sortEvents(m.events || []);
    const conceded = evs.filter(e => e.type === 'goal' && e.side === 'them');
    const rv = m.review || {};
    const hasReview = ['observations', 'good', 'improve', 'plan'].some(k => rv[k] && rv[k].length);
    const hasData = !!(m.playerStats && Object.keys(m.playerStats).length) || !!onPitch(m);
    const tabs = [['sum', '概要']];
    if (conceded.length) tabs.push(['goals', `失球分析<span class="cnt">${conceded.length}</span>`]);
    if (m.lineup || hasData) tabs.push(['data', '陣容與數據']);
    if (hasReview) tabs.push(['review', '檢討']);
    if (!tabs.some(t => t[0] === tab)) tab = 'sum';

    const scorerList = side => evs.filter(e => e.type === 'goal' && e.side === side)
      .map(e => side === 'us' ? `${esc(pname(e.no))} ${e.min}'` : `${esc(e.player || '對手')} ${e.min}'`).join('<br>');
    const usBadge = `<span class="badge"><img src="assets/logo-64.png" alt=""></span>`;
    const opBadge = `<span class="badge">${esc(m.opponent.replace(/足球俱樂部|俱樂部/g, '').slice(0, 1))}</span>`;
    const home = m.home;
    const L = home ? { n: '鳥仕', b: usBadge, s: 'us' } : { n: m.opponent, b: opBadge, s: 'them' };
    const R = home ? { n: m.opponent, b: opBadge, s: 'them' } : { n: '鳥仕', b: usBadge, s: 'us' };
    const lsc = home ? sc.us : sc.them, rsc = home ? sc.them : sc.us;

    const v = view(`${draftBanner()}
      <a href="#/matches" class="back">← 賽程</a>
      <section class="scoreboard">
        <div class="meta"><span>D LEAGUE L3 · 第 ${m.round} 輪</span><span>·</span><span>${fmtDate(m.date, m.time)}</span></div>
        <div class="sb">
          <div class="team">${L.b}<b>${esc(L.n)}</b></div>
          <div>${played ? `<div class="score">${lsc}<i>:</i>${rsc}</div><span class="ft">FULL TIME</span>` : '<div class="score vs">VS</div>'}</div>
          <div class="team">${R.b}<b>${esc(R.n)}</b></div>
        </div>
        ${played ? `<div class="scorers"><div>${scorerList(L.s)}</div><div>${scorerList(R.s)}</div></div>` : ''}
        <div class="links">
          ${m.official ? `<a href="${m.official}" target="_blank" rel="noopener">官方紀錄 ↗</a>` : ''}
          ${(m.videos || []).map(x => `<a href="${x.url}" target="_blank" rel="noopener">▶ ${x.half === 1 ? '上' : '下'}半場</a>`).join('')}
          <a href="#/log/${m.id}">✎ 紀錄</a>
        </div>
      </section>
      <nav class="tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</nav>
      <div class="panel" id="panel"></div>`);

    const panel = v.querySelector('#panel');
    const show = k => {
      v.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
      panel.innerHTML = '';
      panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
      ({ sum: panelSummary, goals: panelGoals, data: panelData, review: panelReview })[k](panel, m, { evs, conceded, played, rv });
      try { history.replaceState(null, '', `#/m/${m.id}${k === 'sum' ? '' : '/' + k}`); } catch {}
    };
    v.querySelectorAll('.tabs button').forEach(b => b.onclick = () => show(b.dataset.tab));
    show(tab);
  }

  function panelSummary(panel, m, { evs, played, rv }) {
    let us = 0, them = 0, halfShown = false;
    const hl = halfLen(m);
    const row = e => {
      let pre = '';
      if (!halfShown && e.min > hl) { halfShown = true; pre = `<li><span class="half">HT ${us}–${them}</span></li>`; }
      if (e.type === 'goal') { if (e.side === 'us') us++; else them++; }
      const link = ytLink(m, e.video);
      const vid = link ? `<a class="vid" href="${link}" target="_blank" rel="noopener" title="影片">${ICON.play}</a>` : '';
      const mine = e.side === 'us' || e.type === 'sub' || (e.type === 'card' && e.side === 'us');
      let body;
      if (e.type === 'goal') body = `${ICON.goal}<span>${esc(e.side === 'us' ? pname(e.no) : (e.player || '對手'))}${e.assist ? `<span class="muted small"> · ${esc(pname(e.assist))}</span>` : ''}</span><span class="sc">${m.home ? `${us}–${them}` : `${them}–${us}`}</span>`;
      else if (e.type === 'sub') body = `${ICON.sub}<span>${esc(pname(e.on))} <span class="muted small">↔ ${esc(pname(e.off))}</span></span>`;
      else if (e.type === 'card') body = `${ICON.card(e.color)}<span>${esc(e.side === 'us' ? pname(e.no) : (e.player || e.no || '對手'))}</span>`;
      else body = esc(e.note || '');
      const left = m.home ? mine : !mine;
      const cls = e.type === 'goal' ? `goal-${e.side}` : '';
      return pre + `<li class="${cls}">${left ? `<span class="ev-l">${vid}${body}</span>` : '<span></span>'}<span class="m">${e.min}'</span>${left ? '<span></span>' : `<span class="ev-r">${body}${vid}</span>`}</li>`;
    };
    panel.innerHTML = `
      ${rv.summary ? `<section class="card">${head('Summary', '比賽概要')}<p style="margin:0">${esc(rv.summary)}</p></section>` : ''}
      ${played ? `<section class="card">${head('Timeline', '比賽事件', `<span class="legend"><span>${m.home ? '鳥仕' : esc(m.opponent)}</span><span>|</span><span>${m.home ? esc(m.opponent) : '鳥仕'}</span></span>`)}
        ${evs.length ? `<ol class="tl">${evs.map(row).join('')}<li><span class="half">FT ${m.home ? `${us}–${them}` : `${them}–${us}`}</span></li></ol>` : '<p class="empty">尚無事件</p>'}
      </section>` : `<section class="card">${head('Preview', '賽前')}<p class="empty">${m.home ? '主場' : '客場'} · ${fmtDate(m.date, m.time)}</p><a class="btn" href="#/log/${m.id}">開始紀錄</a></section>`}`;
  }

  function panelGoals(panel, m, { conceded }) {
    const op = onPitch(m);
    let us = 0, them = 0;
    const state = new Map();
    sortEvents(m.events).forEach(e => { if (e.type !== 'goal') return; if (e.side === 'us') us++; else { them++; state.set(e, `${us}–${them}`); } });
    panel.innerHTML = `<div class="goals">${conceded.map((e, i) => {
      const link = ytLink(m, e.video);
      const onList = op && op.perEvent.get(e);
      const hasD = e.diagram && e.diagram.frames && e.diagram.frames.length;
      return `<article class="goal" style="--i:${i}">
        <header><span class="gm">${e.min}'</span><div><b>${esc(e.player || '對手')}${e.no ? ` <span class="muted">#${esc(e.no)}</span>` : ''}</b><div class="gs">鳥仕 ${state.get(e)}</div></div>
          ${link ? `<a class="vid" href="${link}" target="_blank" rel="noopener">${ICON.play} ${esc(e.video.t)}</a>` : ''}</header>
        <div class="tags">${(e.cause || []).map(c => `<span class="pill">${esc(c)}</span>`).join('')}${e.tentative ? '<span class="pill warn">初判</span>' : ''}${!(e.cause || []).length ? '<span class="pill">未標記</span>' : ''}</div>
        ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
        ${onList ? `<p class="on">在場：${onList.map(n => esc(pname(n))).join('、')}</p>` : ''}
        ${hasD ? `<div data-diagram="${i}"></div>` : `<a class="btn small ghost" href="#/log/${m.id}">＋ 站位圖</a>`}
      </article>`;
    }).join('')}</div>`;
    panel.querySelectorAll('[data-diagram]').forEach(box => mountViewer(box, conceded[+box.dataset.diagram].diagram));
  }

  function panelData(panel, m) {
    const op = onPitch(m);
    panel.innerHTML = `<div class="grid">
      ${m.lineup && m.lineup.starters && m.lineup.starters.length ? `<section class="card c5">${head('Starting XI', '先發', esc(m.lineup.shape || '3-2-1'))}<div id="xi"></div></section>` : ''}
      <div class="c7" style="display:grid;gap:16px;align-content:start">
        ${op ? lineupBlock(m, op) : `<section class="card">${head('On pitch', '在場進失球')}<p class="empty">缺換人時間</p></section>`}
        ${psBlock(m) || `<section class="card">${head('Passing', '傳球與攔截')}<p class="empty">尚無紀錄</p></section>`}
      </div></div>`;
    const xi = panel.querySelector('#xi');
    if (xi) {
      const base = Pitch.shape321();
      const us = m.lineup.starters.slice(0, 7).map((n, i) => ({ ...base[i], no: n, name: pname(n), label: pname(n) }));
      Pitch.render(xi, { us, them: [], arrows: [] }, { label: '先發陣容' });
      xi.firstElementChild.classList.add('pitch-xi');
      xi.classList.add('pitch-wrap');
    }
  }

  function panelReview(panel, m, { rv }) {
    const li = (arr, cls) => `<ul class="rv-list ${cls}">${arr.map(o => `<li><b>${esc(o.title)}</b><span>${esc(o.text)}</span></li>`).join('')}</ul>`;
    panel.innerHTML = `<div class="rv">
      ${rv.good && rv.good.length ? `<section class="card c6">${head('Strengths', '做得好')}${li(rv.good, 'good')}</section>` : ''}
      ${rv.improve && rv.improve.length ? `<section class="card c6">${head('Weaknesses', '待改進')}${li(rv.improve, 'bad')}</section>` : ''}
      ${rv.plan && rv.plan.length ? `<section class="card c12">${head('Action plan', '下一場準備')}${li(rv.plan, 'plan')}</section>` : ''}
      ${rv.observations && rv.observations.length ? `<section class="card c12">${head('Video notes', '影片觀察')}<ul class="obs">${rv.observations.map(o => `<li><span class="when">${esc(o.min)}<small>${esc(o.video)}</small></span><span>${esc(o.text)}</span></li>`).join('')}</ul></section>` : ''}
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
      ${rows.map(r => `<tr><td>${esc(pname(r.n))} <span class="muted small">${esc(r.n)}</span></td><td class="n">${r.ok + r.bad}</td><td class="n">${r.ok}</td><td class="n">${pct(r.ok, r.bad)}</td><td class="n">${r.int}</td></tr>`).join('')}
      <tr class="total"><td>全隊</td><td class="n">${tot.ok + tot.bad}</td><td class="n">${tot.ok}</td><td class="n">${pct(tot.ok, tot.bad)}</td><td class="n">${tot.int}</td></tr>
      </tbody></table></div></section>`;
  }

  function lineupBlock(m, op) {
    const rows = [...op.apps].map(n => ({ n, mins: op.mins[n] || 0, gf: op.gf[n] || 0, ga: op.ga[n] || 0, starter: m.lineup.starters.map(String).includes(n) }))
      .sort((a, b) => b.mins - a.mins);
    return `<section class="card">${head('On pitch', '在場進失球')}
      <div class="scroll"><table class="t"><thead><tr><th>球員</th><th class="n">分鐘</th><th class="n">在場進</th><th class="n">在場失</th><th class="n">+/−</th></tr></thead><tbody>
      ${rows.map(r => { const pm = r.gf - r.ga; return `<tr><td>${esc(pname(r.n))} ${r.starter ? '' : '<span class="pill">替補</span>'}</td><td class="n">${r.mins}</td><td class="n">${r.gf}</td><td class="n">${r.ga}</td><td class="n ${pm > 0 ? 'pos' : pm < 0 ? 'neg' : ''}">${pm > 0 ? '+' : ''}${pm}</td></tr>`; }).join('')}
      </tbody></table></div></section>`;
  }

  function mountViewer(box, diagram) {
    let idx = 0;
    const frames = diagram.frames;
    const draw = () => {
      box.innerHTML = `${frames.length > 1 ? `<div class="frames">${frames.map((f, i) => `<button type="button" class="chip ${i === idx ? 'on' : ''}" data-i="${i}">${i + 1} · ${esc(f.label || '')}</button>`).join('')}</div>` : (frames[0].label ? `<div class="frames"><span class="chip on">${esc(frames[0].label)}</span></div>` : '')}
        <div class="pitch-wrap"></div>
        ${legendPitch()}
        ${diagram.note ? `<p class="board-note">${esc(diagram.note)}</p>` : ''}`;
      Pitch.render(box.querySelector('.pitch-wrap'), frames[idx], { label: frames[idx].label });
      box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { idx = +b.dataset.i; draw(); });
    };
    draw();
  }

  const legendPitch = () => `<div class="plegend">
    <span><i class="tk us"></i>鳥仕</span><span><i class="tk them"></i>對手</span>
    <span><i class="ln pass"></i>傳球</span><span><i class="ln run"></i>跑位</span><span><i class="ln dribble"></i>帶球</span><span><i class="ln shot"></i>射門</span></div>`;

  // ---------- 球員 ----------
  let pSort = { k: 'mins', asc: false };
  function pagePlayers() {
    nav('players');
    const s = seasonStats(matches());
    const rows = D.team.players.map(p => {
      const st = s.players[String(p.no)] || { apps: 0, mins: 0, gf: 0, ga: 0 };
      const ps = s.ps[String(p.no)];
      const passes = ps ? ps.ok + ps.bad : 0;
      return { ...p, ...st, goals: s.scorers[p.no] || 0, ast: s.assists[p.no] || 0, passes, acc: passes ? ps.ok / passes : -1, int: ps ? ps.int : 0, pm: st.gf - st.ga };
    });
    const cols = [
      ['no', '#'], ['name', '球員'], ['goals', '進球'], ['ast', '助攻'], ['passes', '傳球'], ['acc', '成功率'], ['int', '攔截'],
      ['apps', '出場'], ['mins', '分鐘'], ['gf', '在場進'], ['ga', '在場失'], ['pm', '+/−']
    ];
    const render = () => {
      const { k, asc } = pSort;
      const sorted = [...rows].sort((a, b) => {
        const x = a[k], y = b[k];
        const c = typeof x === 'string' ? x.localeCompare(y, 'zh-Hant') : (x - y);
        return (asc ? c : -c) || (b.goals - a.goals) || (a.no - b.no);
      });
      const cell = (r, c) => {
        const v = r[c];
        if (c === 'no') return `<td class="num" style="color:var(--gold);font-weight:700">${v}</td>`;
        if (c === 'name') return `<td>${esc(v)}${r.pos ? `<span class="sub">${esc(r.pos)}</span>` : ''}</td>`;
        if (c === 'acc') return `<td class="n">${v >= 0 ? Math.round(v * 100) + '%' : '<span class="muted">–</span>'}</td>`;
        if (['gf', 'ga', 'pm', 'mins', 'apps'].includes(c) && !r.apps) return `<td class="n muted">–</td>`;
        if (c === 'pm') return `<td class="n ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${v}</td>`;
        return `<td class="n">${v || '<span class="muted">0</span>'}</td>`;
      };
      tbl.innerHTML = `<thead><tr>${cols.map(([c, t]) => `<th class="sort ${['no', 'name'].includes(c) ? '' : 'n'} ${k === c ? 'on' + (asc ? ' asc' : '') : ''}" data-k="${c}">${t}</th>`).join('')}</tr></thead>
        <tbody>${sorted.map(r => `<tr>${cols.map(([c]) => cell(r, c)).join('')}</tr>`).join('')}</tbody>`;
      tbl.querySelectorAll('th.sort').forEach(th => th.onclick = () => {
        const c = th.dataset.k;
        pSort = pSort.k === c ? { k: c, asc: !pSort.asc } : { k: c, asc: c === 'name' || c === 'no' };
        render();
      });
    };
    const v = view(`${draftBanner()}
      <section class="card">
        ${head('Squad 2026/27', '球員數據', `${D.team.players.length} 人`)}
        <div class="scroll"><table class="t sticky" id="ptbl"></table></div>
        <p class="small muted" style="margin:12px 0 0">出場／分鐘／在場進失：${s.lineupMatches} 場有完整換人紀錄 · 傳球／攔截：${s.psMatches} 場</p>
      </section>
      <section class="card">${head('Staff', '職員')}
        <div style="display:flex;gap:24px;flex-wrap:wrap">${D.team.staff.map(x => `<div><span class="kicker">${esc(x.role)}</span><b>${esc(x.name)}</b></div>`).join('')}</div>
      </section>`);
    const tbl = v.querySelector('#ptbl');
    render();
  }

  // ---------- 戰術板 ----------
  function pageBoard() {
    nav('board');
    const SCRATCH = 'niaoshi-board-scratch';
    let scratch = null;
    try { scratch = JSON.parse(store.get(SCRATCH) || 'null'); } catch {}
    if (!scratch) scratch = { frames: [Pitch.blankFrame()] };
    const v = view(`<div class="grid">
      ${D.boards.map((b, i) => `<section class="card c6">${head(i === 0 ? 'Shape' : 'Game management', esc(b.title))}<div data-board="${i}"></div></section>`).join('')}
      </div>
      <section class="card">${head('Whiteboard', '自由戰術板', '<button class="btn small ghost" id="scratch-reset">清空</button>')}
        <div id="scratch" style="max-width:520px;margin:0 auto"></div>
      </section>`);
    v.querySelectorAll('[data-board]').forEach(box => mountViewer(box, D.boards[+box.dataset.board]));
    const mount = () => Pitch.editor(document.getElementById('scratch'), scratch, { onChange: d => store.set(SCRATCH, JSON.stringify(d)), nameOf: pname });
    mount();
    document.getElementById('scratch-reset').onclick = () => { scratch = { frames: [Pitch.blankFrame()] }; store.del(SCRATCH); mount(); };
  }

  // ---------- 頁面：紀錄 ----------
  function ensureDraft() {
    if (!D.draft) D.draft = clone(D.published);
    return D.draft;
  }
  let saveTimer = null;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(DRAFT_KEY, JSON.stringify(D.draft)), 200);
    const st = document.getElementById('save-state');
    if (st) { st.textContent = '已存 ' + new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }); st.classList.add('ok'); }
  }

  const clock = { start: null, half: 1, timer: null };
  function clockMinute(m) {
    if (!clock.start) return null;
    const el = (Date.now() - clock.start) / 60000;
    return Math.min(halfLen(m) * (clock.half === 1 ? 1 : 2) + 5, Math.floor(el) + 1 + (clock.half === 2 ? halfLen(m) : 0));
  }


  function pageLog(id) {
    nav('log');
    const list = ensureDraft();
    let m = list.find(x => x.id === id) || list.find(x => x.status !== 'played') || list[0];
    if (!m.events) m.events = [];
    const players = D.team.players;
    const repo = repoInfo();
    const optsPlayers = sel => `<option value="">—</option>${players.map(p => `<option value="${p.no}" ${String(sel) === String(p.no) ? 'selected' : ''}>${p.no} ${esc(p.name)}</option>`).join('')}`;
    const starters = () => (m.lineup && m.lineup.starters || []).map(String);

    const v = view(`
      <section class="card">
        ${head('Match log', '比賽紀錄', `<span class="save" id="save-state">${store.get(DRAFT_KEY) ? '已存草稿' : ''}</span>`)}
        <select id="lg-match" style="width:100%">${list.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>R${x.round} · ${esc(x.opponent)} · ${fmtDate(x.date)}${x.status === 'played' ? ' ✓' : ''}</option>`).join('')}</select>
      </section>

      <div class="grid">
        <section class="card c5">
          ${head('Clock', '計時')}
          <div class="clock ${clock.start ? 'run' : ''}" id="clkbox"><span class="t" id="clk">${clock.start ? clockMinute(m) + "'" : "0'"}</span>
            <div class="seg"><button type="button" data-clk="1">上半場</button><button type="button" data-clk="2">下半場</button><button type="button" data-clk="0">停止</button></div></div>
        </section>
        <section class="card c7">
          ${head('Starting XI', '先發', `<span id="lg-lineup-n" class="num">${starters().length}</span> 人`)}
          <div class="pgrid">${players.map(p => `<label class="pchk"><input type="checkbox" value="${p.no}" ${starters().includes(String(p.no)) ? 'checked' : ''}><b>${p.no}</b>${esc(p.name)}</label>`).join('')}</div>
          <label class="field" style="margin-top:12px">門將 <select id="lg-gk">${optsPlayers(m.lineup && m.lineup.gk)}</select></label>
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
        ${head('Events', '事件', `<span class="num" id="lg-score" style="font-size:1.1rem"></span>`)}
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
          <li>開啟&nbsp;<a href="${repo.edit}" target="_blank" rel="noopener">data/matches.json ↗</a></li>
          <li>全部取代 → Commit changes</li>
        </ol>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="lg-copy">複製資料</button><button class="btn ghost" id="lg-dl">下載 JSON</button><button class="btn small danger" id="lg-discard" style="margin-left:auto">捨棄草稿</button></div>
      </section>`);

    document.getElementById('lg-match').onchange = e => { location.hash = '#/log/' + e.target.value; };

    // 計時
    const setClk = () => {
      const c = document.getElementById('clk'); if (!c) return;
      c.textContent = clock.start ? clockMinute(m) + "'" : "0'";
      document.getElementById('clkbox').classList.toggle('run', !!clock.start);
      v.querySelectorAll('[data-clk]').forEach(b => b.classList.toggle('on', clock.start ? +b.dataset.clk === clock.half : b.dataset.clk === '0'));
    };
    v.querySelectorAll('[data-clk]').forEach(b => b.onclick = () => {
      const n = +b.dataset.clk;
      clearInterval(clock.timer);
      if (!n) clock.start = null;
      else { clock.start = Date.now(); clock.half = n; clock.timer = setInterval(setClk, 5000); }
      setClk(); drawForm();
    });
    setClk();

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
      m.lineup.gk = e.target.value ? +e.target.value : undefined;
      saveDraft();
    };

    // 新增事件
    let type = 'us';
    const form = document.getElementById('lg-form');
    function drawForm() {
      v.querySelectorAll('#lg-type button').forEach(b => b.classList.toggle('on', b.dataset.t === type));
      const minField = `<label class="field">分鐘<input type="number" id="f-min" min="0" max="50" inputmode="numeric" value="${clockMinute(m) || ''}"></label>`;
      form.innerHTML = minField + {
        us: `<label class="field">進球<select id="f-no">${optsPlayers('')}</select></label><label class="field">助攻<select id="f-ast">${optsPlayers('')}</select></label>`,
        them: `<label class="field">對手球員<input id="f-pl" placeholder="姓名"></label><label class="field">背號<input id="f-pno" inputmode="numeric"></label>`,
        sub: `<label class="field">上場<select id="f-on">${optsPlayers('')}</select></label><label class="field">下場<select id="f-off">${optsPlayers('')}</select></label>`,
        card: `<label class="field">隊伍<select id="f-side"><option value="us">鳥仕</option><option value="them">對手</option></select></label><label class="field">球員<select id="f-cno">${optsPlayers('')}</select></label><label class="field">牌<select id="f-col"><option value="yellow">黃牌</option><option value="red">紅牌</option></select></label>`
      }[type] + `<button class="btn" id="f-add">＋ 新增</button>`;
      document.getElementById('f-add').onclick = () => {
        const mf = document.getElementById('f-min');
        if (!mf.value) { mf.focus(); return; }
        const min = +mf.value;
        const val = s => (document.getElementById(s) || {}).value;
        let e;
        if (type === 'us') e = { min, type: 'goal', side: 'us', no: val('f-no') ? +val('f-no') : null, ...(val('f-ast') ? { assist: +val('f-ast') } : {}) };
        if (type === 'them') e = { min, type: 'goal', side: 'them', player: val('f-pl') || '', ...(val('f-pno') ? { no: val('f-pno') } : {}), cause: [] };
        if (type === 'sub') { if (!val('f-on') || !val('f-off')) return; e = { min, type: 'sub', on: +val('f-on'), off: +val('f-off') }; if (m.lineup) delete m.lineup.subsKnown; }
        if (type === 'card') e = { min, type: 'card', side: val('f-side'), no: val('f-cno') ? +val('f-cno') : null, color: val('f-col') };
        m.events.push(e);
        if (m.events.some(x => x.type === 'goal')) { m.status = 'played'; m.score = scoreOf(m); }
        saveDraft(); drawForm(); renderEvents(); renderPS();
      };
    }
    v.querySelectorAll('#lg-type button').forEach(b => b.onclick = () => { type = b.dataset.t; drawForm(); });
    drawForm();

    // 事件列表
    function renderEvents() {
      const box = document.getElementById('lg-events');
      const evs = sortEvents(m.events);
      const op = onPitch(m);
      const sc = scoreOf(m);
      document.getElementById('lg-score').textContent = `${sc.us} : ${sc.them}`;
      box.innerHTML = evs.length ? '' : '<p class="empty">尚無事件</p>';
      evs.forEach(e => {
        const card = document.createElement('div');
        card.className = 'lg-ev ' + (e.side || '') + ' ' + e.type;
        const title = e.type === 'goal' ? (e.side === 'us' ? `進球 · ${pLabel(e.no)}` : `失球 · ${e.player || '對手'}${e.no ? ` #${e.no}` : ''}`)
          : e.type === 'sub' ? `換人 · ${pname(e.on)} ↔ ${pname(e.off)}`
          : `${e.color === 'red' ? '紅牌' : '黃牌'} · ${e.side === 'us' ? pLabel(e.no) : '對手'}`;
        card.innerHTML = `<div class="row"><input type="number" class="ev-min" value="${e.min}" aria-label="分鐘"><strong>${esc(title)}</strong>
          <button class="btn small ghost ev-del" aria-label="刪除">✕</button></div>`;
        card.querySelector('.ev-min').onchange = ev => { e.min = +ev.target.value; saveDraft(); renderEvents(); };
        card.querySelector('.ev-del').onclick = () => { if (confirm('刪除這個事件？')) { m.events.splice(m.events.indexOf(e), 1); m.score = scoreOf(m); saveDraft(); renderEvents(); } };
        if (e.type === 'goal') {
          const extra = document.createElement('div');
          extra.className = 'ev-extra';
          const onList = op && op.perEvent.get(e);
          extra.innerHTML = `
            ${e.side === 'them' ? `<div class="causes">${CAUSES.map(c => `<label class="chip-chk"><input type="checkbox" value="${esc(c)}" ${(e.cause || []).includes(c) ? 'checked' : ''}>${esc(c)}</label>`).join('')}<label class="chip-chk toggle"><input type="checkbox" class="ev-tent" ${e.tentative ? 'checked' : ''}>初判</label></div>` : ''}
            <textarea class="ev-note" rows="2" placeholder="備註">${esc(e.note || '')}</textarea>
            <div class="fgrid" style="margin:0"><label class="field">影片<select class="ev-vh"><option value="">—</option><option value="1" ${e.video && e.video.half === 1 ? 'selected' : ''}>上半場</option><option value="2" ${e.video && e.video.half === 2 ? 'selected' : ''}>下半場</option></select></label>
            <label class="field">時間<input class="ev-vt" placeholder="mm:ss" value="${esc(e.video ? e.video.t : '')}"></label>
            <button class="btn small ${e.diagram ? '' : 'ghost'} ev-diag">${e.diagram ? '站位圖 ▾' : '＋ 站位圖'}</button></div>
            ${onList ? `<p class="small muted" style="margin:0">在場：${onList.map(pname).join('、')}</p>` : ''}
            <div class="ev-diag-box"></div>`;
          extra.querySelectorAll('.causes input:not(.ev-tent)').forEach(cb => cb.onchange = () => { e.cause = [...extra.querySelectorAll('.causes input:not(.ev-tent):checked')].map(x => x.value); saveDraft(); });
          const tent = extra.querySelector('.ev-tent'); if (tent) tent.onchange = () => { if (tent.checked) e.tentative = true; else delete e.tentative; saveDraft(); };
          extra.querySelector('.ev-note').oninput = ev => { e.note = ev.target.value; saveDraft(); };
          const vh = extra.querySelector('.ev-vh'), vt = extra.querySelector('.ev-vt');
          const setV = () => { if (vh.value && vt.value) e.video = { half: +vh.value, t: vt.value.trim() }; else delete e.video; saveDraft(); };
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
            rm.className = 'btn small danger'; rm.textContent = '刪除站位圖'; rm.style.marginTop = '10px';
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
      const inGame = new Set([...starters(), ...m.events.filter(e => e.type === 'sub').map(e => String(e.on))]);
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
        b.querySelector('b').textContent = x[k];
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
    const json = () => JSON.stringify(list, null, 2) + '\n';
    document.getElementById('lg-copy').onclick = async ev => {
      const b = ev.currentTarget;
      try { await navigator.clipboard.writeText(json()); }
      catch { const ta = document.createElement('textarea'); ta.value = json(); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      b.textContent = '已複製 ✓';
      setTimeout(() => b.textContent = '複製資料', 2000);
    };
    document.getElementById('lg-dl').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
      a.download = 'matches.json'; a.click();
    };
    document.getElementById('lg-discard').onclick = () => {
      if (!confirm('捨棄本機草稿，回到網站上的資料？')) return;
      store.del(DRAFT_KEY); D.draft = null; store.sset(PREVIEW_KEY, '0'); route();
    };
  }

  // 門將排第一個，其他照順序
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
  let lastPage = null;
  function route() {
    const [, page, arg, sub] = (location.hash || '#/').split('/');
    const key = (page || '') + '/' + (arg || '');
    if (key !== lastPage) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    lastPage = key;
    if (!page) return pageHome();
    if (page === 'matches') return pageMatches();
    if (page === 'm') return pageMatch(arg, sub);
    if (page === 'players') return pagePlayers();
    if (page === 'board') return pageBoard();
    if (page === 'log') return pageLog(arg);
    pageHome();
  }

  async function boot() {
    try {
      const v = '?v=' + Math.floor(Date.now() / 60000).toString(36);
      const [team, ms, boards] = await Promise.all(['data/team.json', 'data/matches.json', 'data/boards.json'].map(u => fetch(u + v).then(r => { if (!r.ok) throw new Error(u); return r.json(); })));
      D.team = team; D.published = ms; D.boards = boards;
      try { const d = store.get(DRAFT_KEY); if (d) D.draft = JSON.parse(d); } catch {}
      window.addEventListener('hashchange', route);
      route();
    } catch (err) {
      app.innerHTML = `<p class="empty" style="text-align:center;padding:60px 0">資料載入失敗，請重新整理</p>`;
    }
  }
  boot();
})();
