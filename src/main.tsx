import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import D2CApp from "./d2c/D2CApp";
import "./styles.css";

type Mode = "flipkart" | "d2c";
const saved = (): Mode => { try { return localStorage.getItem("planner-mode") === "d2c" ? "d2c" : "flipkart"; } catch { return "flipkart"; } };

function Root() {
  const [mode, setMode] = useState<Mode>(saved);
  const pick = (m: Mode) => { setMode(m); try { localStorage.setItem("planner-mode", m); } catch { /* ignore */ } };
  const switcher = (
    <div className="switch" role="tablist" aria-label="Channel">
      <button className={mode === "flipkart" ? "on" : ""} onClick={() => pick("flipkart")}>Flipkart</button>
      <button className={mode === "d2c" ? "on" : ""} onClick={() => pick("d2c")}>D2C</button>
    </div>
  );
  return mode === "d2c" ? <D2CApp key="d2c" switcher={switcher} /> : <App key="fk" switcher={switcher} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Root /></React.StrictMode>);
