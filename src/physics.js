// Particle model of thermal conduction in a metal.
//
// Ions sit on springs about fixed lattice sites, so their thermal energy is
// genuine vibration (kinetic + spring potential energy). Free electrons fly
// between them and bounce elastically off whichever ion they hit, exchanging
// momentum with the moving ion. Nothing else couples the ions, so the only way
// energy can travel from a hot ion to a distant cold one is by being carried
// across by electrons.
//
// The hot source and cold sink are extra columns of ions at the two ends of
// the metal, in thermal contact with it: electrons wander in and out of them
// just as they do between any other columns. Each of their ions is kept at a
// fixed temperature (its vibration energy is continually nudged back to the
// held value), standing in for a large heater or cooler behind it. The energy
// those nudges add or remove is the heat flow.
//
// Units: lengths in stage pixels, time in seconds, electron mass = 1.

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

// Ions are drawn at exactly the size electrons bounce off. This radius keeps
// the electrons' mean free path under one ion spacing; with much smaller ions
// the electrons mix the whole bar so thoroughly that almost all of the
// temperature drop happens right at the ends.
export const ION_RADIUS = 24;
export const ELECTRON_RADIUS = 4.6;
const CONTACT_DISTANCE = ION_RADIUS + ELECTRON_RADIUS;
const CONTACT_DISTANCE_SQ = CONTACT_DISTANCE * CONTACT_DISTANCE;

// Temperatures in kelvin. Displayed in °C.
export const KELVIN_OFFSET = 273;
export const ROOM_TEMP = 293; // 20 °C
export const SOURCE_TEMP = 573; // 300 °C
export const SINK_TEMP = 223; // −50 °C

// Energy per kelvin (Boltzmann constant in simulation units). Chosen so an
// electron at room temperature moves at roughly 150 px/s.
const K_B = 38;
const ELECTRON_MASS = 1;
const ION_MASS = 8;
// Spring stiffness chosen so an ion at room temperature jiggles ~3 px.
const ION_SPRING = 1250;
const ION_OMEGA = Math.sqrt(ION_SPRING / ION_MASS);

// Electrons move at most a few pixels per substep, far less than the contact
// distance, so collisions are never skipped.
const MAX_SUBSTEP = 1 / 120;
const THERMOSTAT_TIME_S = 0.12; // how quickly source/sink ions are pulled back to their held temperature
// A column's displayed temperature is averaged over roughly this many recent
// collisions in it. The average only moves when collisions actually happen,
// so with no electrons nothing on screen can drift.
const COLUMN_SMOOTHING_COLLISIONS = 100;
const ELECTRON_SMOOTHING_S = 4;
const POWER_SMOOTHING_S = 30;
const POWER_SAMPLE_S = 0.25;
export const HISTORY_SECONDS = 120;
const HISTORY_SAMPLE_S = 0.5;

// Heat flow is shown in arbitrary units scaled to tidy numbers.
export const POWER_UNIT = K_B * 100;
export const POWER_AVERAGE_SECONDS = POWER_SMOOTHING_S;

export const MAX_ELECTRONS = 600;
export const DEFAULT_ELECTRONS = 150;

export const toCelsius = (kelvin) => kelvin - KELVIN_OFFSET;

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

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

function ionEnergy(ion) {
  return (
    0.5 * ION_MASS * (ion.vx * ion.vx + ion.vy * ion.vy) +
    0.5 * ION_SPRING * (ion.dx * ion.dx + ion.dy * ion.dy)
  );
}

function thermaliseIon(ion, temperature) {
  // Give the ion exactly the average energy for this temperature (2kT for a 2D
  // oscillator), split randomly between the two directions and with random
  // phase, so every column starts at the stated temperature rather than at a
  // noisy random sample of it.
  const energy = 2 * K_B * temperature;
  const share = 0.25 + Math.random() * 0.5;
  for (const [energyHere, axis] of [
    [energy * share, "x"],
    [energy * (1 - share), "y"],
  ]) {
    const amplitude = Math.sqrt((2 * energyHere) / ION_SPRING);
    const phase = Math.random() * Math.PI * 2;
    ion[`d${axis}`] = amplitude * Math.cos(phase);
    ion[`v${axis}`] = -amplitude * ION_OMEGA * Math.sin(phase);
  }
  ion.temperature = temperature;
}

