// 2D 站位圖：繪製與編輯
// 座標：x 0–100（左→右），y 0–100（上＝對方球門，下＝鳥仕球門）
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 68, H = 100; // viewBox，約等於七人制 40m x 60m 的比例
  const sx = x => x * W / 100;
  const sy = y => y;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  let uid = 0;

  function drawField(svg) {
    const g = el('g', { class: 'pf-lines' }, svg);
    el('rect', { x: 0, y: 0, width: W, height: H, class: 'pf-grass' }, g);
    // 草紋
    for (let i = 0; i < 10; i += 2) el('rect', { x: 0, y: i * 10, width: W, height: 10, class: 'pf-stripe' }, g);
    const m = 2; // 邊線內縮
    el('rect', { x: m, y: m, width: W - 2 * m, height: H - 2 * m, class: 'pf-line' }, g);
    el('line', { x1: m, y1: H / 2, x2: W - m, y2: H / 2, class: 'pf-line' }, g);
    el('circle', { cx: W / 2, cy: H / 2, r: 6, class: 'pf-line' }, g);
    el('circle', { cx: W / 2, cy: H / 2, r: 0.6, class: 'pf-dot' }, g);
    const paW = W * 0.56, paD = 15, gaW = W * 0.3, gaD = 5.5, goalW = 9;
    [[m, 1], [H - m, -1]].forEach(([y0, dir]) => {
      const y = dir === 1 ? y0 : y0 - paD;
      el('rect', { x: (W - paW) / 2, y, width: paW, height: paD, class: 'pf-line' }, g);
      const yg = dir === 1 ? y0 : y0 - gaD;
      el('rect', { x: (W - gaW) / 2, y: yg, width: gaW, height: gaD, class: 'pf-line' }, g);
      el('circle', { cx: W / 2, cy: y0 + dir * 10, r: 0.6, class: 'pf-dot' }, g);
      el('rect', { x: (W - goalW) / 2, y: dir === 1 ? y0 - 1.6 : y0, width: goalW, height: 1.6, class: 'pf-goal' }, g);
    });
    const t1 = el('text', { x: W / 2, y: -1.6, class: 'pf-caption' }, svg); t1.textContent = '進攻方向 ↑';
    const t2 = el('text', { x: W / 2, y: H + 3.4, class: 'pf-caption' }, svg); t2.textContent = '鳥仕';
  }

  function defs(svg, id) {
    const d = el('defs', {}, svg);
    ['us', 'them'].forEach(side => {
      const mk = el('marker', { id: `${id}-ah-${side}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, d);
      el('path', { d: 'M0,0 L10,5 L0,10 z', class: `pf-head-${side}` }, mk);
    });
  }

  function drawArrows(svg, arrows, id) {
    const g = el('g', { class: 'pf-arrows' }, svg);
    (arrows || []).forEach((a, i) => {
      const side = a.side === 'them' ? 'them' : 'us';
      const line = el('line', {
        x1: sx(a.x1), y1: sy(a.y1), x2: sx(a.x2), y2: sy(a.y2),
        class: `pf-arrow pf-${a.kind || 'pass'} pf-arrow-${side}`,
        'marker-end': `url(#${id}-ah-${side})`, 'data-i': i
      }, g);
      const t = el('title', {}, line);
      t.textContent = { run: '跑位', pass: '傳球', shot: '射門', dribble: '帶球' }[a.kind] || '傳球';
    });
    return g;
  }

  function drawTokens(svg, board, opts) {
    const g = el('g', { class: 'pf-tokens' }, svg);
    const r = opts.small ? 2.6 : 2.9;
    (board.them || []).forEach((p, i) => token(g, p, 'them', i, r));
    (board.us || []).forEach((p, i) => token(g, p, 'us', i, r));
    if (board.ball) {
      const b = el('g', { class: 'pf-ball', 'data-side': 'ball', 'data-i': 0, transform: `translate(${sx(board.ball.x)},${sy(board.ball.y)})` }, g);
      el('circle', { r: 1.5, class: 'pf-ball-c' }, b);
      el('circle', { r: 0.55, class: 'pf-ball-d' }, b);
    }
    return g;
  }

  function token(g, p, side, i, r) {
    const t = el('g', { class: `pf-token pf-${side}${p.hl ? ' pf-hl' : ''}`, 'data-side': side, 'data-i': i, transform: `translate(${sx(p.x)},${sy(p.y)})` }, g);
    el('circle', { r: r + 1.6, class: 'pf-hit' }, t);
    el('circle', { r, class: 'pf-body' }, t);
    const tx = el('text', { class: 'pf-num', y: 0.15 }, t);
    tx.textContent = p.no != null && p.no !== '' ? p.no : '';
    if (p.label) {
      const lb = el('text', { class: 'pf-label', y: r + 2.6 }, t);
      lb.textContent = p.label;
    }
    const title = el('title', {}, t);
    title.textContent = (side === 'us' ? '鳥仕 ' : '對手 ') + (p.no != null ? '#' + p.no : '') + (p.name ? ' ' + p.name : '');
  }

  function render(container, board, opts = {}) {
    container.innerHTML = '';
    const id = 'pf' + (++uid);
    const svg = el('svg', { viewBox: `-1 -4.5 ${W + 2} ${H + 9}`, class: 'pitch-svg', role: 'img', 'aria-label': opts.label || '站位圖' });
    defs(svg, id);
    drawField(svg);
    drawArrows(svg, board.arrows, id);
    drawTokens(svg, board, opts);
    container.appendChild(svg);
    return { svg, id };
  }

  // ---------- 編輯器 ----------
  // diagram = { frames: [ { label, us, them, ball, arrows } ] }
  function editor(container, diagram, opts = {}) {
    const state = { frame: 0, mode: 'move', kind: 'pass', side: 'us', pending: null };
    const onChange = opts.onChange || (() => {});
    container.innerHTML = '';
    container.classList.add('pe');

    const bar = document.createElement('div'); bar.className = 'pe-frames';
    const tools = document.createElement('div'); tools.className = 'pe-tools';
    const stage = document.createElement('div'); stage.className = 'pe-stage pitch-wrap';
    const hint = document.createElement('p'); hint.className = 'pe-hint muted';
    container.append(bar, tools, stage, hint);

    const cur = () => diagram.frames[state.frame];

    function renderBar() {
      bar.innerHTML = '';
      diagram.frames.forEach((f, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (i === state.frame ? ' on' : '');
        b.textContent = f.label || `畫面 ${i + 1}`;
        b.onclick = () => { state.frame = i; state.pending = null; draw(); };
        bar.appendChild(b);
      });
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'chip ghost'; add.textContent = '＋ 下一格';
      add.onclick = () => {
        const copy = JSON.parse(JSON.stringify(cur()));
        copy.label = `畫面 ${diagram.frames.length + 1}`;
        copy.arrows = [];
        diagram.frames.push(copy); state.frame = diagram.frames.length - 1; changed();
      };
      bar.appendChild(add);
      if (diagram.frames.length > 1) {
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'chip ghost danger'; del.textContent = '刪除';
        del.onclick = () => { diagram.frames.splice(state.frame, 1); state.frame = Math.max(0, state.frame - 1); changed(); };
        bar.appendChild(del);
      }
    }

    function renderTools() {
      tools.innerHTML = `
        <label class="pe-field">標題 <input class="pe-label" value="${(cur().label || '').replace(/"/g, '&quot;')}" placeholder="例：傳身後球前"></label>
        <div class="seg" role="group" aria-label="模式">
          <button type="button" data-mode="move">拖曳球員</button>
          <button type="button" data-mode="arrow">畫箭頭</button>
          <button type="button" data-mode="erase">刪除箭頭</button>
        </div>
        <div class="seg pe-arrowopts" role="group" aria-label="箭頭種類">
          <button type="button" data-kind="pass">傳球</button>
          <button type="button" data-kind="run">跑位</button>
          <button type="button" data-kind="dribble">帶球</button>
          <button type="button" data-kind="shot">射門</button>
        </div>
        <div class="seg pe-arrowopts" role="group" aria-label="哪一隊">
          <button type="button" data-team="us">鳥仕</button>
          <button type="button" data-team="them">對手</button>
        </div>
        <div class="pe-row">
          <button type="button" class="btn small" data-act="addThem">＋ 對手</button>
          <button type="button" class="btn small" data-act="rmThem">－ 對手</button>
          <button type="button" class="btn small" data-act="resetUs">重設 3-2-1</button>
        </div>`;
      tools.querySelector('.pe-label').oninput = e => { cur().label = e.target.value; renderBar(); onChange(diagram); };
      tools.querySelectorAll('[data-mode]').forEach(b => {
        b.classList.toggle('on', b.dataset.mode === state.mode);
        b.onclick = () => { state.mode = b.dataset.mode; state.pending = null; renderTools(); draw(true); };
      });
      tools.querySelectorAll('[data-kind]').forEach(b => {
        b.classList.toggle('on', b.dataset.kind === state.kind);
        b.onclick = () => { state.kind = b.dataset.kind; renderTools(); };
      });
      tools.querySelectorAll("[data-team]").forEach(b => {
        b.classList.toggle("on", b.dataset.team === state.side);
        b.onclick = () => { state.side = b.dataset.team; renderTools(); };
      });
      tools.querySelectorAll('.pe-arrowopts').forEach(x => x.hidden = state.mode !== 'arrow');
      tools.querySelector('[data-act=addThem]').onclick = () => {
        const f = cur(); f.them = f.them || [];
        f.them.push({ no: '', x: 50, y: 40 }); changed();
      };
      tools.querySelector('[data-act=rmThem]').onclick = () => { const f = cur(); if (f.them && f.them.length) { f.them.pop(); changed(); } };
      tools.querySelector('[data-act=resetUs]').onclick = () => {
        const f = cur(); const base = Pitch.shape321();
        f.us = base.map((p, i) => ({ ...p, no: f.us && f.us[i] ? f.us[i].no : p.no, name: f.us && f.us[i] ? f.us[i].name : undefined }));
        changed();
      };
      hint.textContent = {
        move: '拖曳移動 · 點一下改背號',
        arrow: '點起點，再點終點',
        erase: '點箭頭刪除'
      }[state.mode];
    }

    function changed() { renderBar(); renderTools(); draw(); onChange(diagram); }

    function toPct(svg, evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: Math.max(0, Math.min(100, p.x * 100 / W)), y: Math.max(0, Math.min(100, p.y)) };
    }

    function draw() {
      const { svg } = render(stage, cur(), { label: '站位圖編輯' });
      svg.classList.add('editing', 'mode-' + state.mode);
      if (state.pending) {
        el('circle', { cx: sx(state.pending.x), cy: sy(state.pending.y), r: 1.2, class: 'pe-pending' }, svg);
      }
      let drag = null;
      svg.addEventListener('pointerdown', e => {
        const tok = e.target.closest('[data-side]');
        if (state.mode === 'move' && tok) {
          e.preventDefault();
          drag = { side: tok.dataset.side, i: +tok.dataset.i, node: tok, moved: false };
          svg.setPointerCapture(e.pointerId);
          return;
        }
        if (state.mode === 'erase') {
          const ln = e.target.closest('.pf-arrow');
          if (ln) { cur().arrows.splice(+ln.dataset.i, 1); changed(); }
          return;
        }
        if (state.mode === 'arrow') {
          const p = toPct(svg, e);
          if (!state.pending) { state.pending = p; draw(); }
          else {
            const f = cur(); f.arrows = f.arrows || [];
            f.arrows.push({ x1: r1(state.pending.x), y1: r1(state.pending.y), x2: r1(p.x), y2: r1(p.y), kind: state.kind, side: state.side });
            state.pending = null; changed();
          }
        }
      });
      svg.addEventListener('pointermove', e => {
        if (!drag) return;
        const p = toPct(svg, e);
        drag.moved = true;
        const f = cur();
        const obj = drag.side === 'ball' ? f.ball : f[drag.side][drag.i];
        obj.x = r1(p.x); obj.y = r1(p.y);
        drag.node.setAttribute('transform', `translate(${sx(obj.x)},${sy(obj.y)})`);
      });
      const end = () => {
        if (!drag) return;
        const d = drag; drag = null;
        if (!d.moved && d.side !== 'ball') {
          const f = cur(); const p = f[d.side][d.i];
          const v = prompt(d.side === 'us' ? '鳥仕球員背號' : '對手背號（可留空）', p.no ?? '');
          if (v !== null) { p.no = v.trim() === '' ? '' : (isNaN(+v) ? v.trim() : +v); if (opts.nameOf) p.name = opts.nameOf(p.no); }
          changed();
        } else onChange(diagram);
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
    }

    const r1 = v => Math.round(v * 10) / 10;
    if (!diagram.frames || !diagram.frames.length) diagram.frames = [blankFrame(opts.usNos)];
    renderBar(); renderTools(); draw();
    return { redraw: draw };
  }

  function shape321() {
    return [
      { no: '', x: 50, y: 93, role: 'GK' },
      { no: '', x: 24, y: 79 }, { no: '', x: 50, y: 81 }, { no: '', x: 76, y: 79 },
      { no: '', x: 35, y: 65 }, { no: '', x: 65, y: 65 },
      { no: '', x: 50, y: 52 }
    ];
  }

  function blankFrame(usNos) {
    const us = shape321();
    (usNos || []).slice(0, 7).forEach((n, i) => { us[i].no = n; });
    return {
      label: '畫面 1',
      us,
      them: [
        { no: '', x: 50, y: 60 }, { no: '', x: 30, y: 55 }, { no: '', x: 70, y: 55 },
        { no: '', x: 50, y: 40 }, { no: '', x: 25, y: 35 }, { no: '', x: 75, y: 35 }, { no: '', x: 50, y: 8 }
      ],
      ball: { x: 50, y: 63 },
      arrows: []
    };
  }

  window.Pitch = { render, editor, shape321, blankFrame };
})();
