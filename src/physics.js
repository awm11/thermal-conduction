// Model of thermal conduction in a metal, after the DoITPoMS "Thermal
// conduction in metals" simulation.
//
// Every ion and every free electron carries an amount of heat, shown as its
// temperature. Ions sit at fixed lattice sites and vibrate more when they are
// hotter. Electrons fly between them at a steady speed. When an electron hits
// an ion they share their heat equally (both end up at the average of the two
// temperatures) and the electron bounces off in a new direction. Heat is
// never created or destroyed in a collision, and the ions never touch each
// other, so electrons are the only way heat can travel along the bar.
//
// The hot source and cold sink are extra columns of ions at the two ends of
// the metal, in thermal contact with it: electrons wander in and out of them
// just as they do between any other columns. A heater or cooler holds their
// ions at a fixed temperature; the heat it has to add or remove to do so is
// the heat flow.
//
// Units: lengths in stage pixels, time in seconds, temperatures in kelvin.

export const SPACING = 84;
export const ROWS = 8;
export const METAL_COLUMNS = 9;
export const TOTAL_COLUMNS = METAL_COLUMNS + 2; // source slot + metal + sink slot
export const SOURCE_COLUMN = 0;
export const SINK_COLUMN = TOTAL_COLUMNS - 1;

export const LATTICE_X = 76;
export const LATTICE_Y = 116;
export const LATTICE_WIDTH = TOTAL_COLUMNS * SPACING;
export const LATTICE_HEIGHT = (ROWS + 0.5) * SPACING;

// Ions are drawn at exactly the size electrons bounce off.
export const ION_RADIUS = 24;
export const ELECTRON_RADIUS = 4.6;
const CONTACT_DISTANCE = ION_RADIUS + ELECTRON_RADIUS;
const CONTACT_DISTANCE_SQ = CONTACT_DISTANCE * CONTACT_DISTANCE;

export const KELVIN_OFFSET = 273;
export const ROOM_TEMP = 293; // 20 °C
export const SOURCE_TEMP = 573; // 300 °C
export const SINK_TEMP = 223; // −50 °C

// Electrons all move at about this speed, whatever their temperature; their
// glow, not their speed, shows how much heat they carry.
const ELECTRON_SPEED = 170;
const ELECTRON_SPEED_SPREAD = 0.25;
// After a collision an electron leaves within this angle of straight out
// from the ion, so it never sticks and its path is randomised.
const SCATTER_HALF_ANGLE = Math.PI / 3;
// Each collision moves this fraction of the temperature difference: 0.5 means
// electron and ion both end at their average, as in the DoITPoMS model.
const HEAT_SHARE = 0.5;

// Ion vibration: amplitude grows with temperature (amplitude² ∝ T).
const VIBRATION_AT_ROOM = 3.4;

const MAX_SUBSTEP = 1 / 120;
const POWER_SMOOTHING_S = 6;
const POWER_SAMPLE_S = 0.25;
export const HISTORY_SECONDS = 120;
const HISTORY_SAMPLE_S = 0.5;

// Heat flow is shown in arbitrary units scaled to tidy numbers.
const POWER_UNIT = 100;
export const POWER_AVERAGE_SECONDS = POWER_SMOOTHING_S;

export const MAX_ELECTRONS = 600;
export const DEFAULT_ELECTRONS = 150;

export const toCelsius = (kelvin) => kelvin - KELVIN_OFFSET;

export function columnX(column) {
  return LATTICE_X + SPACING / 2 + column * SPACING;
}

function siteY(column, row) {
  return LATTICE_Y + SPACING / 2 + row * SPACING + (column % 2 === 1 ? SPACING / 2 : 0);
}

export function domainBounds(state) {
  return {
    left: LATTICE_X + (state.sourceOn ? 0 : SPACING),
    right: LATTICE_X + LATTICE_WIDTH - (state.sinkOn ? 0 : SPACING),
    top: LATTICE_Y,
    bottom: LATTICE_Y + LATTICE_HEIGHT,
  };
}

function makeColumn(column, temperature) {
  const ions = [];
  for (let row = 0; row < ROWS; row += 1) {
    ions.push({
      column,
      row,
      restX: columnX(column),
      restY: siteY(column, row),
      dx: 0,
      dy: 0,
      // Each ion vibrates in its own slightly different elliptical pattern.
      freqX: 2 * Math.PI * (1.6 + Math.random() * 0.8),
      freqY: 2 * Math.PI * (1.6 + Math.random() * 0.8),
      phaseX: Math.random() * 2 * Math.PI,
      phaseY: Math.random() * 2 * Math.PI,
      temperature,
    });
  }
  return ions;
}