function makeColumn(column, temperature) {
  const ions = [];
  for (let row = 0; row < ROWS; row += 1) {
    const ion = {
      column,
      row,
      restX: columnX(column),
      restY: siteY(column, row),
      dx: 0,
      dy: 0,
      vx: 0,
      vy: 0,
      temperature,
    };
    thermaliseIon(ion, temperature);
    ions.push(ion);
  }
  return ions;
}

function setElectronVelocity(electron, temperature) {
  const spread = Math.sqrt((K_B * temperature) / ELECTRON_MASS);
  electron.vx = gaussian() * spread;
  electron.vy = gaussian() * spread;
}

export function electronTemperature(electron) {
  // In two dimensions the mean kinetic energy of a free particle is kT.
  return (0.5 * ELECTRON_MASS * (electron.vx * electron.vx + electron.vy * electron.vy)) / K_B;
}

function columnOfX(x) {
  return Math.max(0, Math.min(TOTAL_COLUMNS - 1, Math.floor((x - LATTICE_X) / SPACING)));
}

function localTemperature(state, x) {
  const t = state.columnIonTemp[columnOfX(x)];
  return Number.isFinite(t) ? t : ROOM_TEMP;
}

function spawnElectron(state) {
  const bounds = domainBounds(state);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const x = bounds.left + ELECTRON_RADIUS + Math.random() * (bounds.right - bounds.left - 2 * ELECTRON_RADIUS);
    const y = bounds.top + ELECTRON_RADIUS + Math.random() * (bounds.bottom - bounds.top - 2 * ELECTRON_RADIUS);
    const clear = state.ions.every(
      (ion) => Math.hypot(ion.restX - x, ion.restY - y) > CONTACT_DISTANCE + 6,
    );
    if (!clear) continue;
    const electron = { x, y, vx: 0, vy: 0, id: state.nextElectronId++ };
    setElectronVelocity(electron, localTemperature(state, x));
    return electron;
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
    nextElectronId: 0,
    columnIonTemp: new Array(TOTAL_COLUMNS).fill(ROOM_TEMP),
    columnElectronTemp: new Array(TOTAL_COLUMNS).fill(ROOM_TEMP),
    sourceEnergy: 0,
    sinkEnergy: 0,
    powerSampleTime: 0,
    sourcePower: 0,
    sinkPower: 0,
    history: [],
    historySampleTime: 0,
    ionGrid: [],
    columnHits: new Array(TOTAL_COLUMNS).fill(0),
  };
  for (let column = 1; column <= METAL_COLUMNS; column += 1) {
    state.ions.push(...makeColumn(column, ROOM_TEMP));
  }
  rebuildIonGrid(state);
  setElectronCount(state, electronCount);
  return state;
}

// Random speeds give a batch of electrons slightly too much or too little
// energy overall. Scale the batch so its total kinetic energy is exactly what
// its temperatures call for, so adding electrons never heats or cools the bar.
function matchBatchEnergy(electrons, temperatureOf) {
  let actual = 0;
  let target = 0;
  for (const electron of electrons) {
    actual += 0.5 * ELECTRON_MASS * (electron.vx * electron.vx + electron.vy * electron.vy);
    target += K_B * temperatureOf(electron);
  }
  if (actual <= 0) return;
  const scale = Math.sqrt(target / actual);
  for (const electron of electrons) {
    electron.vx *= scale;
    electron.vy *= scale;
  }
}

