import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { firstPartySystems } from "../domain/systems";
import { colors, fontSize, space } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import { styles } from "../components/styles.stylex";
import { TopBar } from "../components/ui";

/*
 * Licences and attribution for the rules text the app publishes. The licences
 * cover text only; the app ships no art from these games, and using their open
 * text doesn't mean their publishers endorse this app.
 */
export default function Legal() {
  return (
    <div {...sx(styles.app)}>
      <TopBar />
      <main {...sx(styles.containerNarrow, styles.col)}>
        <h1 {...sx(styles.h3)}>Licences and attribution</h1>
        <p>
          Tabletop is an independent tool for playing tabletop roleplaying games. Its libraries
          contain rules text that publishers have released under open licences. Each library below
          is based on that text; none of these publishers made, sponsors or endorses Tabletop. The
          licences cover text only — no art or trade dress from these games is used.
        </p>
        <p>
          Tables can change library entries for their own world (a table override). Changes to text
          under a share-alike licence stay under that licence and keep its attribution.
        </p>
        <For each={firstPartySystems}>
          {(item) => (
            <section {...sx(styles.card, styles.col)} aria-label={item.source.name}>
              <h2 {...sx(s.heading)}>{item.source.name}</h2>
              <span {...sx(s.meta)}>
                For {item.system.name} ·{" "}
                {item.source.licence.url ? (
                  <a href={item.source.licence.url} rel="noreferrer noopener">
                    {item.source.licence.name}
                  </a>
                ) : (
                  item.source.licence.name
                )}
              </span>
              <p {...sx(s.attribution)}>{item.source.licence.attribution}</p>
            </section>
          )}
        </For>
        <p {...sx(s.meta)}>
          Game names are trademarks of their owners and are used only to say which game a sheet or
          library is for.
        </p>
      </main>
    </div>
  );
}

const s = stylex.create({
  heading: { margin: 0, fontSize: fontSize.subheading },
  meta: { color: colors.textMuted, fontSize: fontSize.caption },
  attribution: { margin: 0, marginTop: space.x1, whiteSpace: "pre-wrap" },
});