export function electronTemperature(electron) {
  return electron.temperature;
}

function columnOfX(x) {
  return Math.max(0, Math.min(TOTAL_COLUMNS - 1, Math.floor((x - LATTICE_X) / SPACING)));
}

function heldTemperature(column) {
  if (column === SOURCE_COLUMN) return SOURCE_TEMP;
  if (column === SINK_COLUMN) return SINK_TEMP;
  return null;
}

function spawnElectron(state, metalTemp) {
  const bounds = domainBounds(state);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const x = bounds.left + ELECTRON_RADIUS + Math.random() * (bounds.right - bounds.left - 2 * ELECTRON_RADIUS);
    const y = bounds.top + ELECTRON_RADIUS + Math.random() * (bounds.bottom - bounds.top - 2 * ELECTRON_RADIUS);
    const clear = state.ions.every(
      (ion) => Math.hypot(ion.restX - x, ion.restY - y) > CONTACT_DISTANCE + 8,
    );
    if (!clear) continue;
    const speed = ELECTRON_SPEED * (1 + (Math.random() * 2 - 1) * ELECTRON_SPEED_SPREAD);
    const angle = Math.random() * 2 * Math.PI;
    // New electrons start at the temperature of whatever they appear in, so
    // adding electrons never heats or cools the bar.
    const held = heldTemperature(columnOfX(x));
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      temperature: held ?? metalTemp,
    };
  }
  return null;
}

// ionGrid[column][row] gives the ion at that lattice site (or nothing for an
// empty source/sink slot), so an electron can find its nearest ion directly.
function rebuildIonGrid(state) {
  state.ionGrid = Array.from({ length: TOTAL_COLUMNS }, () => null);
  for (const ion of state.ions) {
    (state.ionGrid[ion.column] ||= [])[ion.row] = ion;
  }
}

export function createState(electronCount = DEFAULT_ELECTRONS) {
  const state = {
    ions: [],
    electrons: [],
    sourceOn: false,
    sinkOn: false,
    time: 0,
    ionGrid: [],
    columnIonTemp: new Array(TOTAL_COLUMNS).fill(NaN),
    columnElectronTemp: new Array(TOTAL_COLUMNS).fill(NaN),
    sourceEnergy: 0,
    sinkEnergy: 0,
    powerSampleTime: 0,
    sourcePower: 0,
    sinkPower: 0,
    history: [],
    historySampleTime: 0,
  };
  for (let column = 1; column <= METAL_COLUMNS; column += 1) {
    state.ions.push(...makeColumn(column, ROOM_TEMP));
  }
  rebuildIonGrid(state);
  setElectronCount(state, electronCount);
  vibrateIons(state);
  updateMeasurements(state, 0);
  return state;
}

export function setElectronCount(state, count) {
  const target = Math.max(0, Math.min(MAX_ELECTRONS, Math.round(count)));
  while (state.electrons.length > target) {
    state.electrons.splice(Math.floor(Math.random() * state.electrons.length), 1);
  }
  const metal = metalTemperature(state);
  while (state.electrons.length < target) {
    const electron = spawnElectron(state, metal);
    if (!electron) break;
    state.electrons.push(electron);
  }
  updateMeasurements(state, 0);
}

function keepElectronsInside(state) {
  const bounds = domainBounds(state);
  for (const electron of state.electrons) {
    if (electron.x < bounds.left + ELECTRON_RADIUS) {
      electron.x = bounds.left + ELECTRON_RADIUS + Math.random() * SPACING * 0.4;
      electron.vx = Math.abs(electron.vx);
    } else if (electron.x > bounds.right - ELECTRON_RADIUS) {
      electron.x = bounds.right - ELECTRON_RADIUS - Math.random() * SPACING * 0.4;
      electron.vx = -Math.abs(electron.vx);
    }
  }
}

function setReservoir(state, column, on) {
  state.ions = state.ions.filter((ion) => ion.column !== column);
  if (on) state.ions.push(...makeColumn(column, heldTemperature(column)));
  rebuildIonGrid(state);
  keepElectronsInside(state);
  vibrateIons(state);
  updateMeasurements(state, 0);
}

