/**
 * Algoritmos — Unidade 1 (Computação Gráfica)
 * DDA, Bresenham (reta), Bresenham (circunferência),
 * Cohen–Sutherland, Liang–Barsky
 */

function ddaLine(x0, y0, x1, y1) {
  const pixels = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
  const xInc = dx / steps;
  const yInc = dy / steps;
  let x = x0;
  let y = y0;
  for (let i = 0; i <= steps; i++) {
    pixels.push({ x: Math.round(x), y: Math.round(y) });
    x += xInc;
    y += yInc;
  }
  return pixels;
}

function bresenhamLine(x0, y0, x1, y1) {
  const pixels = [];
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  while (true) {
    pixels.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return pixels;
}

function bresenhamCircle(cx, cy, r) {
  const pixels = [];
  cx = Math.round(cx);
  cy = Math.round(cy);
  r = Math.round(Math.abs(r));
  if (r <= 0) {
    pixels.push({ x: cx, y: cy });
    return pixels;
  }
  let x = 0;
  let y = r;
  let d = 3 - 2 * r;
  const drawOctants = () => {
    const plot = (px, py) => pixels.push({ x: px, y: py });
    plot(cx + x, cy + y);
    plot(cx - x, cy + y);
    plot(cx + x, cy - y);
    plot(cx - x, cy - y);
    plot(cx + y, cy + x);
    plot(cx - y, cy + x);
    plot(cx + y, cy - x);
    plot(cx - y, cy - x);
  };
  drawOctants();
  while (x < y) {
    if (d < 0) {
      d += 4 * x + 6;
    } else {
      d += 4 * (x - y) + 10;
      y--;
    }
    x++;
    drawOctants();
  }
  return pixels;
}

function midpointEllipse(cx, cy, rx, ry) {
  const pixels = [];

  cx = Math.round(cx);
  cy = Math.round(cy);
  rx = Math.round(Math.abs(rx));
  ry = Math.round(Math.abs(ry));

  if (rx <= 0 || ry <= 0) {
    pixels.push({ x: cx, y: cy });
    return pixels;
  }

  let x = 0;
  let y = ry;

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const twoRx2 = 2 * rx2;
  const twoRy2 = 2 * ry2;

  let px = 0;
  let py = twoRx2 * y;

  const plot4 = (pxi, pyi) => {
    pixels.push({ x: cx + pxi, y: cy + pyi });
    pixels.push({ x: cx - pxi, y: cy + pyi });
    pixels.push({ x: cx + pxi, y: cy - pyi });
    pixels.push({ x: cx - pxi, y: cy - pyi });
  };

  let p = ry2 - rx2 * ry + 0.25 * rx2;

  while (px < py) {
    plot4(x, y);
    x++;
    px += twoRy2;

    if (p < 0) {
      p += ry2 + px;
    } else {
      y--;
      py -= twoRx2;
      p += ry2 + px - py;
    }
  }

  p =
    ry2 * (x + 0.5) * (x + 0.5) +
    rx2 * (y - 1) * (y - 1) -
    rx2 * ry2;

  while (y >= 0) {
    plot4(x, y);
    y--;
    py -= twoRx2;

    if (p > 0) {
      p += rx2 - py;
    } else {
      x++;
      px += twoRy2;
      p += rx2 - py + px;
    }
  }

  return pixels;
}

const INSIDE = 0;
const LEFT = 1;
const RIGHT = 2;
/** Abaixo da janela (y maior que ymax) — canvas */
const BOTTOM = 4;
/** Acima da janela (y menor que ymin) — canvas */
const TOP = 8;

function computeOutCode(x, y, xmin, ymin, xmax, ymax) {
  let code = INSIDE;
  if (x < xmin) code |= LEFT;
  else if (x > xmax) code |= RIGHT;
  if (y < ymin) code |= TOP;
  else if (y > ymax) code |= BOTTOM;
  return code;
}

function cohenSutherlandClip(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
  let outcode0 = computeOutCode(x0, y0, xmin, ymin, xmax, ymax);
  let outcode1 = computeOutCode(x1, y1, xmin, ymin, xmax, ymax);
  let accept = false;

  while (true) {
    if (!(outcode0 | outcode1)) {
      accept = true;
      break;
    }
    if (outcode0 & outcode1) {
      break;
    }
    const outcodeOut = outcode0 ? outcode0 : outcode1;
    let x = 0;
    let y = 0;
    if (outcodeOut & TOP) {
      if (Math.abs(y1 - y0) < 1e-9) break;
      x = x0 + ((x1 - x0) * (ymin - y0)) / (y1 - y0);
      y = ymin;
    } else if (outcodeOut & BOTTOM) {
      if (Math.abs(y1 - y0) < 1e-9) break;
      x = x0 + ((x1 - x0) * (ymax - y0)) / (y1 - y0);
      y = ymax;
    } else if (outcodeOut & RIGHT) {
      if (Math.abs(x1 - x0) < 1e-9) break;
      y = y0 + ((y1 - y0) * (xmax - x0)) / (x1 - x0);
      x = xmax;
    } else if (outcodeOut & LEFT) {
      if (Math.abs(x1 - x0) < 1e-9) break;
      y = y0 + ((y1 - y0) * (xmin - x0)) / (x1 - x0);
      x = xmin;
    }
    if (outcodeOut === outcode0) {
      x0 = x;
      y0 = y;
      outcode0 = computeOutCode(x0, y0, xmin, ymin, xmax, ymax);
    } else {
      x1 = x;
      y1 = y;
      outcode1 = computeOutCode(x1, y1, xmin, ymin, xmax, ymax);
    }
  }
  if (accept) {
    return { ok: true, x0, y0, x1, y1 };
  }
  return { ok: false };
}

function liangBarskyClip(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let u1 = 0;
  let u2 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return { ok: false };
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > u2) return { ok: false };
      if (r > u1) u1 = r;
    } else {
      if (r < u1) return { ok: false };
      if (r < u2) u2 = r;
    }
  }
  if (u1 > u2) return { ok: false };
  return {
    ok: true,
    x0: x0 + u1 * dx,
    y0: y0 + u1 * dy,
    x1: x0 + u2 * dx,
    y1: y0 + u2 * dy,
  };
}
