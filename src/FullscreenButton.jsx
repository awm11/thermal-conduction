import { useEffect, useState } from "react";
import "./FullscreenButton.css";

const fullscreenElement = () =>
  document.fullscreenElement || document.webkitFullscreenElement || null;

export default function FullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(fullscreenElement()));
  const [supported] = useState(() =>
    Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled),
  );

  useEffect(() => {
    const update = () => setIsFullscreen(Boolean(fullscreenElement()));
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);

  // iPhone Safari has no fullscreen API for pages, so don't show a dead button.
  if (!supported) return null;

  const toggle = () => {
    if (fullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      exit?.call(document)?.catch?.(() => {});
    } else {
      const root = document.documentElement;
      const enter = root.requestFullscreen || root.webkitRequestFullscreen;
      enter?.call(root)?.catch?.(() => {});
    }
  };

  const label = isFullscreen ? "Exit fullscreen" : "Fullscreen";

  return (
    <button
      type="button"
      className="fs-fullscreen-button"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {isFullscreen ? (
          <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
        ) : (
          <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
        )}
      </svg>
    </button>
  );
}
