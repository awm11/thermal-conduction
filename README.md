# Thermal conduction in metals

An interactive particle model of how heat travels through a metal, in the same
style as the other awm Physics simulations.

- Positive ions vibrate about fixed lattice sites; their vibration energy is
  their temperature (shown by colour).
- Free electrons fly between the ions and bounce elastically off them, so they
  pick up energy from fast-vibrating ions and hand it on to slower ones. The
  ions never touch each other, so electrons are the only route for heat.
- A slider sets the number of free electrons (0–200).
- A hot source (300 °C) and a cold sink (−50 °C) can be switched on at each end.
  Each is an extra column of ions in thermal contact with the bar, held at its
  temperature by a heater or cooler.
- Graphs show the temperature along the bar (ions and electrons) and the rate
  of heat flow in from the source and out to the sink.

## Development

```
npm install
npm run dev
```

`src/physics.js` holds the simulation and has no React dependencies.
`src/App.jsx` draws the stage and graphs on a canvas and holds the controls.
