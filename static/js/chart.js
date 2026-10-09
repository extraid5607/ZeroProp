// Chart wrappers around TradingView Lightweight Charts (loaded as a global from /vendor/).
import { cssVar } from './util.js';

const LWC = () => window.LightweightCharts;

function baseOptions() {
  return {
    autoSize: true,
    // Pin the locale. By default the library reads navigator.language, and a browser that
    // reports an odd tag (for example "en-US@posix") makes it throw and draw an empty chart.
    localization: { locale: 'en-US' },
    layout: {
      background: { type: 'solid', color: cssVar('--chart-bg') },
      textColor: cssVar('--ink-2'),
      fontFamily: cssVar('--font') || 'sans-serif',
      fontSize: 12,
    },
    grid: {
      vertLines: { color: cssVar('--grid') },
      horzLines: { color: cssVar('--grid') },
    },
    rightPriceScale: { borderColor: cssVar('--line'), scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: cssVar('--line'), timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: {
      mode: LWC().CrosshairMode.Normal,
      vertLine: { color: cssVar('--ink-3'), labelBackgroundColor: cssVar('--ink') },
      horzLine: { color: cssVar('--ink-3'), labelBackgroundColor: cssVar('--ink') },
    },
  };
}

function candleOptions(market) {
  const dec = market ? market.decimals : 2;
  return {
    upColor: cssVar('--chart-up'), downColor: cssVar('--chart-down'),
    wickUpColor: cssVar('--chart-up'), wickDownColor: cssVar('--chart-down'),
    borderVisible: false,
    priceFormat: { type: 'price', precision: dec, minMove: Math.pow(10, -dec) },
  };
}

export function createPriceChart(container) {
  const chart = LWC().createChart(container, baseOptions());
  const series = chart.addSeries(LWC().CandlestickSeries, candleOptions(null));
  let current = null;       // the market the series is formatted for
  let tfSeconds = 900;
  let last = null;          // last candle (mutated by live ticks)
  let lines = new Map();    // key -> price line handle
  let lineSpec = new Map(); // key -> JSON of last applied options (to avoid churn)

  // Interactive overlay container for movable SL/TP handles
  const overlay = document.createElement('div');
  overlay.className = 'chart-overlay';
  container.appendChild(overlay);

  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'chart-drag-tooltip';
  tooltipEl.style.display = 'none';
  overlay.appendChild(tooltipEl);

  let onMoveLineCb = null;
  let isDragging = false;
  let dragKey = null;
  const handleMap = new Map(); // key -> { el, hitline, priceEl, spec }

  function toBar(r) { return { time: Math.floor(r[0]), open: r[1], high: r[2], low: r[3], close: r[4] }; }

  function calcPnl(market, side, entry, targetPrice, qty) {
    if (!entry || !targetPrice || !qty) return null;
    let pnl = 0;
    if (market && market.kind === 'usd_base') {
      pnl = side === 'long' ? ((targetPrice - entry) / targetPrice) * qty : ((entry - targetPrice) / targetPrice) * qty;
    } else {
      pnl = side === 'long' ? (targetPrice - entry) * qty : (entry - targetPrice) * qty;
    }
    const pct = ((targetPrice - entry) / entry) * 100 * (side === 'long' ? 1 : -1);
    return { pnl, pct };
  }

  function roundPrice(p) {
    const dec = current ? current.decimals : 2;
    return Number(Number(p).toFixed(dec));
  }

  function formatPrice(p) {
    const dec = current ? current.decimals : 2;
    return Number(p).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function clampPrice(spec, price) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return p;
    const side = spec.posSide || (spec.key.includes('long') ? 'long' : 'short');
    const entry = spec.entry;
    const liq = spec.liq;
    const type = spec.type;
    const lastP = (last && last.close) ? last.close : entry;

    if (type === 'sl' || type === 'draft-sl') {
      if (side === 'long') {
        const max = lastP ? lastP * 0.9998 : (entry || p);
        const min = liq ? liq * 1.0005 : p * 0.5;
        return Math.max(min, Math.min(max, p));
      } else {
        const min = lastP ? lastP * 1.0002 : (entry || p);
        const max = liq ? liq * 0.9995 : p * 1.5;
        return Math.max(min, Math.min(max, p));
      }
    } else if (type === 'tp' || type === 'draft-tp') {
      if (side === 'long') {
        const min = lastP ? lastP * 1.0002 : (entry || p);
        return Math.max(min, p);
      } else {
        const max = lastP ? lastP * 0.9998 : (entry || p);
        return Math.min(max, p);
      }
    }
    return p;
  }

  function showTooltip(spec, priceVal, posX, posY) {
    if (!tooltipEl) return;
    const isSl = spec.type === 'sl' || spec.type === 'draft-sl';
    const isTp = spec.type === 'tp' || spec.type === 'draft-tp';
    const titleText = isSl ? 'Stop-Loss' : isTp ? 'Target (Take-Profit)' : 'Price Level';
    const pnlInfo = spec.entry && spec.qty ? calcPnl(current, spec.posSide, spec.entry, priceVal, spec.qty) : null;
    const pnlStr = pnlInfo ? `${pnlInfo.pnl >= 0 ? '+' : ''}$${Math.abs(pnlInfo.pnl).toFixed(2)} (${pnlInfo.pct >= 0 ? '+' : ''}${pnlInfo.pct.toFixed(2)}%)` : '';
    const toneCls = pnlInfo ? (pnlInfo.pnl >= 0 ? 'up' : 'down') : '';

    tooltipEl.innerHTML = `
      <div class="drag-tt-head ${isSl ? 'down' : 'up'}">⇕ ${titleText}</div>
      <div class="drag-tt-body">
        <span class="drag-tt-price">${formatPrice(priceVal)}</span>
        ${pnlStr ? `<span class="drag-tt-pnl ${toneCls}">${pnlStr}</span>` : ''}
      </div>
      <div class="drag-tt-hint">Drag up/down or scroll wheel · Release to set</div>
    `;

    const y = series.priceToCoordinate(priceVal);
    const boxRect = container.getBoundingClientRect();
    const finalX = posX !== undefined ? Math.max(90, Math.min(boxRect.width - 120, posX)) : Math.max(120, boxRect.width - 190);
    const finalY = posY !== undefined ? Math.max(30, posY) : (y !== null ? Math.max(30, y) : 100);

    tooltipEl.style.display = 'flex';
    tooltipEl.style.left = `${finalX}px`;
    tooltipEl.style.top = `${finalY}px`;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  let wheelTimer = null;
  let wheelPending = null;

  function onWheelAdjust(spec, deltaY, ev) {
    const dec = current ? current.decimals : 2;
    const baseP = (wheelPending && wheelPending.key === spec.key) ? wheelPending.price : spec.price;
    const minStep = Math.pow(10, -dec);
    const dynStep = Math.max(minStep, baseP * 0.0005);
    const step = ev.shiftKey ? dynStep * 5 : dynStep;
    const rawNew = deltaY < 0 ? baseP + step : baseP - step;
    const clamped = roundPrice(clampPrice(spec, rawNew));

    wheelPending = { key: spec.key, spec, price: clamped };

    if (lines.has(spec.key)) {
      lines.get(spec.key).applyOptions({ price: clamped, title: `${spec.title}: ${formatPrice(clamped)}` });
    }
    updateHandlePos(spec.key, clamped);
    const hData = handleMap.get(spec.key);
    if (hData && hData.priceEl) hData.priceEl.textContent = formatPrice(clamped);

    const boxRect = container.getBoundingClientRect();
    showTooltip(spec, clamped, boxRect.width - 190, series.priceToCoordinate(clamped) || 100);

    if (onMoveLineCb) {
      onMoveLineCb({ key: spec.key, type: spec.type, posId: spec.posId, newPrice: clamped, finished: false });
    }

    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      if (wheelPending && onMoveLineCb) {
        onMoveLineCb({ key: wheelPending.key, type: wheelPending.spec.type, posId: wheelPending.spec.posId, newPrice: wheelPending.price, finished: true });
        wheelPending = null;
      }
      hideTooltip();
    }, 450);
  }

  function setupDrag(spec, handleEl, hitlineEl) {
    function onPointerDown(e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      isDragging = true;
      dragKey = spec.key;
      handleEl.classList.add('dragging');
      e.preventDefault();
      e.stopPropagation();

      const captureEl = e.currentTarget;
      try { captureEl.setPointerCapture(e.pointerId); } catch (_) {}

      function onPointerMove(ev) {
        if (!isDragging || dragKey !== spec.key) return;
        const rect = container.getBoundingClientRect();
        const relY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
        const priceAtY = series.coordinateToPrice(relY);
        if (priceAtY === null || !Number.isFinite(priceAtY)) return;

        const clamped = roundPrice(clampPrice(spec, priceAtY));

        if (lines.has(spec.key)) {
          lines.get(spec.key).applyOptions({ price: clamped, title: `${spec.title}: ${formatPrice(clamped)}` });
        }
        updateHandlePos(spec.key, clamped);
        const hData = handleMap.get(spec.key);
        if (hData && hData.priceEl) hData.priceEl.textContent = formatPrice(clamped);

        showTooltip(spec, clamped, ev.clientX - rect.left, relY);

        if (onMoveLineCb) {
          onMoveLineCb({ key: spec.key, type: spec.type, posId: spec.posId, newPrice: clamped, finished: false });
        }
      }

      function onPointerUp(ev) {
        if (!isDragging) return;
        isDragging = false;
        dragKey = null;
        handleEl.classList.remove('dragging');
        try { captureEl.releasePointerCapture(ev.pointerId); } catch (_) {}
        captureEl.removeEventListener('pointermove', onPointerMove);
        captureEl.removeEventListener('pointerup', onPointerUp);
        captureEl.removeEventListener('pointercancel', onPointerUp);
        hideTooltip();

        const rect = container.getBoundingClientRect();
        const relY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
        const priceAtY = series.coordinateToPrice(relY);
        const finalPrice = priceAtY !== null ? roundPrice(clampPrice(spec, priceAtY)) : spec.price;

        if (onMoveLineCb) {
          onMoveLineCb({ key: spec.key, type: spec.type, posId: spec.posId, newPrice: finalPrice, finished: true });
        }
      }

      captureEl.addEventListener('pointermove', onPointerMove);
      captureEl.addEventListener('pointerup', onPointerUp);
      captureEl.addEventListener('pointercancel', onPointerUp);

      const rect = container.getBoundingClientRect();
      showTooltip(spec, spec.price, e.clientX - rect.left, e.clientY - rect.top);
    }

    handleEl.addEventListener('pointerdown', onPointerDown);
    if (hitlineEl) hitlineEl.addEventListener('pointerdown', onPointerDown);

    handleEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onWheelAdjust(spec, e.deltaY, e);
    }, { passive: false });

    if (hitlineEl) {
      hitlineEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onWheelAdjust(spec, e.deltaY, e);
      }, { passive: false });
    }
  }

  function renderHandle(item, l) {
    if (l.movable) {
      const isSl = l.type === 'sl' || l.type === 'draft-sl';
      const isTp = l.type === 'tp' || l.type === 'draft-tp';
      const pnlInfo = l.entry && l.qty ? calcPnl(current, l.posSide, l.entry, l.price, l.qty) : null;
      const pnlStr = pnlInfo ? `${pnlInfo.pnl >= 0 ? '+' : ''}$${Math.abs(pnlInfo.pnl).toFixed(0)}` : '';

      item.el.innerHTML = `
        <span class="handle-grip" title="Drag up/down or scroll wheel to move">⇕</span>
        <span class="handle-tag">${l.title || (isSl ? 'Stop' : 'Target')}</span>
        <span class="handle-price">${formatPrice(l.price)}</span>
        ${pnlStr ? `<span class="handle-pnl">${pnlStr}</span>` : ''}
        ${l.posId ? `<button type="button" class="handle-close" aria-label="Remove stop">×</button>` : ''}
      `;
      item.priceEl = item.el.querySelector('.handle-price');

      if (l.posId) {
        const closeBtn = item.el.querySelector('.handle-close');
        if (closeBtn) {
          closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
          closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (onMoveLineCb) onMoveLineCb({ action: 'clear', type: l.type, posId: l.posId });
          });
        }
      }
    } else if (l.type === 'entry') {
      const buttons = [];
      if (!l.hasSl) buttons.push(`<button type="button" class="handle-btn-add add-sl">+ SL</button>`);
      if (!l.hasTp) buttons.push(`<button type="button" class="handle-btn-add add-tp">+ TP</button>`);

      item.el.innerHTML = `
        <span class="handle-tag">${l.title}</span>
        ${buttons.join('')}
      `;
      const addSlBtn = item.el.querySelector('.add-sl');
      if (addSlBtn) {
        addSlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (onMoveLineCb) onMoveLineCb({ action: 'add-sl', posId: l.posId });
        });
      }
      const addTpBtn = item.el.querySelector('.add-tp');
      if (addTpBtn) {
        addTpBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (onMoveLineCb) onMoveLineCb({ action: 'add-tp', posId: l.posId });
        });
      }
    }
  }

  function updateAllHandles() {
    for (const [key, item] of handleMap) {
      updateHandlePos(key, item.spec.price);
    }
  }

  function updateHandlePos(key, priceVal) {
    const item = handleMap.get(key);
    if (!item) return;
    const y = series.priceToCoordinate(priceVal);
    const boxH = container.clientHeight || 400;
    if (y === null || y < -15 || y > boxH + 15) {
      item.el.style.display = 'none';
      if (item.hitline) item.hitline.style.display = 'none';
    } else {
      item.el.style.display = 'inline-flex';
      item.el.style.top = `${y}px`;
      if (item.hitline) {
        item.hitline.style.display = 'block';
        item.hitline.style.top = `${y}px`;
      }
    }
  }

  // Subscribe to chart events to keep overlay handles synced
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    updateAllHandles();
  });
  chart.subscribeCrosshairMove(() => {
    if (!isDragging) updateAllHandles();
  });
  const resizeObs = new ResizeObserver(() => {
    updateAllHandles();
  });
  resizeObs.observe(container);

  return {
    setCandles(rows, market, tfSec) {
      current = market;
      tfSeconds = tfSec;
      series.applyOptions(candleOptions(market));
      const bars = [];
      let prev = -1;
      for (const r of rows) {
        const b = toBar(r);
        if (b.time > prev) { bars.push(b); prev = b.time; }
      }
      series.setData(bars);
      last = bars.length ? { ...bars[bars.length - 1] } : null;
      chart.timeScale().fitContent();
      chart.timeScale().scrollToPosition(6, false);
      setTimeout(updateAllHandles, 40);
    },

    // Feed a live price into the newest candle (opens a new one when the period rolls over).
    tick(p) {
      if (!last || !Number.isFinite(p)) return;
      const now = Math.floor(Date.now() / 1000);
      const bucket = Math.floor(now / tfSeconds) * tfSeconds;
      if (bucket > last.time) {
        last = { time: bucket, open: last.close, high: Math.max(last.close, p), low: Math.min(last.close, p), close: p };
      } else {
        last.close = p;
        last.high = Math.max(last.high, p);
        last.low = Math.min(last.low, p);
      }
      series.update(last);
    },

    // lines: [{ key, price, color, title, style: 'solid'|'dashed'|'dotted', movable, type, posId... }]
    setLines(spec) {
      const wanted = new Set(spec.map((l) => l.key));
      for (const [key, handle] of lines) {
        if (!wanted.has(key)) { series.removePriceLine(handle); lines.delete(key); lineSpec.delete(key); }
      }
      const styles = { solid: LWC().LineStyle.Solid, dashed: LWC().LineStyle.Dashed, dotted: LWC().LineStyle.Dotted };
      for (const l of spec) {
        const opts = {
          price: l.price, color: l.color, lineWidth: l.width || 1,
          lineStyle: styles[l.style || 'solid'], axisLabelVisible: true, title: l.title || '',
        };
        const sig = JSON.stringify(opts);
        if (lines.has(l.key)) {
          if (lineSpec.get(l.key) !== sig) { lines.get(l.key).applyOptions(opts); lineSpec.set(l.key, sig); }
        } else {
          lines.set(l.key, series.createPriceLine(opts));
          lineSpec.set(l.key, sig);
        }
      }

      // Sync overlay handles
      for (const [key, item] of handleMap) {
        if (!wanted.has(key)) {
          item.el.remove();
          if (item.hitline) item.hitline.remove();
          handleMap.delete(key);
        }
      }

      for (const l of spec) {
        if (!l.movable && l.type !== 'entry') continue;
        let item = handleMap.get(l.key);
        if (!item) {
          const handleEl = document.createElement('div');
          handleEl.className = `chart-handle chart-handle-${l.type || 'generic'}`;

          let hitlineEl = null;
          if (l.movable) {
            hitlineEl = document.createElement('div');
            hitlineEl.className = 'chart-handle-hitline';
            overlay.appendChild(hitlineEl);
          }

          const priceSpan = document.createElement('span');
          priceSpan.className = 'handle-price';
          handleEl.appendChild(priceSpan);
          overlay.appendChild(handleEl);

          item = { el: handleEl, hitline: hitlineEl, priceEl: priceSpan, spec: l };
          handleMap.set(l.key, item);

          if (l.movable) {
            setupDrag(l, handleEl, hitlineEl);
          }
        }
        item.spec = l;
        renderHandle(item, l);
      }
      updateAllHandles();
    },

    onMoveLine(cb) {
      onMoveLineCb = cb;
    },

    resize() {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        chart.resize(container.clientWidth, container.clientHeight);
      }
      updateAllHandles();
    },

    applyTheme() {
      chart.applyOptions(baseOptions());
      series.applyOptions(candleOptions(current));
      updateAllHandles();
    },

    destroy() {
      resizeObs.disconnect();
      overlay.remove();
      chart.remove();
    },
  };
}

