// 2D 站位圖：繪製、切換動畫與編輯
// 座標：x 0–100（左→右），y 0–100（上＝對方球門，下＝鳥仕球門）
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 68, H = 100;
  const sx = x => x * W / 100;
  const sy = y => y;
  const R = 2.9;
  const KIND = { run: '跑位', pass: '傳球', shot: '射門', dribble: '帶球' };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const place = (node, x, y) => { node.style.transform = `translate(${sx(x)}px, ${sy(y)}px)`; };

  let uid = 0;

  function drawField(svg) {
    const g = el('g', { class: 'pf-lines' }, svg);
    el('rect', { x: 0, y: 0, width: W, height: H, class: 'pf-grass' }, g);
    for (let i = 0; i < 10; i += 2) el('rect', { x: 0, y: i * 10, width: W, height: 10, class: 'pf-stripe' }, g);
    const m = 2;
    el('rect', { x: m, y: m, width: W - 2 * m, height: H - 2 * m, class: 'pf-line' }, g);
    el('line', { x1: m, y1: H / 2, x2: W - m, y2: H / 2, class: 'pf-line' }, g);
    el('circle', { cx: W / 2, cy: H / 2, r: 6, class: 'pf-line' }, g);
    el('circle', { cx: W / 2, cy: H / 2, r: 0.6, class: 'pf-dot' }, g);
    const paW = W * 0.56, paD = 15, gaW = W * 0.3, gaD = 5.5, goalW = 9;
    [[m, 1], [H - m, -1]].forEach(([y0, dir]) => {
      el('rect', { x: (W - paW) / 2, y: dir === 1 ? y0 : y0 - paD, width: paW, height: paD, class: 'pf-line' }, g);
      el('rect', { x: (W - gaW) / 2, y: dir === 1 ? y0 : y0 - gaD, width: gaW, height: gaD, class: 'pf-line' }, g);
      el('circle', { cx: W / 2, cy: y0 + dir * 10, r: 0.6, class: 'pf-dot' }, g);
      el('rect', { x: (W - goalW) / 2, y: dir === 1 ? y0 - 1.6 : y0, width: goalW, height: 1.6, class: 'pf-goal' }, g);
    });
    el('text', { x: W / 2, y: -1.6, class: 'pf-caption' }, svg).textContent = '進攻方向 ↑';
    el('text', { x: W / 2, y: H + 3.6, class: 'pf-caption' }, svg).textContent = '鳥仕';
  }

  function defs(svg, id) {
    const d = el('defs', {}, svg);
    ['us', 'them'].forEach(side => {
      const mk = el('marker', { id: `${id}-ah-${side}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, d);
      el('path', { d: 'M0,0 L10,5 L0,10 z', class: `pf-head-${side}` }, mk);
    });
  }

  function drawArrows(svg, arrows, id, editing) {
    const g = el('g', { class: 'pf-arrows' });
    const tokens = svg.querySelector('.pf-tokens');
    svg.insertBefore(g, tokens || null);
    (arrows || []).forEach((a, i) => {
      const side = a.side === 'them' ? 'them' : 'us';
      const pts = { x1: sx(a.x1), y1: sy(a.y1), x2: sx(a.x2), y2: sy(a.y2) };
      const line = el('line', { ...pts, class: `pf-arrow pf-${a.kind || 'pass'} pf-arrow-${side}`, 'marker-end': `url(#${id}-ah-${side})`, 'data-i': i }, g);
      el('title', {}, line).textContent = KIND[a.kind] || '傳球';
      if (editing) el('line', { ...pts, class: 'pf-arrow-hit', 'data-i': i }, g);
    });
    return g;
  }

  function token(g, p, side, i) {
    const t = el('g', { class: `pf-token pf-${side}${p.hl ? ' pf-hl' : ''}`, 'data-side': side, 'data-i': i }, g);
    place(t, p.x, p.y);
    el('circle', { r: R + 1.6, class: 'pf-hit' }, t);
    el('circle', { r: R, class: 'pf-body' }, t);
    el('text', { class: 'pf-num', y: 0.15 }, t).textContent = p.no != null && p.no !== '' ? p.no : '';
    if (p.label) el('text', { class: 'pf-label', y: R + 3.1 }, t).textContent = p.label;
    el('title', {}, t).textContent = (side === 'us' ? '鳥仕' : '對手') + (p.no !== '' && p.no != null ? ' #' + p.no : '') + (p.name ? ' ' + p.name : '');
    return t;
  }

  function ball(g, b) {
    const n = el('g', { class: 'pf-ball', 'data-side': 'ball', 'data-i': 0 }, g);
    place(n, b.x, b.y);
    el('circle', { r: 4, class: 'pf-hit' }, n);
    el('circle', { r: 1.5, class: 'pf-ball-c' }, n);
    el('circle', { r: 0.55, class: 'pf-ball-d' }, n);
    return n;
  }

  function drawTokens(svg, board) {
    const g = el('g', { class: 'pf-tokens' }, svg);
    (board.them || []).forEach((p, i) => token(g, p, 'them', i));
    (board.us || []).forEach((p, i) => token(g, p, 'us', i));
    if (board.ball) ball(g, board.ball);
    return g;
  }

  function render(container, board, opts = {}) {
    container.innerHTML = '';
    const id = 'pf' + (++uid);
    const svg = el('svg', { viewBox: `-1 -4.5 ${W + 2} ${H + 9}`, class: 'pitch-svg', role: 'img', 'aria-label': opts.label || '站位圖' });
    svg.dataset.pid = id;
    defs(svg, id);
    drawField(svg);
    drawTokens(svg, board);
    drawArrows(svg, board.arrows, id, opts.editing);
    container.appendChild(svg);
    return { svg, id };
  }

  // 切換畫面：球員滑到新位置
  function update(svg, frame) {
    const id = svg.dataset.pid;
    const g = svg.querySelector('.pf-tokens');
    ['us', 'them'].forEach(side => {
      const list = frame[side] || [];
      const nodes = [...g.querySelectorAll(`.pf-token[data-side="${side}"]`)];
      list.forEach((p, i) => {
        let n = nodes[i];
        if (!n) { n = token(g, p, side, i); n.classList.add('enter'); return; }
        place(n, p.x, p.y);
        n.querySelector('.pf-num').textContent = p.no != null && p.no !== '' ? p.no : '';
        const lb = n.querySelector('.pf-label');
        if (p.label) { if (lb) lb.textContent = p.label; else el('text', { class: 'pf-label', y: R + 3.1 }, n).textContent = p.label; }
        else if (lb) lb.remove();
      });
      nodes.slice(list.length).forEach(n => n.remove());
    });
    const b = g.querySelector('.pf-ball');
    if (frame.ball) { if (b) place(b, frame.ball.x, frame.ball.y); else ball(g, frame.ball); }
    else if (b) b.remove();
    const old = svg.querySelector('.pf-arrows');
    if (old) old.remove();
    drawArrows(svg, frame.arrows, id).classList.add('enter');
  }

  // ---------- 編輯器 ----------
  function editor(container, diagram, opts = {}) {
    const state = { frame: 0, mode: 'move', kind: 'pass', side: 'us', pending: null };
    const onChange = opts.onChange || (() => {});
    container.innerHTML = '';
    container.classList.add('pe');
    const bar = document.createElement('div'); bar.className = 'pe-frames';
    const tools = document.createElement('div'); tools.className = 'pe-tools';
    const stage = document.createElement('div'); stage.className = 'pitch-wrap';
    container.append(bar, tools, stage);
    const cur = () => diagram.frames[state.frame];
    const r1 = v => Math.round(v * 10) / 10;

    function renderBar() {
      bar.innerHTML = '';
      diagram.frames.forEach((f, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (i === state.frame ? ' on' : '');
        b.textContent = f.label || `畫面 ${i + 1}`;
        b.onclick = () => { state.frame = i; state.pending = null; renderBar(); renderTools(); draw(); };
        bar.appendChild(b);
      });
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'chip ghost'; add.textContent = '＋ 畫面';
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
        del.onclick = () => {
          if (!confirm('刪除此畫面？')) return;
          diagram.frames.splice(state.frame, 1); state.frame = Math.max(0, state.frame - 1); changed();
        };
        bar.appendChild(del);
      }
    }

    function renderTools() {
      const q = s => String(s || '').replace(/"/g, '&quot;');
      tools.innerHTML = `
        <label class="pe-field">標題 <input class="pe-label" value="${q(cur().label)}" placeholder="例：身後球"></label>
        <div class="seg" role="group" aria-label="模式">
          <button type="button" data-mode="move">移動</button>
          <button type="button" data-mode="arrow">箭頭</button>
          <button type="button" data-mode="erase">刪箭頭</button>
        </div>
        <div class="seg pe-arrowopts" role="group" aria-label="箭頭種類">
          ${Object.entries({ pass: '傳球', run: '跑位', dribble: '帶球', shot: '射門' }).map(([k, t]) => `<button type="button" data-kind="${k}">${t}</button>`).join('')}
        </div>
        <div class="seg pe-arrowopts" role="group" aria-label="隊伍">
          <button type="button" data-team="us">鳥仕</button><button type="button" data-team="them">對手</button>
        </div>
        <div class="pe-row">
          <button type="button" class="btn small ghost" data-act="addThem">＋ 對手</button>
          <button type="button" class="btn small ghost" data-act="rmThem">－ 對手</button>
          <button type="button" class="btn small ghost" data-act="resetUs">重設站位</button>
        </div>`;
      tools.querySelector('.pe-label').oninput = e => { cur().label = e.target.value; renderBar(); onChange(diagram); };
      tools.querySelectorAll('[data-mode]').forEach(b => {
        b.classList.toggle('on', b.dataset.mode === state.mode);
        b.onclick = () => { state.mode = b.dataset.mode; state.pending = null; renderTools(); draw(); };
      });
      tools.querySelectorAll('[data-kind]').forEach(b => {
        b.classList.toggle('on', b.dataset.kind === state.kind);
        b.onclick = () => { state.kind = b.dataset.kind; renderTools(); };
      });
      tools.querySelectorAll('[data-team]').forEach(b => {
        b.classList.toggle('on', b.dataset.team === state.side);
        b.onclick = () => { state.side = b.dataset.team; renderTools(); };
      });
      tools.querySelectorAll('.pe-arrowopts').forEach(x => x.hidden = state.mode !== 'arrow');
      tools.querySelector('[data-act=addThem]').onclick = () => { const f = cur(); f.them = f.them || []; f.them.push({ no: '', x: 50, y: 40 }); changed(); };
      tools.querySelector('[data-act=rmThem]').onclick = () => { const f = cur(); if (f.them && f.them.length) { f.them.pop(); changed(); } };
      tools.querySelector('[data-act=resetUs]').onclick = () => {
        const f = cur(); const base = shape321();
        f.us = base.map((p, i) => ({ ...p, no: f.us && f.us[i] ? f.us[i].no : p.no, name: f.us && f.us[i] ? f.us[i].name : undefined }));
        changed();
      };
    }

    function changed() { renderBar(); renderTools(); draw(); onChange(diagram); }

    function toPct(svg, evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: Math.max(0, Math.min(100, p.x * 100 / W)), y: Math.max(0, Math.min(100, p.y)) };
    }

    function draw() {
      const { svg } = render(stage, cur(), { label: '站位圖編輯', editing: true });
      svg.classList.add('editing', 'mode-' + state.mode);
      if (state.pending) el('circle', { cx: sx(state.pending.x), cy: sy(state.pending.y), r: 1.2, class: 'pe-pending' }, svg);
      let drag = null;
      svg.addEventListener('pointerdown', e => {
        const tok = e.target.closest('[data-side]');
        if (state.mode === 'move' && tok) {
          e.preventDefault();
          const f = cur(), side = tok.dataset.side, i = +tok.dataset.i;
          const obj = side === 'ball' ? f.ball : f[side][i];
          const p = toPct(svg, e);
          drag = { side, i, node: tok, obj, moved: false, x0: e.clientX, y0: e.clientY, dx: obj.x - p.x, dy: obj.y - p.y };
          svg.setPointerCapture(e.pointerId);
          return;
        }
        if (state.mode === 'erase') {
          const ln = e.target.closest('.pf-arrow, .pf-arrow-hit');
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
        if (!drag.moved) {
          if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) <= 6) return;
          drag.moved = true;
          drag.node.parentNode.appendChild(drag.node);
          drag.node.classList.add('dragging');
        }
        const p = toPct(svg, e);
        drag.obj.x = r1(Math.max(0, Math.min(100, p.x + drag.dx)));
        drag.obj.y = r1(Math.max(0, Math.min(100, p.y + drag.dy)));
        place(drag.node, drag.obj.x, drag.obj.y);
      });
      const end = () => {
        if (!drag) return;
        const d = drag; drag = null;
        d.node.classList.remove('dragging');
        if (!d.moved && d.side !== 'ball') {
          const v = prompt(d.side === 'us' ? '背號' : '對手背號', d.obj.no ?? '');
          if (v !== null) { d.obj.no = v.trim() === '' ? '' : (isNaN(+v) ? v.trim() : +v); if (opts.nameOf && d.side === 'us') d.obj.name = opts.nameOf(d.obj.no); }
          changed();
        } else onChange(diagram);
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
    }

    if (!diagram.frames || !diagram.frames.length) diagram.frames = [blankFrame(opts.usNos)];
    renderBar(); renderTools(); draw();
    return { redraw: draw };
  }

  function shape321() {
    return [
      { no: '', x: 50, y: 93 },
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
      ball: { x: 54, y: 70 },
      arrows: []
    };
  }

  window.Pitch = { render, update, editor, shape321, blankFrame };
})();