export function setSource(state, on) {
  state.sourceOn = on;
  setReservoir(state, SOURCE_COLUMN, on);
  if (!on) state.sourcePower = 0;
}

export function setSink(state, on) {
  state.sinkOn = on;
  setReservoir(state, SINK_COLUMN, on);
  if (!on) state.sinkPower = 0;
}

export function resetTemperatures(state) {
  for (const ion of state.ions) {
    ion.temperature = heldTemperature(ion.column) ?? ROOM_TEMP;
  }
  for (const electron of state.electrons) {
    electron.temperature = heldTemperature(columnOfX(electron.x)) ?? ROOM_TEMP;
  }
  state.sourcePower = 0;
  state.sinkPower = 0;
  state.sourceEnergy = 0;
  state.sinkEnergy = 0;
  state.history = [];
  updateMeasurements(state, 0);
}

function vibrateIons(state) {
  const t = state.time;
  for (const ion of state.ions) {
    const amplitude = VIBRATION_AT_ROOM * Math.sqrt(Math.max(0, ion.temperature) / ROOM_TEMP);
    ion.dx = amplitude * Math.sin(ion.freqX * t + ion.phaseX);
    ion.dy = amplitude * Math.sin(ion.freqY * t + ion.phaseY);
  }
}

function moveElectrons(state, dt) {
  const bounds = domainBounds(state);
  const ionGrid = state.ionGrid;
  const left = bounds.left + ELECTRON_RADIUS;
  const right = bounds.right - ELECTRON_RADIUS;
  const top = bounds.top + ELECTRON_RADIUS;
  const bottom = bounds.bottom - ELECTRON_RADIUS;

  for (const electron of state.electrons) {
    electron.x += electron.vx * dt;
    electron.y += electron.vy * dt;

    // Walls are insulating: electrons bounce straight back off them.
    if (electron.x < left) {
      electron.x = 2 * left - electron.x;
      electron.vx = Math.abs(electron.vx);
    } else if (electron.x > right) {
      electron.x = 2 * right - electron.x;
      electron.vx = -Math.abs(electron.vx);
    }
    if (electron.y < top) {
      electron.y = 2 * top - electron.y;
      electron.vy = Math.abs(electron.vy);
    } else if (electron.y > bottom) {
      electron.y = 2 * bottom - electron.y;
      electron.vy = -Math.abs(electron.vy);
    }

    // Ions are more than two contact distances apart, so the only ion an
    // electron can be touching is the one at the nearest lattice site.
    const column = Math.round((electron.x - LATTICE_X - SPACING / 2) / SPACING);
    const columnIons = ionGrid[column];
    if (!columnIons) continue;
    const offset = column % 2 === 1 ? SPACING / 2 : 0;
    const row = Math.round((electron.y - LATTICE_Y - SPACING / 2 - offset) / SPACING);
    const ion = columnIons[row < 0 ? 0 : row >= ROWS ? ROWS - 1 : row];
    if (!ion) continue;

    const ix = ion.restX + ion.dx;
    const iy = ion.restY + ion.dy;
    const ox = electron.x - ix;
    const oy = electron.y - iy;
    const distanceSq = ox * ox + oy * oy;
    if (distanceSq >= CONTACT_DISTANCE_SQ) continue;
    const distance = Math.sqrt(distanceSq) || 0.0001;
    const nx = ox / distance;
    const ny = oy / distance;
    if (electron.vx * nx + electron.vy * ny < 0) {
      // Share heat: both move towards their average temperature.
      const difference = electron.temperature - ion.temperature;
      ion.temperature += difference * HEAT_SHARE;
      electron.temperature -= difference * HEAT_SHARE;

      // Bounce off at the same speed, heading away from the ion in a
      // somewhat random direction.
      const speed = Math.hypot(electron.vx, electron.vy);
      const angle = Math.atan2(ny, nx) + (Math.random() * 2 - 1) * SCATTER_HALF_ANGLE;
      electron.vx = Math.cos(angle) * speed;
      electron.vy = Math.sin(angle) * speed;
    }
    electron.x = ix + nx * CONTACT_DISTANCE;
    electron.y = iy + ny * CONTACT_DISTANCE;
  }
}

