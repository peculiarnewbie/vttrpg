import { Title } from "@solidjs/meta";
import { createRouter } from "@solidjs/router";
import Home from "./routes/index";

const Router = createRouter({
  routes: [{ path: "/", component: Home }],
});

export default function App() {
  return (
    <Router>
      {(props) => (
        <>
          <Title>Web Template</Title>
          {props.children}
        </>
      )}
    </Router>
  );
}
