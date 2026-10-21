import { useLayoutEffect } from "react";

// Lay the page out as if the window were about 1200 × 750 CSS px (a laptop at
// roughly 150% browser zoom), then scale it up to fill the actual window. Text,
// buttons and panels all grow together, so big screens and projectors get the
// same proportions as a laptop instead of a huge stage with tiny labels.
const REFERENCE_WIDTH = 1200;
const REFERENCE_HEIGHT = 750;
// Below this width the page switches to its stacked mobile layout and is left alone.
const MIN_FIT_WIDTH = 821;

export default function useFitToScreen() {
  useLayoutEffect(() => {
    const root = document.documentElement;

    const update = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      if (width < MIN_FIT_WIDTH) {
        root.classList.remove("fs-fit");
        root.style.removeProperty("--fs-vw");
        root.style.removeProperty("--fs-vh");
        return;
      }

      const scale = Math.max(
        1,
        Math.min(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT),
      );
      root.style.setProperty("--fs-scale", String(scale));
      root.style.setProperty("--fs-layout-w", `${width / scale}px`);
      root.style.setProperty("--fs-layout-h", `${height / scale}px`);
      // The page's sizes use vw/vh units (written as var(--fs-vw) etc. in
      // App.jsx). Point them at the reference layout, not the real window, so
      // text and spacing keep the same proportions once scaled up.
      root.style.setProperty("--fs-vw", `${width / scale / 100}px`);
      root.style.setProperty("--fs-vh", `${height / scale / 100}px`);
      root.classList.add("fs-fit");
    };

    update();
    window.addEventListener("resize", update);
    document.addEventListener("fullscreenchange", update);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("fullscreenchange", update);
      root.classList.remove("fs-fit");
      root.style.removeProperty("--fs-vw");
      root.style.removeProperty("--fs-vh");
    };
  }, []);
}
