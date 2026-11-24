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
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
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
    const s = { played, w: 0, d: 0, l: 0, gf: 0, ga: 0, win: [[0, 0, 0, 0], [0, 0, 0, 0]], halves: { us: [0, 0], them: [0, 0] }, scorers: {}, assists: {}, causes: {}, causesTentative: {}, concededState: { lead: 0, draw: 0, trail: 0 }, conceded: [] , players: {}, lineupMatches: 0 };
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

  // ---------- 圖表 ----------
  function windowChart(s) {
    const max = Math.max(1, ...s.win[0], ...s.win[1]);
    const W = 320, H = 180, padL = 8, padB = 30, padT = 30, gw = (W - padL * 2) / 4, bw = 22;
    const y = v => H - padB - (v / max) * (H - padB - padT);
    let bars = '';
    for (let i = 0; i < 4; i++) {
      const cx = padL + gw * i + gw / 2;
      [0, 1].forEach(side => {
        const v = s.win[side][i];
        const x = cx + (side === 0 ? -bw - 1 : 1);
        const top = y(v), hgt = H - padB - top;
        const label = side === 0 ? '進球' : '失球';
        bars += `<g class="bar-g"><title>${WINDOWS[i]} ${label} ${v}</title>
          <rect x="${x - 3}" y="${padT - 4}" width="${bw + 6}" height="${H - padB - padT + 4}" class="hit"/>
          ${v > 0 ? `<path d="M${x},${H - padB} V${top + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${H - padB} z" class="bar s${side}"/>` : ''}
          <text x="${x + bw / 2}" y="${top - 5}" class="v">${v}</text></g>`;
      });
      bars += `<text x="${cx}" y="${H - padB + 17}" class="ax">${WINDOWS[i]}</text>`;
    }
    const half = (W) / 2;
    return `<figure class="chart">
      <div class="legend"><span><i class="sw s0"></i>鳥仕進球</span><span><i class="sw s1"></i>失球</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="進失球時段分布">
        <line x1="${padL}" x2="${W - padL}" y1="${H - padB}" y2="${H - padB}" class="base"/>
        <line x1="${half}" x2="${half}" y1="${padT - 6}" y2="${H - padB + 4}" class="divider"/>
        <text x="${half - 4}" y="${padT - 8}" class="ax end">上半場</text><text x="${half + 4}" y="${padT - 8}" class="ax start">下半場</text>
        ${bars}
      </svg>
      <details class="tbl"><summary>表格</summary><table><thead><tr><th>時段</th><th>進球</th><th>失球</th></tr></thead><tbody>
        ${WINDOWS.map((w, i) => `<tr><td>${w}</td><td>${s.win[0][i]}</td><td>${s.win[1][i]}</td></tr>`).join('')}
      </tbody></table></details>
    </figure>`;
  }

  function hbar(rows, opts = {}) {
    if (!rows.length) return `<p class="muted">${opts.empty || '尚無資料'}</p>`;
    const max = Math.max(...rows.map(r => r.v + (r.t || 0)), 1);
    return `<div class="hbars">${rows.map(r => `
      <div class="hb-row" title="${esc(r.k)}：${r.v}${r.t ? `（另 ${r.t} 為初判）` : ''}">
        <span class="hb-k">${esc(r.k)}</span>
        <span class="hb-track"><span class="hb-fill" style="width:${(r.v / max) * 100}%"></span>${r.t ? `<span class="hb-fill tentative" style="width:${(r.t / max) * 100}%"></span>` : ''}</span>
        <span class="hb-v">${r.v + (r.t || 0)}</span>
      </div>`).join('')}</div>`;
  }

  // ---------- 版面 ----------
  function nav(active) {
    const items = [['#/', '總覽'], ['#/matches', '比賽'], ['#/players', '球員'], ['#/board', '戰術板'], ['#/log', '紀錄']];
    document.querySelectorAll('.topnav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === active));
    return items;
  }

  function draftBanner() {
    if (!D.draft) return '';
    const preview = store.sget(PREVIEW_KEY) === '1';
    return `<div class="banner ${preview ? 'on' : ''}">
      ${preview ? '正在預覽你在這台裝置上的<strong>草稿</strong>（隊友看不到）。' : '這台裝置有尚未發佈的紀錄草稿。'}
      <button class="btn small" data-act="toggle-preview">${preview ? '回到正式版' : '預覽草稿'}</button>
    </div>`;
  }

  function bindCommon() {
    app.querySelectorAll('[data-act=toggle-preview]').forEach(b => b.onclick = () => {
      store.sset(PREVIEW_KEY, store.sget(PREVIEW_KEY) === '1' ? '0' : '1'); route();
    });
  }

  // ---------- 頁面：總覽 ----------
  function pageHome() {
    nav('#/');
    const list = matches();
    const s = seasonStats(list);
    const next = list.find(m => m.status !== 'played');
    const st = D.team.standings;
    const rank = st.rows.findIndex(r => r.team === D.team.name) + 1;
    const pts = s.w * 3 + s.d;
    const lastTen = s.win[1][3];
    const secondHalf = s.halves.them[1];
    const scorers = Object.entries(s.scorers).sort((a, b) => b[1] - a[1]);
    const causes = Object.keys({ ...s.causes, ...s.causesTentative }).map(k => ({ k, v: s.causes[k] || 0, t: s.causesTentative[k] || 0 })).sort((a, b) => (b.v + b.t) - (a.v + a.t));
    const cs = s.concededState;
    const withDiagram = s.conceded.filter(x => x.e.diagram && x.e.diagram.frames && x.e.diagram.frames.length).length;

    app.innerHTML = `${draftBanner()}
      <section class="hero">
        <div>
          <p class="eyebrow">${esc(D.team.season)} · ${esc(D.team.league)}</p>
          <h1>${esc(D.team.name)}</h1>
          <p class="muted">主要陣式 ${esc(D.team.formation)}</p>
        </div>
        <div class="kpis">
          <div class="kpi"><b>${s.w}-${s.d}-${s.l}</b><span>勝-和-負</span></div>
          <div class="kpi"><b>${pts}</b><span>積分</span></div>
          <div class="kpi"><b>${s.gf}:${s.ga}</b><span>進:失</span></div>
          <div class="kpi"><b>${rank ? '#' + rank : '–'}</b><span>排名（第 ${st.afterRound} 輪後）</span></div>
        </div>
      </section>

      ${next ? `<a class="card next" href="#/m/${next.id}">
        <span class="eyebrow">下一場 · 第 ${next.round} 輪</span>
        <strong>${next.home ? '主場' : '客場'} 對 ${esc(next.opponent)}</strong>
        <span class="muted">${fmtDate(next.date, next.time)}</span>
      </a>` : ''}

      <section class="card">
        <h2>什麼時候進球、什麼時候失球</h2>
        <p class="lead">${s.ga ? `${s.ga} 個失球中有 <strong>${secondHalf} 個在下半場</strong>，${lastTen} 個在最後 10 分鐘。` : '還沒有失球紀錄。'}${s.gf ? ` 進球集中在 ${WINDOWS[s.win[0].indexOf(Math.max(...s.win[0]))]}。` : ''}</p>
        ${windowChart(s)}
      </section>

      <div class="grid2">
        <section class="card">
          <h2>失球原因</h2>
          ${hbar(causes, { empty: '失球還沒有標記原因。到「紀錄」頁替每個失球選原因、畫站位圖。' })}
          ${Object.keys(s.causesTentative).length ? '<p class="muted small"><i class="sw s1 tentative"></i>淡色＝依影片初判，尚未逐格確認</p>' : ''}
          <p class="muted small">${s.conceded.length} 個失球中，${s.conceded.length - s.conceded.filter(x => x.e.cause && x.e.cause.length).length} 個還沒標原因，${withDiagram} 個有站位圖。</p>
        </section>
        <section class="card">
          <h2>失球當下的比分</h2>
          ${hbar([{ k: '領先時', v: cs.lead }, { k: '平手時', v: cs.draw }, { k: '落後時', v: cs.trail }])}
          <p class="muted small">領先時失球多，通常代表領先後整隊退太深或專注力下降。</p>
        </section>
      </div>

      <div class="grid2">
        <section class="card">
          <h2>射手榜</h2>
          ${scorers.length ? `<ol class="rank">${scorers.map(([n, v]) => `<li><span>${esc(pLabel(n))}</span><b>${v}</b></li>`).join('')}</ol>` : '<p class="muted">尚無進球</p>'}
        </section>
        <section class="card">
          <h2>積分榜 <span class="muted small">（${st.asOf.replaceAll('-', '/')}，<a href="${D.team.links.standings}" target="_blank" rel="noopener">官網</a>）</span></h2>
          <table class="tbl-std"><thead><tr><th>#</th><th>球隊</th><th>場</th><th>淨</th><th>分</th></tr></thead><tbody>
            ${st.rows.map((r, i) => `<tr class="${r.team === D.team.name ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.team)}</td><td>${r.p}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td></tr>`).join('')}
          </tbody></table>
        </section>
      </div>

      <section class="card">
        <h2>賽程與結果</h2>
        ${matchList(list)}
      </section>`;
    bindCommon();
  }

  function matchList(list) {
    return `<ul class="mlist">${list.map(m => {
      const played = m.status === 'played';
      const sc = played ? scoreOf(m) : null;
      const r = sc ? resultOf(sc) : '';
      return `<li><a href="#/m/${m.id}">
        <span class="rd">R${m.round}</span>
        <span class="mt"><strong>${m.home ? '主' : '客'} · ${esc(m.opponent)}</strong><span class="muted small">${fmtDate(m.date, m.time)}</span></span>
        ${played ? `<span class="res r${r}">${r === 'W' ? '勝' : r === 'L' ? '負' : '和'} ${sc.us}-${sc.them}</span>` : '<span class="res">未賽</span>'}
      </a></li>`;
    }).join('')}</ul>`;
  }

  function pageMatches() {
    nav('#/matches');
    app.innerHTML = `${draftBanner()}<section class="card"><h2>全部比賽</h2>${matchList(matches())}</section>`;
    bindCommon();
  }

  // ---------- 頁面：單場 ----------
  function pageMatch(id) {
    nav('#/matches');
    const m = matches().find(x => x.id === id);
    if (!m) { app.innerHTML = '<p>找不到這場比賽。</p>'; return; }
    const played = m.status === 'played';
    const sc = scoreOf(m);
    const op = played ? onPitch(m) : null;
    const evs = sortEvents(m.events || []);
    const conceded = evs.filter(e => e.type === 'goal' && e.side === 'them');
    const rv = m.review || {};
    let us = 0, them = 0;

    const evRow = e => {
      if (e.type === 'goal') { if (e.side === 'us') us++; else them++; }
      const link = ytLink(m, e.video);
      const who = e.type === 'goal'
        ? (e.side === 'us' ? `⚽ ${esc(pLabel(e.no))}${e.assist ? `<span class="muted small">　助攻 ${esc(pname(e.assist))}</span>` : ''}` : `失球　${esc(e.player || '')}${e.no ? `（${esc(e.no)}）` : ''}`)
        : e.type === 'sub' ? `🔁 ${esc(pname(e.on))} 上，${esc(pname(e.off))} 下`
        : e.type === 'card' ? `${e.color === 'red' ? '🟥' : '🟨'} ${e.side === 'us' ? esc(pLabel(e.no)) : '對手 ' + esc(e.player || e.no || '')}`
        : esc(e.note || '');
      return `<li class="ev ev-${e.type} ${e.side || ''}">
        <span class="min">${e.min}'</span>
        <span class="what">${who}${e.type === 'goal' ? `<span class="score">${played ? `${us}-${them}` : ''}</span>` : ''}</span>
        ${link ? `<a class="vid" href="${link}" target="_blank" rel="noopener" title="看影片">▶</a>` : ''}
      </li>`;
    };

    app.innerHTML = `${draftBanner()}
      <p><a href="#/matches" class="back">← 全部比賽</a></p>
      <section class="match-head">
        <p class="eyebrow">第 ${m.round} 輪 · ${fmtDate(m.date, m.time)} · ${m.home ? '主場' : '客場'}</p>
        <div class="sb">
          <span class="tm">鳥仕</span>
          <span class="sc">${played ? `${sc.us} <i>-</i> ${sc.them}` : 'VS'}</span>
          <span class="tm">${esc(m.opponent)}</span>
        </div>
        <p class="links">
          ${m.official ? `<a href="${m.official}" target="_blank" rel="noopener">官方紀錄</a>` : ''}
          ${(m.videos || []).map(v => `<a href="${v.url}" target="_blank" rel="noopener">${v.half === 1 ? '上' : '下'}半場影片</a>`).join('')}
          <a href="#/log/${m.id}">編輯紀錄</a>
        </p>
      </section>

      ${rv.summary ? `<section class="card"><h2>比賽概要</h2><p>${esc(rv.summary)}</p></section>` : ''}

      ${played ? `<section class="card"><h2>比賽事件</h2>
        ${evs.length ? `<ol class="timeline">${evs.map(evRow).join('')}</ol>` : '<p class="muted">尚未紀錄事件</p>'}
      </section>` : `<section class="card"><h2>賽前準備</h2><p class="muted">比賽當天可以用「<a href="#/log/${m.id}">紀錄</a>」頁在場邊記錄先發、換人和進失球。</p></section>`}

      ${conceded.length ? `<section class="card"><h2>失球分析</h2>
        <p class="muted small">每個失球的原因、當時場上的鳥仕球員，以及 2D 站位圖。</p>
        <div class="goals">${conceded.map((e, i) => goalCard(m, e, i, op)).join('')}</div>
      </section>` : ''}

      ${m.lineup && m.lineup.starters && m.lineup.starters.length ? `<section class="card"><h2>先發陣容</h2><div class="diagram" id="xi"></div></section>` : ''}
      ${op ? lineupBlock(m, op) : played ? `<section class="card"><h2>出場與在場進失球</h2><p class="muted">${m.lineup ? '本場有先發名單，但沒有換人時間' : '本場沒有先發和換人紀錄'}，所以算不出每位球員在場時的進失球。</p></section>` : ''}

      ${listBlock('影片觀察', rv.observations, o => `<li><span class="muted small">${esc(o.video)} · ${esc(o.min)}</span><br>${esc(o.text)}</li>`)}
      ${listBlock('做得好的', rv.good, o => `<li><strong>${esc(o.title)}</strong>：${esc(o.text)}</li>`)}
      ${listBlock('需要改進的', rv.improve, o => `<li><strong>${esc(o.title)}</strong>：${esc(o.text)}</li>`)}
      ${listBlock('下一場的準備', rv.plan, o => `<li><strong>${esc(o.title)}</strong>：${esc(o.text)}</li>`, 'ol')}
      ${rv.pending ? `<p class="muted small">待補：${esc(rv.pending)}</p>` : ''}
    `;
    const xi = document.getElementById('xi');
    if (xi) {
      const base = Pitch.shape321();
      const us = m.lineup.starters.slice(0, 7).map((n, i) => ({ ...base[i], no: n, name: pname(n), label: pname(n) }));
      Pitch.render(xi, { us, them: [], arrows: [] }, { label: '先發陣容' });
    }
    // 站位圖
    app.querySelectorAll('[data-diagram]').forEach(box => {
      const e = conceded[+box.dataset.diagram];
      mountViewer(box, e.diagram);
    });
    bindCommon();
  }

  function listBlock(title, arr, fn, tag = 'ul') {
    if (!arr || !arr.length) return '';
    return `<section class="card"><h2>${title}</h2><${tag} class="plain">${arr.map(fn).join('')}</${tag}></section>`;
  }

  function goalCard(m, e, i, op) {
    const link = ytLink(m, e.video);
    const onList = op && op.perEvent.get(e);
    const hasD = e.diagram && e.diagram.frames && e.diagram.frames.length;
    return `<article class="goal">
      <header><span class="min">${e.min}'</span><strong>${esc(e.player || '對手')}${e.no ? `（${esc(e.no)}）` : ''}</strong>
        ${e.tentative ? '<span class="tag warn">初判</span>' : ''}
        ${link ? `<a class="vid" href="${link}" target="_blank" rel="noopener">▶ 影片 ${esc(e.video.t)}</a>` : ''}</header>
      <p class="tags">${(e.cause || []).map(c => `<span class="tag">${esc(c)}</span>`).join('') || '<span class="muted small">尚未標記原因</span>'}</p>
      ${e.note ? `<p>${esc(e.note)}</p>` : ''}
      ${onList ? `<p class="small"><span class="muted">當時在場：</span>${onList.map(n => esc(pname(n))).join('、')}</p>` : ''}
      ${hasD ? `<div class="diagram" data-diagram="${i}"></div>` : `<p class="muted small">還沒有站位圖。<a href="#/log/${m.id}">去畫一張</a></p>`}
    </article>`;
  }

  function mountViewer(box, diagram) {
    let idx = 0;
    const frames = diagram.frames;
    const draw = () => {
      box.innerHTML = `${frames.length > 1 ? `<div class="pe-frames">${frames.map((f, i) => `<button type="button" class="chip ${i === idx ? 'on' : ''}" data-i="${i}">${i + 1}. ${esc(f.label || '畫面')}</button>`).join('')}</div>` : `<p class="small muted">${esc(frames[0].label || '')}</p>`}
        <div class="pitch-wrap"></div>
        ${diagram.note ? `<p class="small">${esc(diagram.note)}</p>` : ''}
        ${legendPitch()}`;
      Pitch.render(box.querySelector('.pitch-wrap'), frames[idx], { label: frames[idx].label });
      box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { idx = +b.dataset.i; draw(); });
    };
    draw();
  }

  const legendPitch = () => `<div class="plegend small">
    <span><i class="tk us"></i>鳥仕</span><span><i class="tk them"></i>對手</span>
    <span><i class="ln pass"></i>傳球</span><span><i class="ln run"></i>跑位</span><span><i class="ln dribble"></i>帶球</span><span><i class="ln shot"></i>射門</span></div>`;

  function lineupBlock(m, op) {
    const rows = [...op.apps].map(n => ({ n, mins: op.mins[n] || 0, gf: op.gf[n] || 0, ga: op.ga[n] || 0, starter: m.lineup.starters.map(String).includes(n) }))
      .sort((a, b) => b.mins - a.mins);
    return `<section class="card"><h2>出場與在場進失球</h2>
      <table class="tbl-std"><thead><tr><th>球員</th><th>分鐘</th><th>在場進</th><th>在場失</th><th>+/−</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(pLabel(r.n))}${r.starter ? '' : ' <span class="muted small">替補</span>'}</td><td>${r.mins}</td><td>${r.gf}</td><td>${r.ga}</td><td class="${r.gf - r.ga > 0 ? 'pos' : r.gf - r.ga < 0 ? 'neg' : ''}">${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td></tr>`).join('')}
      </tbody></table></section>`;
  }

  // ---------- 頁面：球員 ----------
  function pagePlayers() {
    nav('#/players');
    const s = seasonStats(matches());
    const rows = D.team.players.map(p => {
      const st = s.players[String(p.no)] || { apps: 0, mins: 0, gf: 0, ga: 0 };
      return { ...p, ...st, goals: s.scorers[p.no] || 0, ast: s.assists[p.no] || 0 };
    }).sort((a, b) => (b.mins - a.mins) || (b.goals - a.goals) || (a.no - b.no));
    app.innerHTML = `${draftBanner()}
      <section class="card">
        <h2>球員數據</h2>
        <p class="muted small">進球來自官方紀錄。出場、分鐘和在場進失球（+/−）只算有先發與換人紀錄的比賽（目前 ${s.lineupMatches} 場）。</p>
        <div class="scroll"><table class="tbl-std players"><thead><tr>
          <th>#</th><th>球員</th><th>進球</th><th>助攻</th><th>出場</th><th>分鐘</th><th>在場進</th><th>在場失</th><th>+/−</th><th>每 40 分失球</th>
        </tr></thead><tbody>
        ${rows.map(r => {
          const pm = r.gf - r.ga;
          return `<tr><td>${r.no}</td><td>${esc(r.name)}</td><td>${r.goals || ''}</td><td>${r.ast || ''}</td><td>${r.apps || ''}</td><td>${r.mins || ''}</td><td>${r.apps ? r.gf : ''}</td><td>${r.apps ? r.ga : ''}</td>
            <td class="${pm > 0 ? 'pos' : pm < 0 ? 'neg' : ''}">${r.apps ? (pm > 0 ? '+' : '') + pm : ''}</td>
            <td>${r.mins >= 40 ? (r.ga / r.mins * 40).toFixed(1) : ''}</td></tr>`;
        }).join('')}
        </tbody></table></div>
      </section>
      <section class="card"><h2>職員</h2><p>${D.team.staff.map(s => `${esc(s.role)}：${esc(s.name)}`).join('　')}</p>
      <p class="small"><a href="${D.team.links.team}" target="_blank" rel="noopener">官網球隊頁</a></p></section>`;
    bindCommon();
  }

  // ---------- 頁面：戰術板 ----------
  function pageBoard() {
    nav('#/board');
    const SCRATCH = 'niaoshi-board-scratch';
    let scratch = null;
    try { scratch = JSON.parse(store.get(SCRATCH) || 'null'); } catch {}
    if (!scratch) scratch = { frames: [Pitch.blankFrame()] };
    app.innerHTML = `
      ${D.boards.map((b, i) => `<section class="card"><h2>${esc(b.title)}</h2><div class="diagram" data-board="${i}"></div></section>`).join('')}
      <section class="card"><h2>自由戰術板</h2>
        <p class="muted small">自己排站位、畫跑位。只存在這台裝置上。</p>
        <div id="scratch"></div>
        <p><button class="btn small" id="scratch-reset">清空重來</button></p>
      </section>`;
    app.querySelectorAll('[data-board]').forEach(box => mountViewer(box, D.boards[+box.dataset.board]));
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
    if (st) st.textContent = '已存在這台裝置（' + new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) + '）';
  }

  const clock = { start: null, half: 1, timer: null };
  function clockMinute(m) {
    if (!clock.start) return null;
    const el = (Date.now() - clock.start) / 60000;
    return Math.min(halfLen(m) * (clock.half === 1 ? 1 : 2) + 5, Math.floor(el) + 1 + (clock.half === 2 ? halfLen(m) : 0));
  }

  function pageLog(id) {
    nav('#/log');
    const list = ensureDraft();
    let m = list.find(x => x.id === id) || list.find(x => x.status !== 'played') || list[0];
    if (!m.events) m.events = [];
    const players = D.team.players;
    const repo = repoInfo();

    const optsPlayers = (sel, blank = true) => `${blank ? '<option value="">—</option>' : ''}${players.map(p => `<option value="${p.no}" ${String(sel) === String(p.no) ? 'selected' : ''}>${p.no} ${esc(p.name)}</option>`).join('')}`;

    app.innerHTML = `
      <section class="card">
        <h2>比賽紀錄</h2>
        <p class="muted small">在場邊或看影片時記錄。資料先存在這台裝置；記完按最下面的「發佈」更新到網站。</p>
        <label class="field">比賽
          <select id="lg-match">${list.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>第 ${x.round} 輪 · ${esc(x.opponent)} · ${fmtDate(x.date)}${x.status === 'played' ? '（已賽）' : ''}</option>`).join('')}</select>
        </label>
        <p class="small" id="save-state">${store.get(DRAFT_KEY) ? '這台裝置有草稿' : ''}</p>
      </section>

      <section class="card">
        <h2>場邊計時</h2>
        <div class="clock"><span id="clk">${clock.start ? clockMinute(m) + "'" : "--'"}</span>
          <button class="btn small" data-clk="1">上半場開始</button>
          <button class="btn small" data-clk="2">下半場開始</button>
          <button class="btn small ghost" data-clk="0">停止</button></div>
        <p class="muted small">計時中新增事件會自動帶入分鐘。看影片補紀錄時不用計時，直接填分鐘。</p>
      </section>

      <section class="card">
        <h2 id="lg-lineup-h">先發（${(m.lineup && m.lineup.starters || []).length} 人）</h2>
        <div class="pgrid">${players.map(p => `<label class="pchk"><input type="checkbox" value="${p.no}" ${(m.lineup && m.lineup.starters || []).map(String).includes(String(p.no)) ? 'checked' : ''}><b>${p.no}</b> ${esc(p.name)}</label>`).join('')}</div>
        <label class="field">門將 <select id="lg-gk">${optsPlayers(m.lineup && m.lineup.gk)}</select></label>
      </section>

      <section class="card">
        <h2>新增事件</h2>
        <div class="seg" id="lg-type">
          <button type="button" data-t="us">我方進球</button><button type="button" data-t="them">失球</button>
          <button type="button" data-t="sub">換人</button><button type="button" data-t="card">紅黃牌</button>
        </div>
        <div class="form" id="lg-form"></div>
      </section>

      <section class="card">
        <h2>事件（${m.events.length}）</h2>
        <p class="lead" id="lg-score"></p>
        <div id="lg-events"></div>
      </section>

      <section class="card">
        <h2>發佈到網站</h2>
        <ol class="plain small">
          <li>按「複製全部資料」。</li>
          <li>打開 <a href="${repo.edit}" target="_blank" rel="noopener">GitHub 上的 data/matches.json</a>（要用有權限的帳號）。</li>
          <li>全選刪掉原本內容，貼上，按「Commit changes」。約 1 分鐘後網站就更新。</li>
        </ol>
        <p><button class="btn" id="lg-copy">複製全部資料</button> <button class="btn ghost" id="lg-dl">下載 matches.json</button></p>
        <p class="small muted">也可以把下載的檔案傳給 Claude，請它幫你更新。</p>
        <details><summary class="small">放棄草稿</summary><p><button class="btn small danger" id="lg-discard">刪除這台裝置的草稿，回到網站上的正式資料</button></p></details>
      </section>`;

    // 比賽切換
    document.getElementById('lg-match').onchange = e => { location.hash = '#/log/' + e.target.value; };

    // 計時
    app.querySelectorAll('[data-clk]').forEach(b => b.onclick = () => {
      const v = +b.dataset.clk;
      clearInterval(clock.timer);
      if (!v) { clock.start = null; document.getElementById('clk').textContent = "--'"; return; }
      clock.start = Date.now(); clock.half = v;
      const tick = () => { const c = document.getElementById('clk'); if (c) c.textContent = clockMinute(m) + "'"; };
      tick(); clock.timer = setInterval(tick, 5000);
    });

    // 先發
    app.querySelectorAll('.pchk input').forEach(cb => cb.onchange = () => {
      m.lineup = m.lineup || { starters: [] };
      m.lineup.starters = [...app.querySelectorAll('.pchk input:checked')].map(x => +x.value);
      if (!m.lineup.starters.length && !m.lineup.gk) m.lineup = null;
      document.getElementById('lg-lineup-h').textContent = `先發（${m.lineup ? m.lineup.starters.length : 0} 人）`;
      saveDraft(); renderEvents();
    });
    document.getElementById('lg-gk').onchange = e => {
      m.lineup = m.lineup || { starters: [] };
      m.lineup.gk = e.target.value ? +e.target.value : undefined;
      saveDraft();
    };

    // 新增事件表單
    let type = 'us';
    const form = document.getElementById('lg-form');
    const drawForm = () => {
      app.querySelectorAll('#lg-type button').forEach(b => b.classList.toggle('on', b.dataset.t === type));
      const min = clockMinute(m) || '';
      const minField = `<label class="field">分鐘 <input type="number" id="f-min" min="0" max="50" inputmode="numeric" value="${min}" required></label>`;
      form.innerHTML = {
        us: `${minField}<label class="field">進球 <select id="f-no">${optsPlayers('')}</select></label><label class="field">助攻 <select id="f-ast">${optsPlayers('')}</select></label>`,
        them: `${minField}<label class="field">對手進球者 <input id="f-pl" placeholder="姓名（可留空）"></label><label class="field">背號 <input id="f-pno" inputmode="numeric" placeholder="可留空"></label>`,
        sub: `${minField}<label class="field">上場 <select id="f-on">${optsPlayers('')}</select></label><label class="field">下場 <select id="f-off">${optsPlayers('')}</select></label>`,
        card: `${minField}<label class="field">隊伍 <select id="f-side"><option value="us">鳥仕</option><option value="them">對手</option></select></label><label class="field">球員 <select id="f-cno">${optsPlayers('')}</select></label><label class="field">牌 <select id="f-col"><option value="yellow">黃牌</option><option value="red">紅牌</option></select></label>`
      }[type] + `<button class="btn" id="f-add">新增</button>`;
      document.getElementById('f-add').onclick = () => {
        const min = +document.getElementById('f-min').value;
        if (!document.getElementById('f-min').value) { document.getElementById('f-min').focus(); return; }
        const v = s => (document.getElementById(s) || {}).value;
        let e;
        if (type === 'us') e = { min, type: 'goal', side: 'us', no: v('f-no') ? +v('f-no') : null, ...(v('f-ast') ? { assist: +v('f-ast') } : {}) };
        if (type === 'them') e = { min, type: 'goal', side: 'them', player: v('f-pl') || '', ...(v('f-pno') ? { no: v('f-pno') } : {}), cause: [] };
        if (type === 'sub') { if (!v('f-on') || !v('f-off')) return; e = { min, type: 'sub', on: +v('f-on'), off: +v('f-off') };  if (m.lineup) delete m.lineup.subsKnown; }
        if (type === 'card') e = { min, type: 'card', side: v('f-side'), no: v('f-cno') ? +v('f-cno') : null, color: v('f-col') };
        m.events.push(e);
        if (m.events.some(x => x.type === 'goal')) { m.status = 'played'; m.score = scoreOf(m); }
        saveDraft(); drawForm(); renderEvents();
      };
    };
    app.querySelectorAll('#lg-type button').forEach(b => b.onclick = () => { type = b.dataset.t; drawForm(); });
    drawForm();

    // 事件列表
    function renderEvents() {
      const box = document.getElementById('lg-events');
      const evs = sortEvents(m.events);
      const op = onPitch(m);
      const sc = scoreOf(m);
      document.getElementById('lg-score').textContent = `目前比分　鳥仕 ${sc.us} - ${sc.them} ${m.opponent}`;
      box.innerHTML = evs.length ? '' : '<p class="muted">還沒有事件</p>';
      evs.forEach(e => {
        const card = document.createElement('div');
        card.className = 'lg-ev ' + (e.side || '') + ' ' + e.type;
        const title = e.type === 'goal' ? (e.side === 'us' ? `⚽ ${pLabel(e.no)}` : `失球 ${e.player || ''}${e.no ? `（${e.no}）` : ''}`)
          : e.type === 'sub' ? `🔁 ${pname(e.on)} 上 / ${pname(e.off)} 下`
          : `${e.color === 'red' ? '🟥' : '🟨'} ${e.side === 'us' ? pLabel(e.no) : '對手'}`;
        card.innerHTML = `<div class="row"><input type="number" class="ev-min" value="${e.min}" aria-label="分鐘">'<strong>${esc(title)}</strong>
          <button class="btn small ghost danger ev-del" title="刪除">刪除</button></div>`;
        card.querySelector('.ev-min').onchange = ev => { e.min = +ev.target.value; saveDraft(); renderEvents(); };
        card.querySelector('.ev-del').onclick = () => { if (confirm('刪除這個事件？')) { m.events.splice(m.events.indexOf(e), 1); m.score = scoreOf(m); saveDraft(); renderEvents(); } };
        if (e.type === 'goal') {
          const extra = document.createElement('div');
          extra.className = 'ev-extra';
          const onList = op && op.perEvent.get(e);
          extra.innerHTML = `
            ${e.side === 'them' ? `<div class="causes">${CAUSES.map(c => `<label class="chip-chk"><input type="checkbox" value="${esc(c)}" ${(e.cause || []).includes(c) ? 'checked' : ''}>${esc(c)}</label>`).join('')}</div>
              <label class="chip-chk"><input type="checkbox" class="ev-tent" ${e.tentative ? 'checked' : ''}>只是初判，還沒逐格確認</label>` : ''}
            <label class="field">說明 <textarea class="ev-note" rows="2" placeholder="${e.side === 'them' ? '例：對方 7 號回接、我方中場沒跟，身後空檔被打穿' : '例：自家禁區斷球後 10 秒打到對方禁區'}">${esc(e.note || '')}</textarea></label>
            <div class="row"><label class="field">影片 <select class="ev-vh"><option value="">—</option><option value="1" ${e.video && e.video.half === 1 ? 'selected' : ''}>上半場</option><option value="2" ${e.video && e.video.half === 2 ? 'selected' : ''}>下半場</option></select></label>
            <label class="field">時間 <input class="ev-vt" placeholder="12:38" value="${esc(e.video ? e.video.t : '')}"></label></div>
            ${onList ? `<p class="small muted">當時在場：${onList.map(pname).join('、')}</p>` : ''}
            <button class="btn small ev-diag">${e.diagram ? '編輯站位圖' : '＋ 畫站位圖'}</button>
            <div class="ev-diag-box"></div>`;
          extra.querySelectorAll('.causes input').forEach(cb => cb.onchange = () => { e.cause = [...extra.querySelectorAll('.causes input:checked')].map(x => x.value); saveDraft(); });
          const tent = extra.querySelector('.ev-tent'); if (tent) tent.onchange = () => { if (tent.checked) e.tentative = true; else delete e.tentative; saveDraft(); };
          extra.querySelector('.ev-note').oninput = ev => { e.note = ev.target.value; saveDraft(); };
          const vh = extra.querySelector('.ev-vh'), vt = extra.querySelector('.ev-vt');
          const setV = () => { if (vh.value && vt.value) e.video = { half: +vh.value, t: vt.value.trim() }; else delete e.video; saveDraft(); };
          vh.onchange = setV; vt.oninput = setV;
          extra.querySelector('.ev-diag').onclick = btn => {
            const bx = extra.querySelector('.ev-diag-box');
            if (bx.childElementCount) { bx.innerHTML = ''; return; }
            if (!e.diagram) {
              e.diagram = { frames: [Pitch.blankFrame(onList ? orderGK(onList, m) : [])] };
              e.diagram.frames[0].us.forEach(p => { if (p.no !== '') p.name = pname(p.no); });
              saveDraft();
            }
            const holder = document.createElement('div');
            bx.appendChild(holder);
            Pitch.editor(holder, e.diagram, { onChange: () => saveDraft(), nameOf: pname });
            const rm = document.createElement('button');
            rm.className = 'btn small ghost danger'; rm.textContent = '刪除整張站位圖';
            rm.onclick = () => { if (confirm('刪除這張站位圖？')) { delete e.diagram; saveDraft(); renderEvents(); } };
            bx.appendChild(rm);
          };
          card.appendChild(extra);
        }
        box.appendChild(card);
      });
    }
    renderEvents();

    // 發佈
    const json = () => JSON.stringify(list, null, 2) + '\n';
    document.getElementById('lg-copy').onclick = async ev => {
      try { await navigator.clipboard.writeText(json()); ev.target.textContent = '已複製 ✓'; }
      catch { const ta = document.createElement('textarea'); ta.value = json(); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ev.target.textContent = '已複製 ✓'; }
      setTimeout(() => ev.target.textContent = '複製全部資料', 2500);
    };
    document.getElementById('lg-dl').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
      a.download = 'matches.json'; a.click();
    };
    document.getElementById('lg-discard').onclick = () => {
      if (!confirm('確定刪除這台裝置上的草稿？')) return;
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
  function route() {
    const hsh = location.hash || '#/';
    const [, page, arg] = hsh.split('/');
    window.scrollTo(0, 0);
    if (!page) return pageHome();
    if (page === 'matches') return pageMatches();
    if (page === 'm') return pageMatch(arg);
    if (page === 'players') return pagePlayers();
    if (page === 'board') return pageBoard();
    if (page === 'log') return pageLog(arg);
    pageHome();
  }

  async function boot() {
    try {
      const v = '?v=' + Date.now().toString(36).slice(0, -3);
      const [team, ms, boards] = await Promise.all(['data/team.json', 'data/matches.json', 'data/boards.json'].map(u => fetch(u + v).then(r => { if (!r.ok) throw new Error(u); return r.json(); })));
      D.team = team; D.published = ms; D.boards = boards;
      try { const d = store.get(DRAFT_KEY); if (d) D.draft = JSON.parse(d); } catch {}
      window.addEventListener('hashchange', route);
      route();
    } catch (err) {
      app.innerHTML = `<p class="card">資料載入失敗（${esc(err.message)}）。請重新整理。</p>`;
    }
  }
  boot();
})();
