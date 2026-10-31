import { createRoot } from "react-dom/client";
import App from "./Auth";
import "./styles.css";
import './workbench.css';
import './chat-work.css';
import './code-font.css';

const render=()=>createRoot(document.getElementById("root")!).render(<App />);
// Load bundled faces before Monaco/xterm measure their first character cells.
void Promise.all([document.fonts.load('14px D2Coding'),document.fonts.load('700 14px D2Coding')]).then(render,render);