export function setElectronCount(state, count) {
  const target = Math.max(0, Math.min(MAX_ELECTRONS, Math.round(count)));
  while (state.electrons.length > target) {
    state.electrons.splice(Math.floor(Math.random() * state.electrons.length), 1);
  }
  // Electrons added inside the metal start at its current temperature (and
  // any landing in the source or sink at that end's temperature), so adding
  // electrons never changes how hot the bar is.
  const metal = metalTemperature(state);
  const added = [];
  while (state.electrons.length < target) {
    const electron = spawnElectron(state);
    if (!electron) break;
    state.electrons.push(electron);
    added.push(electron);
  }
  matchBatchEnergy(added, (electron) => {
    const column = columnOfX(electron.x);
    if (column === SOURCE_COLUMN || column === SINK_COLUMN) return localTemperature(state, electron.x);
    return metal;
  });
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

function setReservoir(state, column, on, temperature) {
  state.ions = state.ions.filter((ion) => ion.column !== column);
  if (on) state.ions.push(...makeColumn(column, temperature));
  rebuildIonGrid(state);
  state.columnIonTemp[column] = on ? temperature : NaN;
  state.columnElectronTemp[column] = on ? state.columnElectronTemp[column] || temperature : NaN;
}

export function setSource(state, on) {
  state.sourceOn = on;
  setReservoir(state, SOURCE_COLUMN, on, SOURCE_TEMP);
  keepElectronsInside(state);
  if (!on) state.sourcePower = 0;
}

export function setSink(state, on) {
  state.sinkOn = on;
  setReservoir(state, SINK_COLUMN, on, SINK_TEMP);
  keepElectronsInside(state);
  if (!on) state.sinkPower = 0;
}

export function resetTemperatures(state) {
  for (const ion of state.ions) {
    if (ion.column === SOURCE_COLUMN) thermaliseIon(ion, SOURCE_TEMP);
    else if (ion.column === SINK_COLUMN) thermaliseIon(ion, SINK_TEMP);
    else thermaliseIon(ion, ROOM_TEMP);
  }
  for (let column = 1; column <= METAL_COLUMNS; column += 1) {
    state.columnIonTemp[column] = ROOM_TEMP;
    state.columnElectronTemp[column] = ROOM_TEMP;
  }
  for (const electron of state.electrons) {
    setElectronVelocity(electron, ROOM_TEMP);
  }
  matchBatchEnergy(state.electrons, () => ROOM_TEMP);
  state.sourcePower = 0;
  state.sinkPower = 0;
  state.sourceEnergy = 0;
  state.sinkEnergy = 0;
  state.history = [];
}

function moveIons(state, dt) {
  const c = Math.cos(ION_OMEGA * dt);
  const s = Math.sin(ION_OMEGA * dt);
  for (const ion of state.ions) {
    // Exact solution for simple harmonic motion, so springs never gain or lose energy.
    const dx = ion.dx;
    const dy = ion.dy;
    ion.dx = dx * c + (ion.vx / ION_OMEGA) * s;
    ion.vx = -dx * ION_OMEGA * s + ion.vx * c;
    ion.dy = dy * c + (ion.vy / ION_OMEGA) * s;
    ion.vy = -dy * ION_OMEGA * s + ion.vy * c;
  }
}

function applyThermostats(state, dt) {
  if (!state.sourceOn && !state.sinkOn) return;
  const blend = smoothingFactor(dt, THERMOSTAT_TIME_S);
  for (const ion of state.ions) {
    const isSource = ion.column === SOURCE_COLUMN;
    const isSink = ion.column === SINK_COLUMN;
    if (!isSource && !isSink) continue;
    // Pull each source/sink ion's vibration energy smoothly back towards the
    // held temperature. The energy this adds or removes is the heat supplied
    // by the heater or taken away by the cooler.
    const target = 2 * K_B * (isSource ? SOURCE_TEMP : SINK_TEMP);
    const before = ionEnergy(ion);
    if (before < target * 0.02) {
      thermaliseIon(ion, (isSource ? SOURCE_TEMP : SINK_TEMP) * 0.02);
    }
    const current = ionEnergy(ion);
    const wanted = current + (target - current) * blend;
    const scale = Math.sqrt(wanted / current);
    ion.dx *= scale;
    ion.dy *= scale;
    ion.vx *= scale;
    ion.vy *= scale;
    const change = wanted - before;
    if (isSource) state.sourceEnergy += change;
    else state.sinkEnergy -= change;
  }
}

function smoothingFactor(dt, tau) {
  return 1 - Math.exp(-dt / tau);
}

function moveElectrons(state, dt) {
  const bounds = domainBounds(state);
  const ionGrid = state.ionGrid;
  const massFactorElectron = (2 * ION_MASS) / (ELECTRON_MASS + ION_MASS);
  const massFactorIon = (2 * ELECTRON_MASS) / (ELECTRON_MASS + ION_MASS);
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
    const approach = (electron.vx - ion.vx) * nx + (electron.vy - ion.vy) * ny;
    if (approach < 0) {
      // Perfectly elastic collision between a light electron and a heavier,
      // moving ion: momentum and kinetic energy are both conserved, so
      // whichever particle was moving faster tends to hand energy over.
      electron.vx -= massFactorElectron * approach * nx;
      electron.vy -= massFactorElectron * approach * ny;
      ion.vx += massFactorIon * approach * nx;
      ion.vy += massFactorIon * approach * ny;
      state.columnHits[column] += 1;
    }
    electron.x = ix + nx * CONTACT_DISTANCE;
    electron.y = iy + ny * CONTACT_DISTANCE;
  }
}

