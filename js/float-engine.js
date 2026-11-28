// ============================================================
// Float 引擎（iOS StandBy "Float" v3 规格）
// - 三层数字：.dig（槽位身份：颜色/倾斜/错落）> .dig-f（呼吸）> .dig-cell（可替换字符）
// - 冒号为独立双圆球组件，小数点为低存在感圆点，二者静止不参与滚动
// - 按位差分滚动；运行时测宽 fitFloatStage()；OLED 防烧屏像素微移
// ============================================================
(function (root) {
  const THD = root.THD;
  const PALETTES = THD.FLOAT_PALETTES;

  // ---------- 偏好持久化 ----------
  const prefs = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('thd_' + key);
        return v === null ? fallback : v;
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('thd_' + key, String(value)); } catch (e) { /* ignore */ }
    }
  };

  // ---------- 调色盘 ----------
  function pickRandomId() { return PALETTES[Math.floor(Math.random() * PALETTES.length)].id; }
  let paletteMode = prefs.get('palette', 'classic-blue'); // 具体 id 或 'random'
  if (!PALETTES.some(p => p.id === paletteMode) && paletteMode !== 'random') paletteMode = 'classic-blue';
  let resolvedId = paletteMode === 'random' ? pickRandomId() : paletteMode;

  function currentPalette() { return PALETTES.find(p => p.id === resolvedId) || PALETTES[0]; }

  /** 切换调色盘并即时重新着色所有已渲染的数字槽位 */
  function setPalette(mode) {
    paletteMode = mode;
    resolvedId = mode === 'random' ? pickRandomId() : mode;
    prefs.set('palette', mode);
    recolorAll();
  }
  function getPaletteMode() { return paletteMode; }

  function recolorAll() {
    const C = currentPalette().colors;
    document.querySelectorAll('.float-num').forEach(function (el) {
      let n = 0;
      for (const node of el.children) {
        if (node.classList.contains('dig')) { node.style.color = C[n % 4]; n++; }
      }
    });
  }

  // ---------- 渲染 ----------
  // 每个数字独立的倾斜角(deg)与垂直错落(em)，按槽位循环，刷新时保持一致
  const TILT = [-2.4, 1.6, -1.2, 2.2, -1.8, 1.4];
  const LIFT = [-0.04, 0.03, 0.045, -0.03, 0.035, -0.045];
  const COLON_HTML = '<span class="float-colon" aria-hidden="true"><span class="fc-dot"></span><span class="fc-dot"></span></span>';
  const DOT_HTML = '<span class="float-dot" aria-hidden="true"></span>';

  function floatHtml(str) {
    if (!str || str === '--') return '<span class="float-ph">--</span>';
    const C = currentPalette().colors;
    let html = '', n = 0;
    for (const ch of str) {
      if (ch >= '0' && ch <= '9') {
        const i = n % TILT.length;
        html += '<span class="dig" style="color:' + C[n % 4] + ';--t:' + TILT[i] + 'deg;--y:' + LIFT[i] + 'em">' +
          '<span class="dig-f" style="animation-delay:-' + (n * 0.9).toFixed(1) + 's">' +
          '<span class="dig-cell">' + ch + '</span></span></span>';
        n++;
      } else if (ch === ':') {
        html += COLON_HTML;
      } else if (ch === '.') {
        html += DOT_HTML;
      }
      // NOTE: 其余字符一律丢弃，Float 仅渲染数字/冒号/小数点，避免外部数据注入 HTML
    }
    return html;
  }

  // ---------- 按位差分滚动 ----------
  const slotState = new WeakMap();

  // 结算上一轮动画：清理定时器、落定进入字符、移除遗留字符，保证每槽位只有一个有效 .dig-cell
  function settleSlot(digF) {
    const st = slotState.get(digF);
    if (st) {
      st.done = true;
      if (st.timer) clearTimeout(st.timer);
      if (st.enter) st.enter.removeEventListener('animationend', st.onEnd);
      slotState.delete(digF);
    }
    const cells = digF.querySelectorAll('.dig-cell');
    for (let i = 0; i < cells.length - 1; i++) {
      if (cells[i].parentNode) cells[i].parentNode.removeChild(cells[i]);
    }
    const kept = cells[cells.length - 1];
    if (kept) {
      kept.className = 'dig-cell';
      kept.style.animationDelay = '';
    }
    return kept ? kept.textContent : '';
  }

  /**
   * 将 valEl 更新为 newStr。返回 'rebuilt' | 'rolled' | 'same'
   * 'rebuilt' 时字符数量可能变化，调用方需要重新测宽（fitFloatStage）
   */
  function updateFloat(valEl, newStr) {
    const slots = []; // 与字符索引一一对应：数字位 -> .dig-f，冒号/小数点 -> null
    let oldStr = '';
    for (const node of valEl.children) {
      if (node.classList.contains('dig')) {
        const digF = node.querySelector('.dig-f');
        slots.push(digF);
        oldStr += digF ? settleSlot(digF) : '';
      } else if (node.classList.contains('float-colon')) {
        slots.push(null); oldStr += ':';
      } else if (node.classList.contains('float-dot')) {
        slots.push(null); oldStr += '.';
      } else {
        slots.push(null); oldStr += node.textContent;
      }
    }
    const rebuild = function () { valEl.innerHTML = floatHtml(newStr); return 'rebuilt'; };

    if (!oldStr || oldStr === '--' || newStr === '--' || oldStr.length !== newStr.length) return rebuild();
    if (oldStr === newStr) return 'same';

    // 方向：去掉非数字字符后比较数值
    const up = Number(newStr.replace(/\D/g, '')) > Number(oldStr.replace(/\D/g, ''));
    const changed = [];
    for (let i = 0; i < newStr.length; i++) if (oldStr[i] !== newStr[i]) changed.push(i);
    // 结构性变化（数字位变成分隔符等）无法差分，整体重建
    if (changed.some(i => !slots[i])) return rebuild();
    changed.sort((a, b) => b - a); // 低位 → 高位（右 → 左）

    changed.forEach(function (idx, k) {
      const digF = slots[idx];
      const exitCell = digF.querySelector('.dig-cell:not(.dig-enter)');
      if (!exitCell) return;
      const delay = k * 0.04; // 40ms 交错

      const enterCell = document.createElement('span');
      enterCell.className = 'dig-cell dig-enter ' + (up ? 'roll-in-up' : 'roll-in-down');
      enterCell.textContent = newStr[idx];
      enterCell.style.animationDelay = delay + 's';
      exitCell.classList.add('dig-exit', up ? 'roll-out-up' : 'roll-out-down');
      exitCell.style.animationDelay = delay + 's';
      digF.appendChild(enterCell);

      const st = { enter: enterCell, done: false, timer: null, onEnd: null };
      const cleanup = function (e) {
        if (e && e.target !== enterCell) return;
        if (st.done) return;
        settleSlot(digF);
      };
      st.onEnd = cleanup;
      enterCell.addEventListener('animationend', cleanup);
      st.timer = setTimeout(cleanup, 700 + delay * 1000); // 兜底：动画被中断（切后台）时仍清理
      slotState.set(digF, st);
    });
    return 'rolled';
  }

  // ---------- 运行时测宽拟合 ----------
  // 背景：iOS 真机 SF Pro Rounded 比测试字体更宽，固定 vw/vh 公式必然溢出（规格 3.2 禁止）。
  // 做法：100px 基准测宽 → 按可用宽度/高度换算 → 实测边界再收敛 2 次。
  function fitOne(el) {
    const stage = el.closest('.clock-stage');
    if (!stage) return;
    const cs = getComputedStyle(stage);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const limitL = padL;
    const limitR = window.innerWidth - padR;
    const avail = limitR - limitL;
    if (avail <= 0) return;

    el.style.fontSize = '100px';
    const baseW = el.getBoundingClientRect().width;
    if (!baseW) return;
    let target = 100 * avail / baseW;
    // 倒计时上方有标签，高度占比收紧
    const hFrac = el.classList.contains('cd-time') ? 0.58 : 0.74;
    target = Math.min(target, window.innerHeight * hFrac / 0.88);
    target = Math.max(28, Math.floor(target));
    el.style.fontSize = target + 'px';

    for (let i = 0; i < 2; i++) {
      let minL = Infinity, maxR = -Infinity;
      el.querySelectorAll('.dig, .float-colon, .float-dot').forEach(function (n) {
        const r = n.getBoundingClientRect();
        if (r.left < minL) minL = r.left;
        if (r.right > maxR) maxR = r.right;
      });
      if (!isFinite(minL)) break;
      const span = maxR - minL;
      if (span <= avail && minL >= limitL - 1 && maxR <= limitR + 1) break;
      const cur = parseFloat(getComputedStyle(el).fontSize);
      el.style.fontSize = Math.max(28, Math.floor(cur * avail / span * 0.99)) + 'px';
    }
  }

  function fitFloatStage() {
    document.querySelectorAll('#clock-view .float-num[data-fit]').forEach(fitOne);
  }

  // ---------- OLED 防烧屏：每 3 分钟在 ±4px 内沿 8 点轨道微移（规格 4.3） ----------
  const ORBIT = [[0, 0], [3, 2], [4, 0], [3, -3], [0, -4], [-3, -3], [-4, 0], [-3, 2]];
  let orbitIdx = 0, orbitTimer = null;
  function startBurnInShift() {
    if (orbitTimer) return;
    orbitTimer = setInterval(function () {
      orbitIdx = (orbitIdx + 1) % ORBIT.length;
      document.documentElement.style.setProperty('--burn-x', ORBIT[orbitIdx][0] + 'px');
      document.documentElement.style.setProperty('--burn-y', ORBIT[orbitIdx][1] + 'px');
    }, 180000);
  }

  window.addEventListener('resize', fitFloatStage);
  window.addEventListener('orientationchange', function () { setTimeout(fitFloatStage, 120); });
  // 字体异步加载完成后必须重测：首屏可能用后备字体，真实字体通常更宽
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { setTimeout(fitFloatStage, 50); });
  }
  window.addEventListener('load', function () { setTimeout(fitFloatStage, 150); });

  THD.prefs = prefs;
  THD.Float = {
    floatHtml, updateFloat, fitFloatStage, setPalette, getPaletteMode, currentPalette,
    startBurnInShift
  };
})(self);
