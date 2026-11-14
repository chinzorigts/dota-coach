import { useEffect, useRef, useState } from "react";
import type { CoachState } from "./types";

/** Subscribes to server state over WebSocket. Reconnects with 1, 2, 4... up to 10s backoff. */
export function useCoach() {
  const [state, setState] = useState<CoachState | null>(null);
  const [connected, setConnected] = useState(false);
  const skew = useRef(0); // server clock minus browser clock (a phone's clock may differ)

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: number | undefined;
    let stopped = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "state") {
          skew.current = msg.data.serverTime - Date.now();
          setState(msg.data);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (stopped) return;
        timer = window.setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { state, connected, serverNow: () => Date.now() + skew.current };
}

export async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}
