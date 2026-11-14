import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 중에는 :5173 에서 UI 를 띄우고 API·WS 는 :3001 서버로 넘긴다.
// 배포(실사용)에서는 서버가 dist 를 직접 서빙하므로 포트 하나로 끝난다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/ws": { target: "ws://127.0.0.1:3001", ws: true },
    },
  },
});