// The heater and cooler hold the source and sink ions at their temperatures.
// Whatever heat that takes is the heat flowing in at the hot end and out at
// the cold end.
function holdReservoirs(state) {
  if (!state.sourceOn && !state.sinkOn) return;
  for (const ion of state.ions) {
    if (ion.column === SOURCE_COLUMN) {
      state.sourceEnergy += SOURCE_TEMP - ion.temperature;
      ion.temperature = SOURCE_TEMP;
    } else if (ion.column === SINK_COLUMN) {
      state.sinkEnergy += ion.temperature - SINK_TEMP;
      ion.temperature = SINK_TEMP;
    }
  }
}

function smoothingFactor(dt, tau) {
  return 1 - Math.exp(-dt / tau);
}

const scratch = {
  ionSums: new Array(TOTAL_COLUMNS),
  ionCounts: new Array(TOTAL_COLUMNS),
  electronSums: new Array(TOTAL_COLUMNS),
  electronCounts: new Array(TOTAL_COLUMNS),
};

// Column temperatures are plain averages of the ions (and electrons) in each
// column right now; nothing is smoothed, so nothing can drift on its own.
function updateMeasurements(state, dt) {
  const ionSums = scratch.ionSums.fill(0);
  const ionCounts = scratch.ionCounts.fill(0);
  for (const ion of state.ions) {
    ionSums[ion.column] += ion.temperature;
    ionCounts[ion.column] += 1;
  }
  const electronSums = scratch.electronSums.fill(0);
  const electronCounts = scratch.electronCounts.fill(0);
  for (const electron of state.electrons) {
    const column = columnOfX(electron.x);
    electronSums[column] += electron.temperature;
    electronCounts[column] += 1;
  }
  for (let column = 0; column < TOTAL_COLUMNS; column += 1) {
    state.columnIonTemp[column] = ionCounts[column] ? ionSums[column] / ionCounts[column] : NaN;
    state.columnElectronTemp[column] = electronCounts[column]
      ? electronSums[column] / electronCounts[column]
      : NaN;
  }

  if (dt <= 0) return;
  state.powerSampleTime += dt;
  if (state.powerSampleTime >= POWER_SAMPLE_S) {
    const blend = smoothingFactor(state.powerSampleTime, POWER_SMOOTHING_S);
    const sourceNow = state.sourceEnergy / state.powerSampleTime / POWER_UNIT;
    const sinkNow = state.sinkEnergy / state.powerSampleTime / POWER_UNIT;
    state.sourcePower = state.sourceOn ? state.sourcePower + (sourceNow - state.sourcePower) * blend : 0;
    state.sinkPower = state.sinkOn ? state.sinkPower + (sinkNow - state.sinkPower) * blend : 0;
    state.sourceEnergy = 0;
    state.sinkEnergy = 0;
    state.powerSampleTime = 0;
  }

  state.historySampleTime += dt;
  if (state.historySampleTime >= HISTORY_SAMPLE_S) {
    state.historySampleTime = 0;
    state.history.push({
      time: state.time,
      source: state.sourceOn ? state.sourcePower : null,
      sink: state.sinkOn ? state.sinkPower : null,
    });
    while (state.history.length && state.history[0].time < state.time - HISTORY_SECONDS) {
      state.history.shift();
    }
  }
}

export function step(state, elapsed) {
  if (elapsed <= 0) return;
  const steps = Math.max(1, Math.ceil(elapsed / MAX_SUBSTEP));
  const dt = elapsed / steps;

  for (let i = 0; i < steps; i += 1) {
    state.time += dt;
    vibrateIons(state);
    moveElectrons(state, dt);
    holdReservoirs(state);
  }
  updateMeasurements(state, elapsed);
}

// Temperature of the metal itself (excluding the source and sink columns):
// the average over its ions and the free electrons inside it. Ions and
// electrons hold heat equally and collisions only share it, so in an
// insulated bar this never changes.
export function metalTemperature(state) {
  let sum = 0;
  let count = 0;
  for (const ion of state.ions) {
    if (ion.column === SOURCE_COLUMN || ion.column === SINK_COLUMN) continue;
    sum += ion.temperature;
    count += 1;
  }
  for (const electron of state.electrons) {
    const column = columnOfX(electron.x);
    if (column === SOURCE_COLUMN || column === SINK_COLUMN) continue;
    sum += electron.temperature;
    count += 1;
  }
  return count ? sum / count : ROOM_TEMP;
}
