import { useCallback, useEffect, useRef, useState } from "react";
import { BrandLogo, SiteFooter } from "./Branding";
import FullscreenButton from "./FullscreenButton";
import useFitToScreen from "./useFitToScreen";
import {
  DEFAULT_ELECTRONS,
  ELECTRON_RADIUS,
  HISTORY_SECONDS,
  ION_RADIUS,
  LATTICE_HEIGHT,
  LATTICE_WIDTH,
  LATTICE_X,
  LATTICE_Y,
  MAX_ELECTRONS,
  POWER_AVERAGE_SECONDS,
  METAL_COLUMNS,
  ROOM_TEMP,
  SINK_COLUMN,
  SINK_TEMP,
  SOURCE_COLUMN,
  SOURCE_TEMP,
  SPACING,
  TOTAL_COLUMNS,
  createState,
  electronTemperature,
  metalTemperature,
  resetTemperatures,
  setElectronCount,
  setSink,
  setSource,
  step,
  toCelsius,
} from "./physics";

// Stage drawing size (canvas units). The canvas is scaled to fit the page.
const WIDTH = 1600;
const HEIGHT = 920;
const CANVAS_RENDER_SCALE = 2;

const FRAME = { x: 28, y: 20, width: 1020, height: 884 };
const PANEL_X = 1072;
const PANEL_WIDTH = WIDTH - PANEL_X - 26;
const CONTROLS = { y: 20, height: 214 };
const PROFILE_PANEL = { x: PANEL_X, y: 248, width: PANEL_WIDTH, height: 340 };
const FLOW_PANEL = { x: PANEL_X, y: 602, width: PANEL_WIDTH, height: 302 };

const LATTICE_RIGHT = LATTICE_X + LATTICE_WIDTH;
const LATTICE_BOTTOM = LATTICE_Y + LATTICE_HEIGHT;
const SOURCE_SLOT = { x: LATTICE_X, width: SPACING };
const SINK_SLOT = { x: LATTICE_RIGHT - SPACING, width: SPACING };

// Display helper: typographic minus sign for negative temperatures.
const formatC = (celsius) => String(celsius).replace("-", "−");

const SOURCE_C = toCelsius(SOURCE_TEMP);
const SINK_C = toCelsius(SINK_TEMP);
const ROOM_C = toCelsius(ROOM_TEMP);

const PROFILE_MIN_C = -100;
const PROFILE_MAX_C = 350;
const SCALE_MIN_C = -50;
const SCALE_MAX_C = 300;

const ELECTRON_STEP = 10;
const SPEEDS = [1, 2, 4];
const SLIDER_POINTER_GUTTER = 7;

const HOT = "#d9480f";
const HOT_SOFT = "rgba(255, 112, 52,";
const COLD = "#1f6fb8";
const COLD_SOFT = "rgba(64, 140, 220,";

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

const ION_NEUTRAL = [123, 132, 140];
const ION_HOT = [232, 70, 28];
const ION_COLD = [56, 126, 214];