// Equity curve: green above the starting balance, red below it.
export function createEquityChart(container, points, startBalance) {
  const chart = LWC().createChart(container, { ...baseOptions(), rightPriceScale: { borderColor: cssVar('--line'), scaleMargins: { top: 0.15, bottom: 0.15 } } });
  const series = chart.addSeries(LWC().BaselineSeries, {
    baseValue: { type: 'price', price: startBalance },
    topLineColor: cssVar('--chart-up'), bottomLineColor: cssVar('--chart-down'),
    topFillColor1: cssVar('--chart-up-fill'), topFillColor2: 'rgba(0,0,0,0)',
    bottomFillColor1: 'rgba(0,0,0,0)', bottomFillColor2: cssVar('--chart-down-fill'),
    lineWidth: 2,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });
  const data = [];
  let prev = -1;
  for (const [ts, eq] of points) {
    const t = Math.floor(ts);
    if (t > prev) { data.push({ time: t, value: eq }); prev = t; }
    else if (data.length) data[data.length - 1].value = eq;
  }
  series.setData(data);
  series.createPriceLine({ price: startBalance, color: cssVar('--ink-3'), lineWidth: 1, lineStyle: LWC().LineStyle.Dashed, axisLabelVisible: true, title: 'Start' });
  chart.timeScale().fitContent();
  return {
    // cb({ time, value }) while the pointer is over the chart, cb(null) when it leaves.
    onHover(cb) {
      chart.subscribeCrosshairMove((param) => {
        const d = param.time !== undefined ? param.seriesData.get(series) : null;
        cb(d && d.value !== undefined ? { time: param.time, value: d.value } : null);
      });
    },
    applyTheme() { chart.applyOptions(baseOptions()); },
    destroy() { chart.remove(); },
  };
}
