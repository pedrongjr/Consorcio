/* Gráficos SVG leves (sem dependências), com tooltip ao passar o dedo/mouse. */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  var tip;
  function tooltip() {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'status');
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(evt, html) {
    var t = tooltip();
    t.innerHTML = html;
    t.style.display = 'block';
    var x = evt.clientX, y = evt.clientY;
    var w = t.offsetWidth, h = t.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
    var top = y - h - 14;
    if (top < 8) top = y + 18;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }
  document.addEventListener('scroll', hideTip, { passive: true });

  /** Passo "redondo" (1, 2, 5 × 10^n) para no máximo 4 intervalos. */
  function niceStep(max) {
    if (max <= 0) return 1;
    var raw = max / 4;
    var exp = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / exp;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
  }

  function bindHover(target, html) {
    target.addEventListener('pointerenter', function (e) { showTip(e, html); });
    target.addEventListener('pointermove', function (e) { showTip(e, html); });
    target.addEventListener('pointerleave', hideTip);
    target.addEventListener('pointerdown', function (e) { showTip(e, html); });
  }

  /**
   * Barras verticais.
   * opts: { data:[{label, value, tip}], format(v), axisFormat(v), color, height,
   *         refs:[{value, label, cls}], highlight(i) -> bool, labelEvery }
   */
  function bars(container, opts) {
    container.innerHTML = '';
    var W = Math.max(260, container.clientWidth || 320);
    var H = opts.height || 200;
    var m = { t: 16, r: 8, b: 26, l: 52 };
    var data = opts.data;
    var maxV = 0;
    data.forEach(function (d) { maxV = Math.max(maxV, d.value); });
    (opts.refs || []).forEach(function (r) { maxV = Math.max(maxV, r.value); });
    var stepV = niceStep(maxV * 1.05);
    var nTicks = Math.max(1, Math.ceil((maxV * 1.05) / stepV));
    var top = stepV * nTicks;
    var ih = H - m.t - m.b, iw = W - m.l - m.r;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': opts.ariaLabel || '' }, container);
    var y = function (v) { return m.t + ih - (v / top) * ih; };
    var fmtAxis = opts.axisFormat || opts.format;

    for (var g = 0; g <= nTicks; g++) {
      var v = stepV * g;
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: g === 0 ? 'axis' : 'grid' }, svg);
      var t = el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, svg);
      t.textContent = fmtAxis(v);
    }

    var step = iw / data.length;
    var bw = Math.max(4, Math.min(48, step - 2));
    var every = opts.labelEvery || Math.ceil(data.length / Math.floor(iw / 44));
    data.forEach(function (d, i) {
      var x = m.l + i * step + (step - bw) / 2;
      var h = Math.max(0, m.t + ih - y(d.value));
      var r = Math.min(4, bw / 2, h);
      // Barra com topo arredondado e base reta, ancorada no eixo.
      var y0 = m.t + ih, y1 = y0 - h;
      var path = 'M' + x + ',' + y0 + 'V' + (y1 + r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 +
        'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y1 + ' ' + (x + bw) + ',' + (y1 + r) + 'V' + y0 + 'Z';
      var cls = 'bar' + (opts.highlight && opts.highlight(i) ? ' bar-hl' : '');
      el('path', { d: path, class: cls, style: opts.color ? 'fill:' + opts.color : '' }, svg);
      var hit = el('rect', { x: m.l + i * step, y: m.t, width: step, height: ih, class: 'hit' }, svg);
      bindHover(hit, d.tip || (d.label + ': <b>' + opts.format(d.value) + '</b>'));
      if ((data.length - 1 - i) % every === 0) {
        var lt = el('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'tick' }, svg);
        lt.textContent = d.label;
      }
    });

    // Rótulos das linhas de referência alternam entre esquerda e direita para não se sobreporem.
    (opts.refs || []).forEach(function (r, i) {
      var yy = y(r.value);
      var left = i % 2 === 0;
      el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: 'ref ' + (r.cls || '') }, svg);
      var tt = el('text', { x: left ? m.l + 4 : W - m.r - 2, y: yy - 5, 'text-anchor': left ? 'start' : 'end', class: 'ref-label ' + (r.cls || '') }, svg);
      tt.textContent = r.label;
    });
    return svg;
  }

  /**
   * Barras horizontais empilhadas (uma por linha).
   * rows: [{label, segments:[{value, label, color}]}], format(v)
   */
  function hstack(container, rows, format, opts) {
    opts = opts || {};
    container.innerHTML = '';
    var W = Math.max(260, container.clientWidth || 320);
    var rowH = opts.rowHeight || 22, gap = 30, labelH = 18;
    var H = rows.length * (rowH + labelH) + (rows.length - 1) * (gap - labelH) + 4;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': opts.ariaLabel || '' }, container);
    var maxT = 0;
    rows.forEach(function (r) {
      r.total = r.segments.reduce(function (a, s) { return a + s.value; }, 0);
      maxT = Math.max(maxT, r.total);
    });
    var yy = 0;
    rows.forEach(function (r) {
      if (r.label) {
        var t = el('text', { x: 0, y: yy + 13, class: 'row-label' }, svg);
        t.textContent = r.label;
        var tv = el('text', { x: W, y: yy + 13, 'text-anchor': 'end', class: 'row-value' }, svg);
        tv.textContent = format(r.total);
        yy += labelH;
      }
      var x = 0;
      var scale = (opts.fullWidth ? W / (r.total || 1) : W / (maxT || 1));
      var segs = r.segments.filter(function (s) { return s.value > 0; });
      segs.forEach(function (s, i) {
        var w = s.value * scale;
        var gapPx = i < segs.length - 1 ? 2 : 0;
        var rect = el('rect', {
          x: x, y: yy, width: Math.max(1, w - gapPx), height: rowH,
          rx: (i === 0 || i === segs.length - 1) ? 4 : 0, style: 'fill:' + s.color
        }, svg);
        bindHover(rect, s.label + ': <b>' + format(s.value) + '</b>');
        x += w;
      });
      yy += rowH + (gap - labelH);
    });
    return svg;
  }

  root.Charts = { bars: bars, hstack: hstack, hideTip: hideTip };
})(window);
