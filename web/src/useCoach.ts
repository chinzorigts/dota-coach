import { useEffect, useRef, useState } from "react";
import type { CoachState } from "./types";

/** WebSocket 으로 서버 상태를 구독한다. 끊기면 1→2→4…최대 10초 간격으로 다시 붙는다. */
export function useCoach() {
  const [state, setState] = useState<CoachState | null>(null);
  const [connected, setConnected] = useState(false);
  const skew = useRef(0); // 서버 시계 - 브라우저 시계 (폰에서 볼 때 시계가 다를 수 있다)

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
  if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
  return data as T;
}
