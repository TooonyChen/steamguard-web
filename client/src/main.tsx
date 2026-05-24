import { createRoot } from "react-dom/client"

import { App } from "@/App"
import { installDomPatches } from "@/dom-patches"
import "./styles.css"

installDomPatches()

createRoot(document.getElementById("root")!).render(<App />)
