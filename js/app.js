(function () {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  function resizeCanvasToDisplaySize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    redraw();
  }
  let objects = [];
  let selectedIds = new Set();
  let nextId = 1;
  function uid() {
    return "o" + nextId++;
  }

  /** @type {string | null} */
  let tool = null;
  /** @type {{ xmin: number, ymin: number, xmax: number, ymax: number, algo: 'cs'|'lb' } | null} */
  let lastClipRect = null;

  let drag = null;

  const COL_DDA = "#2e7d32";
  const COL_DDA_SEL = "#1b5e20";
  const COL_BRES = "#ef6c00";
  const COL_BRES_SEL = "#e65100";
  const COL_CIRCLE = "#0d47a1";
  const COL_CIRCLE_SEL = "#0a3d7a";
  const COL_CLIP_CS = "#ff8a80";
  const COL_CLIP_LB = "#6d1b2b";
  const COL_SELECT_BOX = "rgba(0, 105, 92, 0.75)";
  const PIXEL_SIZE = 2;

  const past = [];
  const future = [];

  function cloneObject(o) {
    const c = { ...o };
    if (o.fromCircle) c.fromCircle = true;
    return c;
  }

  function cloneObjects(arr) {
    return arr.map(cloneObject);
  }

  function snapshotState() {
    return {
      objects: cloneObjects(objects),
      lastClipRect: lastClipRect ? { ...lastClipRect } : null,
      selectedIds: [...selectedIds],
      nextId,
    };
  }

  function restoreState(s) {
    objects = cloneObjects(s.objects);
    lastClipRect = s.lastClipRect ? { ...s.lastClipRect } : null;
    selectedIds = new Set(s.selectedIds);
    nextId = s.nextId;
  }

  function pushHistoryBeforeChange() {
    past.push(snapshotState());
    if (past.length > 100) past.shift();
    future.length = 0;
    updateUndoRedoButtons();
  }

  function undo() {
    if (past.length === 0) return;
    future.push(snapshotState());
    restoreState(past.pop());
    redraw();
    updateUndoRedoButtons();
  }

  function redo() {
    if (future.length === 0) return;
    past.push(snapshotState());
    restoreState(future.pop());
    redraw();
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const u = document.getElementById("btn-undo");
    const r = document.getElementById("btn-redo");
    if (u) u.disabled = past.length === 0;
    if (r) r.disabled = future.length === 0;
  }

  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  }

  function bbox(o) {
    if (o.type === "line") {
      return {
        xmin: Math.min(o.x1, o.x2),
        ymin: Math.min(o.y1, o.y2),
        xmax: Math.max(o.x1, o.x2),
        ymax: Math.max(o.y1, o.y2),
      };
    }
    if (o.type === "ellipse") {
      return {
        xmin: o.cx - o.rx,
        ymin: o.cy - o.ry,
        xmax: o.cx + o.rx,
        ymax: o.cy + o.ry,
      };
    }
    return null;
  }

  function rectsIntersect(a, b) {
    return !(a.xmax < b.xmin || a.xmin > b.xmax || a.ymax < b.ymin || a.ymin > b.ymax);
  }

  function getLinePixels(o) {
    if (o.algo === "dda") return ddaLine(o.x1, o.y1, o.x2, o.y2);
    return bresenhamLine(o.x1, o.y1, o.x2, o.y2);
  }

  function getObjectPixels(o) {
    if (o.type === "line") return getLinePixels(o);
    if (o.type === "ellipse") {
      if (Math.abs(o.rx - o.ry) < 1e-6) {
        return bresenhamCircle(o.cx, o.cy, o.rx);
      }
      return midpointEllipse(o.cx, o.cy, o.rx, o.ry);
    }
    return [];
  }

  function selectionCentroid() {
    const sel = objects.filter((o) => selectedIds.has(o.id));
    if (!sel.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const o of sel) {
      const b = bbox(o);
      if (!b) continue;
      minX = Math.min(minX, b.xmin);
      minY = Math.min(minY, b.ymin);
      maxX = Math.max(maxX, b.xmax);
      maxY = Math.max(maxY, b.ymax);
    }
    if (!Number.isFinite(minX)) return null;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  function transformPoint(x, y, pivot, kind, params) {
    const px = pivot.x;
    const py = pivot.y;
    let dx = x - px;
    let dy = y - py;

    if (kind === "translate") {
      return { x: x + params.dx, y: y + params.dy };
    }
    if (kind === "rotate") {
      const c = Math.cos(params.rad);
      const s = Math.sin(params.rad);
      return {
        x: px + dx * c - dy * s,
        y: py + dx * s + dy * c,
      };
    }
    if (kind === "scale") {
      return {
        x: px + dx * params.sx,
        y: py + dy * params.sy,
      };
    }
    if (kind === "reflectX") {
      return { x, y: 2 * py - y };
    }
    if (kind === "reflectY") {
      return { x: 2 * px - x, y };
    }
    if (kind === "reflectXY") {
      return {
        x: px + (y - py),
        y: py + (x - px),
      };
    }
    return { x, y };
  }

  function applyTransformToObject(o, pivot, kind, params) {
    if (o.type === "line") {
      const p1 = transformPoint(o.x1, o.y1, pivot, kind, params);
      const p2 = transformPoint(o.x2, o.y2, pivot, kind, params);
      o.x1 = p1.x;
      o.y1 = p1.y;
      o.x2 = p2.x;
      o.y2 = p2.y;
    } else if (o.type === "ellipse") {
      const c = transformPoint(o.cx, o.cy, pivot, kind, params);
      o.cx = c.x;
      o.cy = c.y;
      if (kind === "scale") {
        o.rx *= Math.abs(params.sx);
        o.ry *= Math.abs(params.sy);
      }
    }
  }

  function applyTransform(kind, params) {
    const pivot = selectionCentroid();
    if (!pivot) return;
    for (const o of objects) {
      if (selectedIds.has(o.id)) applyTransformToObject(o, pivot, kind, params);
    }
    redraw();
  }

  function ellipseToSegments(o, n) {
    const segs = [];
    for (let i = 0; i < n; i++) {
      const t0 = (2 * Math.PI * i) / n;
      const t1 = (2 * Math.PI * (i + 1)) / n;
      segs.push({
        x1: o.cx + o.rx * Math.cos(t0),
        y1: o.cy + o.ry * Math.sin(t0),
        x2: o.cx + o.rx * Math.cos(t1),
        y2: o.cy + o.ry * Math.sin(t1),
      });
    }
    return segs;
  }

  function clipSegment(algo, x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
    if (algo === "cs") {
      return cohenSutherlandClip(x0, y0, x1, y1, xmin, ymin, xmax, ymax);
    }
    return liangBarskyClip(x0, y0, x1, y1, xmin, ymin, xmax, ymax);
  }

  function performClip(algo, rx0, ry0, rx1, ry1) {
    const xmin = Math.min(rx0, rx1);
    const ymin = Math.min(ry0, ry1);
    const xmax = Math.max(rx0, rx1);
    const ymax = Math.max(ry0, ry1);
    if (xmax - xmin < 2 || ymax - ymin < 2) return;

    pushHistoryBeforeChange();

    const newObjects = [];

    for (const o of objects) {
      if (o.type === "line") {
        const fn = algo === "cs" ? cohenSutherlandClip : liangBarskyClip;
        const r = fn(o.x1, o.y1, o.x2, o.y2, xmin, ymin, xmax, ymax);
        if (r.ok) {
          const seg = {
            id: o.id,
            type: "line",
            x1: r.x0,
            y1: r.y0,
            x2: r.x1,
            y2: r.y1,
            algo: o.algo,
          };
          if (o.fromCircle) seg.fromCircle = true;
          newObjects.push(seg);
        }
      } else if (o.type === "ellipse") {
        const segs = ellipseToSegments(o, 72);
        for (const s of segs) {
          const r = clipSegment(algo, s.x1, s.y1, s.x2, s.y2, xmin, ymin, xmax, ymax);
          if (r.ok) {
            newObjects.push({
              id: uid(),
              type: "line",
              x1: r.x0,
              y1: r.y0,
              x2: r.x1,
              y2: r.y1,
              algo: "bresenham",
              fromCircle: true,
            });
          }
        }
      }
    }

    objects = newObjects;
    selectedIds.clear();
    lastClipRect = { xmin, ymin, xmax, ymax, algo };
    redraw();
  }

  function lineStrokeColor(o, selected) {
    if (o.fromCircle) return selected ? COL_CIRCLE_SEL : COL_CIRCLE;
    if (o.algo === "dda") return selected ? COL_DDA_SEL : COL_DDA;
    return selected ? COL_BRES_SEL : COL_BRES;
  }

  function drawPixels(pixels, color) {
    ctx.fillStyle = color;
    const s = PIXEL_SIZE;
    for (const p of pixels) {
      if (p.x >= 0 && p.x < canvas.width && p.y >= 0 && p.y < canvas.height) {
        ctx.fillRect(p.x, p.y, s, s);
      }
    }
  }

  function redraw() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (lastClipRect) {
      const r = lastClipRect;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = r.algo === "cs" ? COL_CLIP_CS : COL_CLIP_LB;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.xmin, r.ymin, r.xmax - r.xmin, r.ymax - r.ymin);
      ctx.setLineDash([]);
    }

    for (const o of objects) {
      const sel = selectedIds.has(o.id);
      const col =
        o.type === "line" ? lineStrokeColor(o, sel) : sel ? COL_CIRCLE_SEL : COL_CIRCLE;
      drawPixels(getObjectPixels(o), col);
    }

    for (const id of selectedIds) {
      const o = objects.find((x) => x.id === id);
      if (!o) continue;
      const b = bbox(o);
      if (!b) continue;
      ctx.strokeStyle = COL_SELECT_BOX;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(b.xmin - 2, b.ymin - 2, b.xmax - b.xmin + 4, b.ymax - b.ymin + 4);
      ctx.setLineDash([]);
    }

    if (drag && drag.preview) {
      let previewColor = "#888";
      if (tool === "dda") previewColor = COL_DDA;
      else if (tool === "bresenham") previewColor = COL_BRES;
      else if (tool === "circunferencia") previewColor = COL_CIRCLE;
      else if (tool === "recorte-cs") previewColor = COL_CLIP_CS;
      else if (tool === "recorte-lb") previewColor = COL_CLIP_LB;
      else if (tool === "select") previewColor = COL_SELECT_BOX;
      ctx.strokeStyle = previewColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      if (drag.kind === "line") {
        ctx.moveTo(drag.x0, drag.y0);
        ctx.lineTo(drag.x1, drag.y1);
      } else if (drag.kind === "circle") {
        const r = Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0);
        ctx.arc(drag.x0, drag.y0, r, 0, Math.PI * 2);
      } else if (drag.kind === "clip" || drag.kind === "select") {
        const rx0 = Math.min(drag.x0, drag.x1);
        const ry0 = Math.min(drag.y0, drag.y1);
        const rw = Math.abs(drag.x1 - drag.x0);
        const rh = Math.abs(drag.y1 - drag.y0);
        ctx.rect(rx0, ry0, rw, rh);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function selectInRect(x0, y0, x1, y1) {
    const rx0 = Math.min(x0, x1);
    const ry0 = Math.min(y0, y1);
    const rx1 = Math.max(x0, x1);
    const ry1 = Math.max(y0, y1);
    const selRect = { xmin: rx0, ymin: ry0, xmax: rx1, ymax: ry1 };
    selectedIds.clear();
    for (const o of objects) {
      const b = bbox(o);
      if (b && rectsIntersect(b, selRect)) selectedIds.add(o.id);
    }
    redraw();
  }

  function setActiveToolButtons() {
    document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
      btn.classList.toggle("active", tool != null && btn.dataset.tool === tool);
    });
  }

  function updateCanvasCursor() {
    canvas.style.cursor = tool ? "crosshair" : "default";
  }

  function onDown(e) {
    if (tool == null) return;
    const p = canvasPos(e);
    if (tool === "dda" || tool === "bresenham") {
      drag = { kind: "line", x0: p.x, y0: p.y, x1: p.x, y1: p.y, preview: true };
    } else if (tool === "circunferencia") {
      drag = { kind: "circle", x0: p.x, y0: p.y, x1: p.x, y1: p.y, preview: true };
    } else if (tool === "recorte-cs" || tool === "recorte-lb") {
      drag = {
        kind: "clip",
        x0: p.x,
        y0: p.y,
        x1: p.x,
        y1: p.y,
        algo: tool === "recorte-cs" ? "cs" : "lb",
        preview: true,
      };
    } else if (tool === "select") {
      drag = {
        kind: "select",
        x0: p.x,
        y0: p.y,
        x1: p.x,
        y1: p.y,
        preview: true,
      };
    }
  }

  function onMove(e) {
    if (!drag || !drag.preview) return;
    const p = canvasPos(e);
    if (drag.kind === "line" || drag.kind === "circle") {
      drag.x1 = p.x;
      drag.y1 = p.y;
    } else if (drag.kind === "clip" || drag.kind === "select") {
      drag.x1 = p.x;
      drag.y1 = p.y;
    }
    redraw();
  }

  function onUp(e) {
    if (!drag) return;
    const p = canvasPos(e);
    if (drag.kind === "line") {
      drag.x1 = p.x;
      drag.y1 = p.y;
      const algo = tool === "dda" ? "dda" : "bresenham";
      const d = Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0);
      if (d > 2) {
        pushHistoryBeforeChange();
        objects.push({
          id: uid(),
          type: "line",
          x1: drag.x0,
          y1: drag.y0,
          x2: drag.x1,
          y2: drag.y1,
          algo,
        });
      }
    } else if (drag.kind === "circle") {
      drag.x1 = p.x;
      drag.y1 = p.y;
      const r = Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0);
      if (r > 2) {
        pushHistoryBeforeChange();
        objects.push({
          id: uid(),
          type: "ellipse",
          cx: drag.x0,
          cy: drag.y0,
          rx: r,
          ry: r,
        });
      }
    } else if (drag.kind === "clip") {
      drag.x1 = p.x;
      drag.y1 = p.y;
      performClip(drag.algo, drag.x0, drag.y0, drag.x1, drag.y1);
    } else if (drag.kind === "select") {
      drag.x1 = p.x;
      drag.y1 = p.y;
      selectInRect(drag.x0, drag.y0, drag.x1, drag.y1);
    }
    drag = null;
    redraw();
  }

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    onDown(e);
  });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.tool;
      const isClip = next === "recorte-cs" || next === "recorte-lb";
      if (tool === next) {
        if (isClip) lastClipRect = null;
        tool = null;
      } else {
        tool = next;
      }
      setActiveToolButtons();
      updateCanvasCursor();
      redraw();
    });
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    pushHistoryBeforeChange();
    objects = [];
    selectedIds.clear();
    lastClipRect = null;
    redraw();
    updateUndoRedoButtons();
  });

  document.getElementById("btn-undo").addEventListener("click", () => undo());
  document.getElementById("btn-redo").addEventListener("click", () => redo());

  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    }
  });

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function commitTranslationFromInputs() {
    for (const key of ["dx", "dy"]) {
      const inp = document.getElementById("input-" + key);
      let v = parseInt(inp.value, 10);
      if (Number.isNaN(v)) v = 0;
      v = clamp(v, -200, 200);
      inp.value = String(v);
      document.getElementById("val-" + key).textContent = String(v);
    }
  }

  function commitRotationFromInputs() {
    const inp = document.getElementById("input-rot");
    let v = parseInt(inp.value, 10);
    if (Number.isNaN(v)) v = 0;
    v = clamp(v, -180, 180);
    inp.value = String(v);
    document.getElementById("val-rot").textContent = String(v);
  }

  function commitScaleFromInputs() {
    for (const key of ["sx", "sy"]) {
      const inp = document.getElementById("input-" + key);
      let v = parseFloat(String(inp.value).replace(",", "."));
      if (Number.isNaN(v)) v = 1;
      v = clamp(v, 0.05, 3);
      inp.value = v.toFixed(2);
      document.getElementById("val-" + key).textContent = v.toFixed(2);
    }
  }

  function bindNumericEnter(id, commitFn) {
    const el = document.getElementById(id);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitFn();
        el.blur();
      }
    });
  }

  bindNumericEnter("input-dx", commitTranslationFromInputs);
  bindNumericEnter("input-dy", commitTranslationFromInputs);
  bindNumericEnter("input-rot", commitRotationFromInputs);
  bindNumericEnter("input-sx", commitScaleFromInputs);
  bindNumericEnter("input-sy", commitScaleFromInputs);

  document.getElementById("apply-trans").addEventListener("click", () => {
    commitTranslationFromInputs();
    const dx = Number(document.getElementById("input-dx").value);
    const dy = Number(document.getElementById("input-dy").value);
    if (!selectedIds.size) return;
    pushHistoryBeforeChange();
    applyTransform("translate", { dx, dy });
  });

  document.getElementById("apply-rot").addEventListener("click", () => {
    commitRotationFromInputs();
    const deg = Number(document.getElementById("input-rot").value);
    if (!selectedIds.size) return;
    pushHistoryBeforeChange();
    applyTransform("rotate", { rad: (deg * Math.PI) / 180 });
  });

  document.getElementById("apply-scale").addEventListener("click", () => {
    commitScaleFromInputs();
    const sx = Number(String(document.getElementById("input-sx").value).replace(",", "."));
    const sy = Number(String(document.getElementById("input-sy").value).replace(",", "."));
    if (!selectedIds.size) return;
    pushHistoryBeforeChange();
    applyTransform("scale", { sx, sy });
  });

  document.getElementById("refl-x").addEventListener("click", () => {
    if (!selectedIds.size) return;
    pushHistoryBeforeChange();
    applyTransform("reflectX", {});
  });
  document.getElementById("refl-y").addEventListener("click", () => {
    if (!selectedIds.size) return;
    pushHistoryBeforeChange();
    applyTransform("reflectY", {});
  });
  document.getElementById("refl-xy").addEventListener("click", () => {
    if (!selectedIds.size) return;
    pushHistoryBeforeChange();
    applyTransform("reflectXY", {});
  });

  window.addEventListener("resize", resizeCanvasToDisplaySize);

  setActiveToolButtons();
  updateCanvasCursor();
  commitTranslationFromInputs();
  commitRotationFromInputs();
  commitScaleFromInputs();
  updateUndoRedoButtons();
  resizeCanvasToDisplaySize();
  redraw();
})();
