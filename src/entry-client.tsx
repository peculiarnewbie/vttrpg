import { render } from "@solidjs/web";
import App from "./app";
import "./theme/fonts";
import "./styles.css";

render(() => <App />, document.getElementById("app")!);
