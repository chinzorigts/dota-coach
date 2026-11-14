// Bridge exposed by the Electron preload (overlay/preload.cjs). Undefined in a normal browser.
export interface OverlayMode {
  locked: boolean;
  hotkeys: { toggle: string; lock: string; ask: string };
}

export interface OverlayBridge {
  onMode(cb: (mode: OverlayMode) => void): () => void;
}

declare global {
  interface Window {
    dotaOverlay?: OverlayBridge;
  }
}

export const bridge = (): OverlayBridge | undefined => window.dotaOverlay;
