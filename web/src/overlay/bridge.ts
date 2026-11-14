// Bridge exposed by the Electron preload (overlay/preload.cjs). Undefined in a normal browser.
export interface OverlayMode {
  locked: boolean;
  calibrated: boolean;
  hotkeys: { toggle: string; lock: string; ask: string };
}

export interface OverlayBridge {
  onMode(cb: (mode: OverlayMode) => void): () => void;
  /** Optional: an older overlay build may not have it */
  onVisibility?(cb: (e: { visible: boolean }) => void): () => void;
  /** Older overlays don't have it */
  fitHeight?: (px: number) => void;
  /** Pointer over the grab handle (locked mode): accept mouse input so the window can be dragged */
  setInteractive?: (on: boolean) => void;
}

declare global {
  interface Window {
    dotaOverlay?: OverlayBridge;
  }
}

export const bridge = (): OverlayBridge | undefined => window.dotaOverlay;
