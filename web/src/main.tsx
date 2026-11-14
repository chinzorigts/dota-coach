import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Overlay } from "./overlay/Overlay";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname.startsWith("/overlay") ? <Overlay /> : <App />}
  </StrictMode>,
);