function mix(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

// Grey at room temperature, reddening as it heats and turning blue as it cools.
function temperatureColour(kelvin) {
  const celsius = toCelsius(kelvin);
  if (celsius >= ROOM_C) {
    const heat = clamp01((celsius - ROOM_C) / (SOURCE_C - ROOM_C));
    return { rgb: mix(ION_NEUTRAL, ION_HOT, Math.pow(heat, 0.8)), heat, cold: 0 };
  }
  const cold = clamp01((ROOM_C - celsius) / (ROOM_C - SINK_C));
  return { rgb: mix(ION_NEUTRAL, ION_COLD, Math.pow(cold, 0.8)), heat: 0, cold };
}

const rgbString = (rgb, alpha = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawPanel(ctx, panel, title) {
  ctx.save();
  ctx.shadowColor = "rgba(31, 50, 65, 0.1)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  roundedRect(ctx, panel.x, panel.y, panel.width, panel.height, 14);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
  roundedRect(ctx, panel.x, panel.y, panel.width, panel.height, 14);
  ctx.strokeStyle = "rgba(171, 186, 198, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#20364a";
  ctx.font = "800 15px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, panel.x + 18, panel.y + 26);
}

function drawFrame(ctx) {
  ctx.save();
  ctx.shadowColor = "rgba(31, 50, 65, 0.16)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundedRect(ctx, FRAME.x, FRAME.y, FRAME.width, FRAME.height, 24);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
  roundedRect(ctx, FRAME.x, FRAME.y, FRAME.width, FRAME.height, 24);
  ctx.strokeStyle = "rgba(116, 137, 151, 0.72)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const centre = LATTICE_X + LATTICE_WIDTH / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#20364a";
  ctx.font = "800 15px system-ui, sans-serif";
  ctx.fillText("MICROSCOPIC VIEW OF A METAL BAR", centre, FRAME.y + 30);
  ctx.fillStyle = "#687985";
  ctx.font = "700 10px system-ui, sans-serif";
  ctx.fillText("NOT TO SCALE", centre, FRAME.y + 48);
}

function drawHatch(ctx, x, y, width, height, colour) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  for (let offset = -height; offset < width + height; offset += 12) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y);
    ctx.lineTo(x + offset - height, y + height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawReservoirLabel(ctx, centreX, on, kind) {
  const isHot = kind === "hot";
  const label = isHot ? `HOT SOURCE ${SOURCE_C} °C` : `COLD SINK ${formatC(SINK_C)} °C`;
  const y = LATTICE_Y - 22;
  ctx.font = "800 11px system-ui, sans-serif";
  const width = ctx.measureText(label).width + 20;
  const x = Math.min(
    Math.max(centreX - width / 2, FRAME.x + 10),
    FRAME.x + FRAME.width - 10 - width,
  );
  roundedRect(ctx, x, y - 11, width, 22, 11);
  ctx.fillStyle = on ? (isHot ? HOT : COLD) : "#eef2f5";
  ctx.fill();
  if (!on) {
    ctx.strokeStyle = "#b9c5ce";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = on ? "#ffffff" : "#8796a2";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + width / 2, y + 0.5);
}

// The heater / cooler block that sits behind each reservoir column.
function drawReservoirDevice(ctx, kind, time) {
  const isHot = kind === "hot";
  const x = isHot ? LATTICE_X - 30 : LATTICE_RIGHT + 6;
  const y = LATTICE_Y + 8;
  const width = 24;
  const height = LATTICE_HEIGHT - 16;

  const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
  if (isHot) {
    gradient.addColorStop(0, "#9b2c0c");
    gradient.addColorStop(1, "#e8590c");
  } else {
    gradient.addColorStop(0, "#5aa2e6");
    gradient.addColorStop(1, "#1b5e9e");
  }
  ctx.save();
  ctx.shadowColor = isHot ? "rgba(255, 96, 32, 0.55)" : "rgba(70, 150, 230, 0.45)";
  ctx.shadowBlur = 14;
  roundedRect(ctx, x, y, width, height, 8);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, x, y, width, height, 8);
  ctx.clip();
  if (isHot) {
    // Glowing heating coil, flickering gently.
    const flicker = 0.75 + 0.25 * Math.sin(time * 7);
    ctx.strokeStyle = `rgba(255, 214, 140, ${0.65 * flicker + 0.2})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let yy = y + 10, i = 0; yy < y + height - 6; yy += 9, i += 1) {
      const xx = i % 2 === 0 ? x + 6 : x + width - 6;
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  } else {
    // Cooling fins.
    ctx.strokeStyle = "rgba(225, 242, 255, 0.75)";
    ctx.lineWidth = 2;
    for (let yy = y + 12; yy < y + height - 6; yy += 14) {
      ctx.beginPath();
      ctx.moveTo(x + 5, yy);
      ctx.lineTo(x + width - 5, yy);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(isHot ? -Math.PI / 2 : Math.PI / 2);
  roundedRect(ctx, -34, -8, 68, 16, 8);
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fill();
  ctx.fillStyle = isHot ? "#9b2c0c" : "#174f7a";
  ctx.font = "800 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(isHot ? "HEATER" : "COOLER", 0, 0.5);
  ctx.restore();
}

function drawEmptySlot(ctx, slot, kind) {
  const isHot = kind === "hot";
  drawHatch(ctx, slot.x, LATTICE_Y, slot.width, LATTICE_HEIGHT, "rgba(160, 175, 186, 0.28)");
  ctx.save();
  ctx.translate(slot.x + slot.width / 2, LATTICE_Y + LATTICE_HEIGHT / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#7d8d99";
  ctx.font = "750 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(isHot ? "Hot source off" : "Cold sink off", 0, -8);
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillText("end of bar is insulated", 0, 10);
  ctx.restore();

  // Insulating wall at the end of the metal.
  const wallX = isHot ? slot.x + slot.width : slot.x;
  ctx.fillStyle = "#8b9aa6";
  ctx.fillRect(wallX - 3, LATTICE_Y, 6, LATTICE_HEIGHT);
}

function drawLatticeBackground(ctx, state, time) {
  const metalLeft = LATTICE_X + SPACING;
  const metalRight = LATTICE_RIGHT - SPACING;

  // Metal
  roundedRect(ctx, LATTICE_X, LATTICE_Y, LATTICE_WIDTH, LATTICE_HEIGHT, 14);
  ctx.fillStyle = "#f4f6f8";
  ctx.fill();

  if (state.sourceOn) {
    const g = ctx.createLinearGradient(SOURCE_SLOT.x, 0, metalLeft, 0);
    g.addColorStop(0, `${HOT_SOFT} 0.34)`);
    g.addColorStop(1, `${HOT_SOFT} 0.1)`);
    ctx.fillStyle = g;
    ctx.fillRect(SOURCE_SLOT.x, LATTICE_Y, SOURCE_SLOT.width, LATTICE_HEIGHT);
  } else {
    drawEmptySlot(ctx, SOURCE_SLOT, "hot");
  }

  if (state.sinkOn) {
    const g = ctx.createLinearGradient(metalRight, 0, LATTICE_RIGHT, 0);
    g.addColorStop(0, `${COLD_SOFT} 0.1)`);
    g.addColorStop(1, `${COLD_SOFT} 0.32)`);
    ctx.fillStyle = g;
    ctx.fillRect(SINK_SLOT.x, LATTICE_Y, SINK_SLOT.width, LATTICE_HEIGHT);
  } else {
    drawEmptySlot(ctx, SINK_SLOT, "cold");
  }

  // Thermal contact lines: electrons pass straight through these.
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1.5;
  if (state.sourceOn) {
    ctx.strokeStyle = "rgba(217, 72, 15, 0.55)";
    ctx.beginPath();
    ctx.moveTo(metalLeft, LATTICE_Y + 4);
    ctx.lineTo(metalLeft, LATTICE_BOTTOM - 4);
    ctx.stroke();
  }
  if (state.sinkOn) {
    ctx.strokeStyle = "rgba(31, 111, 184, 0.55)";
    ctx.beginPath();
    ctx.moveTo(metalRight, LATTICE_Y + 4);
    ctx.lineTo(metalRight, LATTICE_BOTTOM - 4);
    ctx.stroke();
  }
  ctx.restore();

  roundedRect(ctx, LATTICE_X, LATTICE_Y, LATTICE_WIDTH, LATTICE_HEIGHT, 14);
  ctx.strokeStyle = "rgba(96, 116, 130, 0.75)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  if (state.sourceOn) drawReservoirDevice(ctx, "hot", time);
  if (state.sinkOn) drawReservoirDevice(ctx, "cold", time);
  drawReservoirLabel(ctx, SOURCE_SLOT.x + SOURCE_SLOT.width / 2, state.sourceOn, "hot");
  drawReservoirLabel(ctx, SINK_SLOT.x + SINK_SLOT.width / 2, state.sinkOn, "cold");

  // Label the metal itself.
  ctx.fillStyle = "#4a5d6c";
  ctx.font = "800 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("METAL", LATTICE_X + LATTICE_WIDTH / 2, LATTICE_Y - 22);
}

// A single ion's energy swings a lot from one collision to the next, so on its
// own its colour would flicker between hot and cold even in a uniform bar.
// Colour each ion mostly by the smoothed temperature of its column, keeping a
// little of its own energy so neighbouring ions still look individual.
const OWN_ENERGY_SHARE = 0.3;

function displayTemperature(ion, columnTemperature) {
  if (!Number.isFinite(columnTemperature)) return ion.temperature;
  return columnTemperature * (1 - OWN_ENERGY_SHARE) + ion.temperature * OWN_ENERGY_SHARE;
}

function drawIon(ctx, ion, time, temperature = ion.temperature) {
  const x = ion.restX + ion.dx;
  const y = ion.restY + ion.dy;
  const { rgb, heat, cold } = temperatureColour(temperature);
  const r = ION_RADIUS;

  // Warm halo grows with temperature (like the glow in a hot metal).
  if (heat > 0.02) {
    const halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * (1.6 + heat * 1.3));
    halo.addColorStop(0, `rgba(255, 88, 40, ${0.15 + heat * 0.55})`);
    halo.addColorStop(1, "rgba(255, 88, 40, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * (1.6 + heat * 1.3), 0, Math.PI * 2);
    ctx.fill();
  } else if (cold > 0.02) {
    const halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * (1.5 + cold * 0.8));
    halo.addColorStop(0, `rgba(90, 160, 235, ${0.1 + cold * 0.35})`);
    halo.addColorStop(1, "rgba(90, 160, 235, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * (1.5 + cold * 0.8), 0, Math.PI * 2);
    ctx.fill();
  }

  const centre = mix(rgb, [255, 255, 255], 0.42);
  const edge = rgb.map((value) => Math.round(value * 0.55));
  const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, r * 0.12, x, y, r);
  g.addColorStop(0, rgbString(centre));
  g.addColorStop(0.42, rgbString(rgb));
  g.addColorStop(1, rgbString(edge));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Positive ion marker.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  const arm = r * 0.36;
  ctx.moveTo(x - arm, y);
  ctx.lineTo(x + arm, y);
  ctx.moveTo(x, y - arm);
  ctx.lineTo(x, y + arm);
  ctx.stroke();

  // Brief ripple when an electron has just bounced off.
  const sinceHit = time - (ion.lastHit ?? -10);
  if (sinceHit < 0.3) {
    const progress = sinceHit / 0.3;
    ctx.beginPath();
    ctx.arc(x, y, r + 2 + progress * 9, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.75 * (1 - progress)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawElectron(ctx, electron) {
  const { x, y, vx, vy } = electron;
  const r = ELECTRON_RADIUS;
  const { heat, cold } = temperatureColour(electronTemperature(electron));

  const speed = Math.hypot(vx, vy);
  if (speed > 1) {
    const trail = Math.min(0.09, 4.4 / speed);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - vx * trail, y - vy * trail);
    ctx.strokeStyle = "rgba(38, 175, 232, 0.3)";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  if (heat > 0.05) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2 + heat * 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 96, 40, ${0.18 + heat * 0.42})`;
    ctx.fill();
  }

  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
  g.addColorStop(0, "#e9fcff");
  g.addColorStop(0.38, cold > 0.3 ? "#58b8f5" : "#63d9ff");
  g.addColorStop(1, cold > 0.3 ? "#0a5a9c" : "#0878b6");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

