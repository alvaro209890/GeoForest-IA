import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setupAutoUpdate } from "./lib/autoUpdate";

createRoot(document.getElementById("root")!).render(<App />);

// Recarrega abas antigas automaticamente quando um novo build é publicado.
setupAutoUpdate();