const scratch = {
  ionSums: new Array(TOTAL_COLUMNS),
  ionCounts: new Array(TOTAL_COLUMNS),
  electronSums: new Array(TOTAL_COLUMNS),
  electronCounts: new Array(TOTAL_COLUMNS),
};

// Temperatures, heat flow and history are measured once per animation frame;
// they are smoothed over seconds, so measuring every substep adds nothing.
function updateMeasurements(state, dt) {
  // An ion's vibration energy only changes when an electron hits it (or, at
  // the ends, when the heater or cooler adjusts it), so its temperature is
  // read directly from that energy. A 2D oscillator holds on average 2kT.
  for (const ion of state.ions) {
    ion.temperature = ionEnergy(ion) / (2 * K_B);
  }

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
    electronSums[column] += electronTemperature(electron);
    electronCounts[column] += 1;
  }
  const electronBlend = smoothingFactor(dt, ELECTRON_SMOOTHING_S);

  for (let column = 0; column < TOTAL_COLUMNS; column += 1) {
    const hits = state.columnHits[column];
    state.columnHits[column] = 0;
    const isReservoir = column === SOURCE_COLUMN || column === SINK_COLUMN;
    const present =
      (column !== SOURCE_COLUMN || state.sourceOn) && (column !== SINK_COLUMN || state.sinkOn);
    if (!present) {
      state.columnIonTemp[column] = NaN;
      state.columnElectronTemp[column] = NaN;
      continue;
    }
    if (ionCounts[column]) {
      const mean = ionSums[column] / ionCounts[column];
      const previous = state.columnIonTemp[column];
      if (isReservoir || !Number.isFinite(previous)) {
        // Source and sink ions are held at their temperature, so show it directly.
        state.columnIonTemp[column] = mean;
      } else {
        const blend = 1 - Math.exp(-hits / COLUMN_SMOOTHING_COLLISIONS);
        state.columnIonTemp[column] = previous + (mean - previous) * blend;
      }
    }
    if (electronCounts[column]) {
      const mean = electronSums[column] / electronCounts[column];
      const previous = Number.isFinite(state.columnElectronTemp[column])
        ? state.columnElectronTemp[column]
        : mean;
      // Fewer electrons in a column means a noisier average, so blend it in more gently.
      const weight = Math.min(1, electronCounts[column] / 6);
      state.columnElectronTemp[column] = previous + (mean - previous) * electronBlend * weight;
    }
  }

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
    moveIons(state, dt);
    moveElectrons(state, dt);
    applyThermostats(state, dt);
  }
  updateMeasurements(state, elapsed);
}

// Temperature of the metal itself (excluding the source and sink columns), in
// kelvin, counting both its ions and the free electrons inside it, each
// weighted by how much heat it holds (an ion 2k, an electron k). Energy only
// moves between ions and electrons inside an insulated bar, so this stays
// constant unless heat flows in or out through the ends.
export function metalTemperature(state) {
  let energy = 0;
  let capacity = 0;
  for (const ion of state.ions) {
    if (ion.column === SOURCE_COLUMN || ion.column === SINK_COLUMN) continue;
    energy += ionEnergy(ion);
    capacity += 2 * K_B;
  }
  for (const electron of state.electrons) {
    const column = columnOfX(electron.x);
    if (column === SOURCE_COLUMN || column === SINK_COLUMN) continue;
    energy += 0.5 * ELECTRON_MASS * (electron.vx * electron.vx + electron.vy * electron.vy);
    capacity += K_B;
  }
  return capacity ? energy / capacity : ROOM_TEMP;
}