function drawTemperatureScale(ctx) {
  const x = LATTICE_X + 360;
  const width = LATTICE_WIDTH - 390;
  const y = LATTICE_BOTTOM + 34;
  const height = 10;

  ctx.fillStyle = "#4a5d6c";
  ctx.font = "750 11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("Temperature", x - 12, y + height / 2);

  const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
  for (let i = 0; i <= 20; i += 1) {
    const celsius = SCALE_MIN_C + ((SCALE_MAX_C - SCALE_MIN_C) * i) / 20;
    gradient.addColorStop(i / 20, rgbString(temperatureColour(celsius + 273).rgb));
  }
  roundedRect(ctx, x, y, width, height, 5);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.fillStyle = "#5c6d7a";
  ctx.font = "650 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const celsius of [-50, 0, 100, 200, 300]) {
    const tx = x + ((celsius - SCALE_MIN_C) / (SCALE_MAX_C - SCALE_MIN_C)) * width;
    ctx.fillRect(tx - 0.5, y + height, 1, 4);
    ctx.fillText(`${formatC(celsius)} °C`, tx, y + height + 6);
  }
}

function drawParticleKey(ctx) {
  const x = LATTICE_X + 6;
  const y = LATTICE_BOTTOM + 39;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "750 11px system-ui, sans-serif";

  drawIon(ctx, { restX: x + 10, restY: y, dx: 0, dy: 0, temperature: ROOM_TEMP }, -10);
  ctx.fillStyle = "#243d50";
  ctx.fillText("positive ion", x + 32, y);

  drawElectron(ctx, { x: x + 128, y, vx: 0, vy: 0 });
  ctx.fillStyle = "#243d50";
  ctx.fillText("free electron", x + 140, y);
}

function drawProfilePanel(ctx, state) {
  const panel = PROFILE_PANEL;
  drawPanel(ctx, panel, "Temperature along the bar");

  const average = toCelsius(metalTemperature(state));
  ctx.textAlign = "right";
  ctx.fillStyle = "#5c6d7a";
  ctx.font = "650 11px system-ui, sans-serif";
  ctx.fillText("metal average", panel.x + panel.width - 72, panel.y + 26);
  roundedRect(ctx, panel.x + panel.width - 66, panel.y + 15, 50, 22, 5);
  ctx.fillStyle = "#f4f7f9";
  ctx.fill();
  ctx.strokeStyle = "#c9d4dc";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#19324a";
  ctx.font = "800 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${formatC(Math.round(average))}°C`, panel.x + panel.width - 41, panel.y + 26.5);

  const plot = {
    x: panel.x + 58,
    y: panel.y + 52,
    width: panel.width - 76,
    height: panel.height - 112,
  };
  const yFor = (celsius) =>
    plot.y + plot.height - ((celsius - PROFILE_MIN_C) / (PROFILE_MAX_C - PROFILE_MIN_C)) * plot.height;

  // Grid and axis labels
  ctx.font = "600 10px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let celsius = PROFILE_MIN_C; celsius <= PROFILE_MAX_C; celsius += 50) {
    const y = yFor(celsius);
    ctx.strokeStyle = celsius === 0 ? "rgba(96, 116, 130, 0.45)" : "rgba(203, 213, 223, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    ctx.stroke();
    ctx.fillStyle = "#6b7b87";
    ctx.fillText(formatC(celsius), plot.x - 7, y);
  }
  ctx.save();
  ctx.translate(panel.x + 18, plot.y + plot.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillStyle = "#4a5d6c";
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.fillText("Temperature / °C", 0, 0);
  ctx.restore();

  // Room temperature reference
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(74, 93, 108, 0.6)";
  ctx.beginPath();
  ctx.moveTo(plot.x, yFor(ROOM_C));
  ctx.lineTo(plot.x + plot.width, yFor(ROOM_C));
  ctx.stroke();
  ctx.restore();

  const slotWidth = plot.width / TOTAL_COLUMNS;
  const baseY = plot.y + plot.height;
  const electronPoints = [];

  for (let column = 0; column < TOTAL_COLUMNS; column += 1) {
    const cx = plot.x + slotWidth * (column + 0.5);
    const isSource = column === SOURCE_COLUMN;
    const isSink = column === SINK_COLUMN;
    const present = (!isSource || state.sourceOn) && (!isSink || state.sinkOn);
    const barWidth = slotWidth * 0.62;

    if (!present) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#b9c5ce";
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - barWidth / 2, plot.y + 4, barWidth, plot.height - 4);
      ctx.restore();
      ctx.fillStyle = "#93a2ad";
      ctx.font = "650 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("off", cx, plot.y + plot.height / 2);
    } else {
      const kelvin = state.columnIonTemp[column];
      const celsius = Math.max(PROFILE_MIN_C, Math.min(PROFILE_MAX_C, toCelsius(kelvin)));
      const top = yFor(celsius);
      const { rgb } = temperatureColour(kelvin);
      ctx.fillStyle = rgbString(rgb, isSource || isSink ? 0.75 : 0.92);
      roundedRect(ctx, cx - barWidth / 2, top, barWidth, baseY - top, 3);
      ctx.fill();
      if (isSource || isSink) {
        drawHatch(ctx, cx - barWidth / 2, top, barWidth, baseY - top, "rgba(255, 255, 255, 0.4)");
      }
      const electronKelvin = state.columnElectronTemp[column];
      if (Number.isFinite(electronKelvin) && state.electrons.length) {
        const ec = Math.max(PROFILE_MIN_C, Math.min(PROFILE_MAX_C, toCelsius(electronKelvin)));
        electronPoints.push([cx, yFor(ec)]);
      } else {
        electronPoints.push(null);
      }
    }
    if (!present) electronPoints.push(null);

    ctx.fillStyle = isSource ? HOT : isSink ? COLD : "#6b7b87";
    ctx.font = `${isSource || isSink ? 800 : 650} 10px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(isSource ? "hot" : isSink ? "cold" : String(column), cx, baseY + 6);
  }

  // Electron temperatures as a joined line of dots.
  ctx.strokeStyle = "rgba(8, 120, 182, 0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let drawing = false;
  for (const point of electronPoints) {
    if (!point) {
      drawing = false;
      continue;
    }
    if (drawing) ctx.lineTo(point[0], point[1]);
    else ctx.moveTo(point[0], point[1]);
    drawing = true;
  }
  ctx.stroke();
  for (const point of electronPoints) {
    if (!point) continue;
    ctx.beginPath();
    ctx.arc(point[0], point[1], 4.2, 0, Math.PI * 2);
    ctx.fillStyle = "#38c5f5";
    ctx.fill();
    ctx.strokeStyle = "#0878b6";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Axis title and legend
  ctx.fillStyle = "#4a5d6c";
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(`Column of ions (1 – ${METAL_COLUMNS} across the metal)`, plot.x + plot.width / 2, baseY + 22);

  const legendY = panel.y + panel.height - 14;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = "650 10.5px system-ui, sans-serif";
  const legendX = plot.x + plot.width / 2 - 178;
  ctx.fillStyle = rgbString(ION_HOT, 0.8);
  roundedRect(ctx, legendX, legendY - 6, 14, 12, 2);
  ctx.fill();
  ctx.fillStyle = "#344554";
  ctx.fillText("ions (average)", legendX + 20, legendY);

  const ex = legendX + 118;
  ctx.beginPath();
  ctx.arc(ex + 6, legendY, 4.2, 0, Math.PI * 2);
  ctx.fillStyle = "#38c5f5";
  ctx.fill();
  ctx.strokeStyle = "#0878b6";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#344554";
  ctx.fillText("electrons", ex + 16, legendY);

  const rx = ex + 92;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(74, 93, 108, 0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rx, legendY);
  ctx.lineTo(rx + 18, legendY);
  ctx.stroke();
  ctx.restore();
  ctx.fillText(`room temperature`, rx + 24, legendY);
}

function drawFlowPanel(ctx, state) {
  const panel = FLOW_PANEL;
  drawPanel(ctx, panel, "Rate of heat flow");
  ctx.textAlign = "right";
  ctx.fillStyle = "#6b7b87";
  ctx.font = "650 10.5px system-ui, sans-serif";
  ctx.fillText(`averaged over ${POWER_AVERAGE_SECONDS} s of simulation`, panel.x + panel.width - 18, panel.y + 26);

  const plot = {
    x: panel.x + 58,
    y: panel.y + 84,
    width: panel.width - 76,
    height: panel.height - 128,
  };

  // Live readouts
  const readouts = [
    { label: "in from hot source", value: state.sourceOn ? state.sourcePower : null, colour: HOT },
    { label: "out to cold sink", value: state.sinkOn ? state.sinkPower : null, colour: COLD },
  ];
  readouts.forEach((item, index) => {
    const x = panel.x + 18 + index * ((panel.width - 36) / 2);
    const y = panel.y + 46;
    ctx.fillStyle = item.colour;
    ctx.fillRect(x, y - 1, 16, 3);
    ctx.fillStyle = "#344554";
    ctx.font = "650 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(item.label, x + 22, y);
    ctx.font = "800 15px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = item.value === null ? "#9aa8b2" : item.colour;
    ctx.fillText(item.value === null ? "off" : Math.max(0, item.value).toFixed(1), x + 22, y + 18);
  });

  const values = state.history.flatMap((sample) => [sample.source, sample.sink]).filter((v) => v !== null);
  const peak = Math.max(4, ...values);
  const yMax = Math.ceil(peak / 2) * 2;
  const yMin = 0;
  const yFor = (value) =>
    plot.y + plot.height - ((Math.max(yMin, value) - yMin) / (yMax - yMin)) * plot.height;
  const xFor = (time) => plot.x + plot.width - ((state.time - time) / HISTORY_SECONDS) * plot.width;

  ctx.font = "600 10px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const stepSize = yMax <= 8 ? 1 : yMax <= 16 ? 2 : 4;
  for (let value = 0; value <= yMax; value += stepSize) {
    const y = yFor(value);
    ctx.strokeStyle = value === 0 ? "rgba(96, 116, 130, 0.5)" : "rgba(203, 213, 223, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    ctx.stroke();
    ctx.fillStyle = "#6b7b87";
    ctx.fillText(String(value), plot.x - 7, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let seconds = 0; seconds <= HISTORY_SECONDS; seconds += 30) {
    const x = plot.x + plot.width - (seconds / HISTORY_SECONDS) * plot.width;
    ctx.fillStyle = "#6b7b87";
    ctx.fillText(seconds === 0 ? "now" : `−${seconds}`, x, plot.y + plot.height + 6);
  }
  ctx.fillStyle = "#4a5d6c";
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.fillText("Time / s", plot.x + plot.width / 2, plot.y + plot.height + 21);
  ctx.save();
  ctx.translate(panel.x + 18, plot.y + plot.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Energy per second", 0, 0);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y - 2, plot.width, plot.height + 4);
  ctx.clip();
  for (const key of ["source", "sink"]) {
    ctx.strokeStyle = key === "source" ? HOT : COLD;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let drawing = false;
    for (const sample of state.history) {
      const value = sample[key];
      if (value === null) {
        drawing = false;
        continue;
      }
      const x = xFor(sample.time);
      const y = yFor(value);
      if (drawing) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      drawing = true;
    }
    ctx.stroke();
  }
  ctx.restore();

  if (!state.sourceOn && !state.sinkOn) {
    ctx.fillStyle = "#7d8d99";
    ctx.font = "650 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Turn on the hot source or cold sink", plot.x + plot.width / 2, plot.y + plot.height / 2);
  }
}

function drawScene(ctx, state, time) {
  ctx.setTransform(CANVAS_RENDER_SCALE, 0, 0, CANVAS_RENDER_SCALE, 0, 0);
  const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  background.addColorStop(0, "#f7fafc");
  background.addColorStop(1, "#e8edf2");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawFrame(ctx);
  drawLatticeBackground(ctx, state, time);

  ctx.save();
  roundedRect(ctx, LATTICE_X, LATTICE_Y, LATTICE_WIDTH, LATTICE_HEIGHT, 14);
  ctx.clip();
  for (const ion of state.ions) {
    drawIon(ctx, ion, state.time, displayTemperature(ion, state.columnIonTemp[ion.column]));
  }
  for (const electron of state.electrons) drawElectron(ctx, electron);
  ctx.restore();

  drawParticleKey(ctx);
  drawTemperatureScale(ctx);
  drawProfilePanel(ctx, state);
  drawFlowPanel(ctx, state);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  useFitToScreen();

  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const sliderRef = useRef(null);
  const draggingRef = useRef(false);

  const [electronCount, setElectronCountState] = useState(DEFAULT_ELECTRONS);
  const [sourceOn, setSourceOn] = useState(false);
  const [sinkOn, setSinkOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showExplanation, setShowExplanation] = useState(false);

  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  useEffect(() => {
    pausedRef.current = paused;
    speedRef.current = speed;
  }, [paused, speed]);

  if (simRef.current === null) {
    simRef.current = createState(DEFAULT_ELECTRONS);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let frame = 0;
    let last = performance.now();

    const tick = (now) => {
      const elapsed = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) step(simRef.current, elapsed * speedRef.current);
      drawScene(ctx, simRef.current, now / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const changeElectronCount = useCallback((value) => {
    const next = Math.max(0, Math.min(MAX_ELECTRONS, Math.round(value)));
    setElectronCount(simRef.current, next);
    setElectronCountState(next);
  }, []);

  const toggleSource = () => {
    const next = !sourceOn;
    setSource(simRef.current, next);
    setSourceOn(next);
  };

  const toggleSink = () => {
    const next = !sinkOn;
    setSink(simRef.current, next);
    setSinkOn(next);
  };

  const resetAll = () => {
    resetTemperatures(simRef.current);
  };

  const valueFromPointer = (event) => {
    const rect = sliderRef.current.getBoundingClientRect();
    const inner = rect.width - SLIDER_POINTER_GUTTER * 2;
    const fraction = clamp01((event.clientX - rect.left - SLIDER_POINTER_GUTTER) / inner);
    return Math.round((fraction * MAX_ELECTRONS) / 5) * 5;
  };

  const handlePointerDown = (event) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus();
    changeElectronCount(valueFromPointer(event));
  };
  const handlePointerMove = (event) => {
    if (!draggingRef.current) return;
    changeElectronCount(valueFromPointer(event));
  };
  const handlePointerUp = (event) => {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const handleSliderKeyDown = (event) => {
    const keys = {
      ArrowLeft: -5,
      ArrowDown: -5,
      ArrowRight: 5,
      ArrowUp: 5,
      PageDown: -20,
      PageUp: 20,
    };
    if (event.key in keys) {
      event.preventDefault();
      changeElectronCount(electronCount + keys[event.key]);
    } else if (event.key === "Home") {
      event.preventDefault();
      changeElectronCount(0);
    } else if (event.key === "End") {
      event.preventDefault();
      changeElectronCount(MAX_ELECTRONS);
    }
  };

  useEffect(() => {
    if (!showExplanation) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setShowExplanation(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showExplanation]);

  const sliderPercent = (electronCount / MAX_ELECTRONS) * 100;

  return (
    <div
      className="fs-page"
      onClickCapture={(event) => {
        event.target.closest?.("button")?.blur();
      }}
    >
      <style>{layoutCss}</style>

      <main className="fs-shell">
        <header className="fs-header">
          <div className="fs-title">
            <BrandLogo />
            <h1>Thermal conduction in metals</h1>
          </div>

          <div className="fs-header-actions">
            <button
              type="button"
              className="fs-header-button"
              onClick={() => setShowExplanation(true)}
            >
              How heat moves
            </button>
            <FullscreenButton />
          </div>
        </header>

        <section className="fs-stage-card" aria-label="Particle simulation and graphs">
          <div className="fs-stage-controls" aria-label="Simulation controls">
            <div className="fs-electron-control">
              <div className="fs-control-heading">
                <span>Number of free electrons</span>
                <span className="fs-control-value">{electronCount}</span>
              </div>
              <div className="fs-stepper">
                <button
                  type="button"
                  className="fs-step-button"
                  onClick={() => changeElectronCount(electronCount - ELECTRON_STEP)}
                  disabled={electronCount <= 0}
                  aria-label={`Remove ${ELECTRON_STEP} electrons`}
                  title={`Remove ${ELECTRON_STEP}`}
                >
                  −
                </button>
                <div
                  className="fs-slider-wrap"
                  ref={sliderRef}
                  style={{ "--slider-position": `${sliderPercent}%` }}
                >
                  <div
                    className="fs-slider-hit-area"
                    role="slider"
                    tabIndex={0}
                    aria-label="Number of free electrons"
                    aria-valuemin={0}
                    aria-valuemax={MAX_ELECTRONS}
                    aria-valuenow={electronCount}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onKeyDown={handleSliderKeyDown}
                  />
                  <span className="fs-slider-rail" aria-hidden="true" />
                  <span className="fs-slider-thumb" aria-hidden="true" />
                  <span className="fs-slider-end is-min" aria-hidden="true">0</span>
                  <span className="fs-slider-end is-max" aria-hidden="true">{MAX_ELECTRONS}</span>
                </div>
                <button
                  type="button"
                  className="fs-step-button"
                  onClick={() => changeElectronCount(electronCount + ELECTRON_STEP)}
                  disabled={electronCount >= MAX_ELECTRONS}
                  aria-label={`Add ${ELECTRON_STEP} electrons`}
                  title={`Add ${ELECTRON_STEP}`}
                >
                  +
                </button>
              </div>
            </div>

            <div className="fs-reservoir-toggles">
              <label className={`fs-reservoir-toggle is-hot${sourceOn ? " is-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={sourceOn}
                  onChange={(event) => {
                    toggleSource();
                    event.currentTarget.blur();
                  }}
                />
                <span className="fs-toggle-track" aria-hidden="true">
                  <span className="fs-toggle-thumb" />
                </span>
                <span className="fs-toggle-text">
                  <strong>Hot source</strong>
                  <span>left end · {SOURCE_C} °C</span>
                </span>
              </label>

              <label className={`fs-reservoir-toggle is-cold${sinkOn ? " is-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={sinkOn}
                  onChange={(event) => {
                    toggleSink();
                    event.currentTarget.blur();
                  }}
                />
                <span className="fs-toggle-track" aria-hidden="true">
                  <span className="fs-toggle-thumb" />
                </span>
                <span className="fs-toggle-text">
                  <strong>Cold sink</strong>
                  <span>right end · {formatC(SINK_C)} °C</span>
                </span>
              </label>
            </div>

            <div className="fs-actions">
              <button type="button" className="fs-action-button" onClick={() => setPaused((value) => !value)}>
                {paused ? "Resume" : "Pause"}
              </button>
              <button type="button" className="fs-action-button is-quiet" onClick={resetAll}>
                Reset to {ROOM_C} °C
              </button>
              <div className="fs-speed" role="group" aria-label="Simulation speed">
                {SPEEDS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={value === speed ? "is-active" : ""}
                    aria-pressed={value === speed}
                    onClick={() => setSpeed(value)}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="fs-stage-wrap">
            <canvas
              ref={canvasRef}
              width={WIDTH * CANVAS_RENDER_SCALE}
              height={HEIGHT * CANVAS_RENDER_SCALE}
              className="fs-stage"
              role="img"
              aria-label="Ions vibrating on a lattice with free electrons moving between them. A hot source can be added at the left end and a cold sink at the right end."
            />
          </div>
        </section>

        <SiteFooter />
      </main>

      {showExplanation && (
        <div
          className="fs-modal-backdrop"
          role="presentation"
          onClick={() => setShowExplanation(false)}
        >
          <div
            className="fs-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fs-explanation-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fs-modal-header">
              <h2 id="fs-explanation-title">How heat moves through a metal</h2>
              <button
                type="button"
                className="fs-modal-close"
                onClick={() => setShowExplanation(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="fs-modal-body">
              <section>
                <h3>Ions vibrate</h3>
                <p>
                  The positive ions are held in a regular lattice, but each one vibrates about
                  its fixed position. The hotter the metal, the more kinetic energy each ion has
                  and the more it vibrates. Ion colour shows its temperature.
                </p>
              </section>
              <section>
                <h3>Free electrons carry the energy</h3>
                <p>
                  Free electrons move quickly between the ions. When an electron hits a
                  fast-vibrating ion it usually bounces off with more energy; when it later hits
                  a slower ion it usually hands some of that energy on. In this model the ions
                  never touch each other, so electrons are the only way energy can travel along
                  the bar.
                </p>
              </section>
              <section>
                <h3>Hot source and cold sink</h3>
                <p>
                  Each is an extra column of ions in thermal contact with the end of the bar.
                  A heater keeps the source ions at {SOURCE_C} °C and a cooler keeps the sink ions
                  at {formatC(SINK_C)} °C, however much energy the electrons carry in or out. The heat-flow
                  graph shows how fast energy is being supplied and removed.
                </p>
              </section>
              <section>
                <h3>Things to try</h3>
                <p>
                  Turn on both ends and wait for a steady temperature gradient. Then compare the
                  rate of heat flow with very few electrons, with many, and with none at all.
                  Real metals also pass a little energy directly from ion to ion, but the free
                  electrons are why metals are such good thermal conductors.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const pct = (value, total) => `${(value / total) * 100}%`;

const layoutCss = `
  .fs-page,
  .fs-page * {
    box-sizing: border-box;
  }

  .fs-page {
    width: 100%;
    min-height: calc(100 * var(--fs-vh, 1vh));
    min-height: 100svh;
    margin: 0;
    padding: clamp(7px, calc(0.8 * var(--fs-vw, 1vw)), 12px) clamp(14px, calc(2 * var(--fs-vw, 1vw)), 28px);
    overflow-x: clip;
    background: #dfe5ea;
    color: #1f2933;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
    text-align: left;
  }

  .fs-shell {
    width: 100%;
    margin: 0 auto;
    display: grid;
    gap: clamp(5px, calc(0.55 * var(--fs-vw, 1vw)), 8px);
  }

  /* Laptop and larger (see useFitToScreen.js): the page is laid out at a
     reference size and scaled up to fill the window. The stage keeps a fixed
     shape (width ≈ 1.739 × height); 75px covers the page padding, header and
     footer line. */
  .fs-fit .fs-page {
    box-sizing: border-box;
    width: var(--fs-layout-w);
    min-height: var(--fs-layout-h);
    padding: 6px 12px;
    transform: scale(var(--fs-scale));
    transform-origin: 0 0;
  }

  .fs-fit .fs-shell {
    width: min(100%, calc((var(--fs-layout-h) - 75px) * 1.739));
  }

  html.fs-fit {
    background: #dfe5ea;
  }

  .fs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: clamp(14px, calc(1.2 * var(--fs-vw, 1vw)), 18px);
    min-height: 25px;
    padding: 0 2px;
  }

  .fs-header h1 {
    min-width: 0;
    margin: 0;
    font-size: clamp(22px, calc(1.9 * var(--fs-vw, 1vw)), 30px);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: #19324a;
  }

  .fs-header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7px;
    flex: 0 0 auto;
  }

  .fs-header-button {
    flex: 0 0 auto;
    border: 1px solid #9aa9b5;
    background: #ffffff;
    color: #19324a;
    border-radius: 8px;
    padding: 4px 10px;
    min-height: 27px;
    font-size: 11.5px;
    font-weight: 750;
    cursor: pointer;
  }

  .fs-header-button:hover {
    background: #f3f6f8;
  }

  .fs-header-button:focus-visible,
  .fs-modal-close:focus-visible {
    outline: 3px solid rgba(25, 50, 74, 0.28);
    outline-offset: 2px;
  }

  .fs-stage-card {
    position: relative;
    width: 100%;
    overflow: hidden;
    background: #ffffff;
    border: 1px solid #cbd5df;
    border-radius: 16px;
    box-shadow: 0 8px 24px rgba(31, 41, 51, 0.08);
  }

  .fs-stage-wrap {
    position: relative;
    width: 100%;
  }

  .fs-stage {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: ${WIDTH} / ${HEIGHT};
  }

  /* Control panel floats over the top of the right-hand column */
  .fs-stage-controls {
    position: absolute;
    z-index: 4;
    left: ${pct(PANEL_X, WIDTH)};
    top: ${pct(CONTROLS.y, HEIGHT)};
    width: ${pct(PANEL_WIDTH, WIDTH)};
    height: ${pct(CONTROLS.height, HEIGHT)};
    padding: 8px 10px;
    display: grid;
    grid-template-rows: auto auto auto;
    align-content: space-between;
    gap: 6px;
    border: 1px solid rgba(171, 186, 198, 0.9);
    border-radius: 10px;
    background: #f8fafc;
    box-shadow: 0 3px 10px rgba(31, 41, 51, 0.065);
  }

  .fs-control-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: #354655;
    font-size: 11px;
    font-weight: 650;
    line-height: 1.1;
  }

  .fs-control-value {
    min-width: 48px;
    padding: 2px 6px;
    border: 1px solid #9fc5ed;
    border-radius: 4px;
    background: #eaf4ff;
    color: #174f7a;
    font: 800 13px/1.15 ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .fs-stepper {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) 24px;
    align-items: start;
    gap: 9px;
    margin-top: 5px;
  }

  .fs-step-button {
    position: relative;
    z-index: 2;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid #b8c3cc;
    border-radius: 6px;
    background: #ffffff;
    color: #26333d;
    font-size: 16px;
    font-weight: 800;
    line-height: 1;
    cursor: pointer;
  }

  .fs-step-button:hover:not(:disabled) {
    background: #eef3f6;
  }

  .fs-step-button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .fs-step-button:focus-visible {
    outline: 3px solid rgba(25, 50, 74, 0.24);
    outline-offset: 2px;
  }

  .fs-slider-wrap {
    position: relative;
    min-width: 0;
    height: 30px;
  }

  .fs-slider-rail {
    position: absolute;
    left: 0;
    right: 0;
    top: 6px;
    height: 6px;
    border: 1px solid rgba(82, 103, 120, 0.34);
    border-radius: 999px;
    background: linear-gradient(
      to right,
      #6ea8dc 0%,
      #6ea8dc var(--slider-position),
      #d4dde5 var(--slider-position),
      #d4dde5 100%
    );
    pointer-events: none;
  }

  .fs-slider-thumb {
    position: absolute;
    z-index: 1;
    left: var(--slider-position);
    top: 1.5px;
    width: 15px;
    height: 15px;
    transform: translateX(-50%);
    border: 2px solid #4d8fc8;
    border-radius: 50%;
    background: #fafdff;
    box-shadow: 0 1px 3px rgba(31, 50, 65, 0.26);
    pointer-events: none;
  }

  .fs-slider-hit-area {
    position: absolute;
    z-index: 2;
    left: -${SLIDER_POINTER_GUTTER}px;
    right: -${SLIDER_POINTER_GUTTER}px;
    top: -7px;
    height: 32px;
    border-radius: 999px;
    cursor: pointer;
    touch-action: none;
  }

  .fs-slider-hit-area:focus-visible {
    outline: 3px solid rgba(77, 143, 200, 0.24);
    outline-offset: -2px;
  }

  .fs-slider-end {
    position: absolute;
    top: 18px;
    color: #667581;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
  }

  .fs-slider-end.is-min { left: 0; }
  .fs-slider-end.is-max { right: 0; }

  .fs-reservoir-toggles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    padding-top: 6px;
    border-top: 1px solid rgba(203, 213, 223, 0.72);
  }

  .fs-reservoir-toggle {
    --tone: #d9480f;
    --tone-soft: rgba(255, 112, 52, 0.12);
    --tone-border: rgba(217, 72, 15, 0.5);
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    min-height: 38px;
    padding: 5px 8px;
    border: 1px solid #aebdca;
    border-radius: 9px;
    background: #ffffff;
    color: #29445a;
    cursor: pointer;
    user-select: none;
    transition: background 140ms ease, border-color 140ms ease;
  }

  .fs-reservoir-toggle.is-cold {
    --tone: #1f6fb8;
    --tone-soft: rgba(64, 140, 220, 0.12);
    --tone-border: rgba(31, 111, 184, 0.5);
  }

  .fs-reservoir-toggle.is-on {
    border-color: var(--tone-border);
    background: var(--tone-soft);
  }

  .fs-reservoir-toggle input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .fs-toggle-track {
    position: relative;
    flex: 0 0 auto;
    width: 30px;
    height: 17px;
    border: 1px solid #8c9aa6;
    border-radius: 999px;
    background: #cbd4dc;
    transition: background 140ms ease, border-color 140ms ease;
  }

  .fs-toggle-thumb {
    position: absolute;
    left: 2px;
    top: 2px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(31, 50, 65, 0.3);
    transition: transform 140ms ease;
  }

  .fs-reservoir-toggle input:checked + .fs-toggle-track {
    border-color: var(--tone);
    background: var(--tone);
  }

  .fs-reservoir-toggle input:checked + .fs-toggle-track .fs-toggle-thumb {
    transform: translateX(13px);
  }

  .fs-reservoir-toggle input:focus-visible + .fs-toggle-track {
    outline: 3px solid rgba(77, 143, 200, 0.26);
    outline-offset: 2px;
  }

  .fs-toggle-text {
    display: grid;
    gap: 2px;
    min-width: 0;
    line-height: 1.05;
  }

  .fs-toggle-text strong {
    color: var(--tone);
    font-size: 11.5px;
    font-weight: 800;
    white-space: nowrap;
  }

  .fs-toggle-text span {
    color: #667581;
    font-size: 9.5px;
    font-weight: 650;
    white-space: nowrap;
  }

  .fs-actions {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.1fr) minmax(0, 1fr);
    align-items: center;
    gap: 5px;
    padding-top: 6px;
    border-top: 1px solid rgba(203, 213, 223, 0.72);
  }

  .fs-action-button {
    min-height: 28px;
    padding: 3px 6px;
    border: 1px solid #b8c3cc;
    border-radius: 6px;
    background: #ffffff;
    color: #26333d;
    font-size: 10.5px;
    font-weight: 750;
    white-space: nowrap;
    cursor: pointer;
  }

  .fs-action-button:hover {
    background: #eef3f6;
  }

  .fs-action-button.is-quiet {
    border-color: #c9d1d8;
    background: #f8fafb;
    color: #667581;
  }

  .fs-action-button:focus-visible,
  .fs-speed button:focus-visible {
    outline: 3px solid rgba(25, 50, 74, 0.24);
    outline-offset: 2px;
  }

  .fs-speed {
    display: grid;
    grid-template-columns: repeat(${SPEEDS.length}, minmax(0, 1fr));
    min-height: 28px;
    overflow: hidden;
    border: 1px solid #b8c3cc;
    border-radius: 6px;
    background: #ffffff;
  }

  .fs-speed button {
    padding: 0 2px;
    border: 0;
    border-left: 1px solid #d4dde5;
    background: transparent;
    color: #4a5d6c;
    font-size: 10.5px;
    font-weight: 750;
    cursor: pointer;
  }

  .fs-speed button:first-child {
    border-left: 0;
  }

  .fs-speed button.is-active {
    background: #4d8fc8;
    color: #ffffff;
  }

  .fs-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(20, 28, 36, 0.58);
  }

  .fs-modal {
    width: min(calc(92 * var(--fs-vw, 1vw)), 580px);
    max-height: min(calc(88 * var(--fs-vh, 1vh)), 720px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #c7d1d9;
    border-radius: 16px;
    background: #ffffff;
    box-shadow: 0 24px 70px rgba(20, 28, 36, 0.28);
  }

  .fs-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
    border-bottom: 1px solid #dbe2e8;
    background: #f7f9fb;
  }

  .fs-modal-header h2 {
    margin: 0;
    color: #19324a;
    font-size: 17px;
    font-weight: 700;
    line-height: 1.2;
  }

  .fs-modal-close {
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid #bfcbd4;
    border-radius: 8px;
    background: #ffffff;
    color: #465762;
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
  }

  .fs-modal-body {
    padding: clamp(18px, calc(2.3 * var(--fs-vw, 1vw)), 26px);
    overflow: auto;
    color: #344554;
    font-size: clamp(13px, calc(0.95 * var(--fs-vw, 1vw)), 15px);
    line-height: 1.55;
  }

  .fs-modal-body section + section {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid #dbe4ea;
  }

  .fs-modal-body h3 {
    margin: 0 0 5px;
    color: #193f5b;
    font-size: 15px;
    line-height: 1.25;
  }

  .fs-modal-body p {
    margin: 0;
  }

  @media (max-width: 820px) {
    .fs-header {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .fs-header-button {
      min-height: 34px;
    }

    .fs-stage-controls {
      position: static;
      width: auto;
      height: auto;
      margin: 10px;
      padding: 10px 12px;
      gap: 10px;
      box-shadow: none;
    }

    .fs-modal-backdrop {
      padding: 12px;
    }
  }

  @media (max-width: 480px) {
    .fs-page {
      padding: 10px;
    }

    .fs-reservoir-toggles,
    .fs-actions {
      grid-template-columns: 1fr;
    }
  }
`;
