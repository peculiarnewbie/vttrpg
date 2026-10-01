import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { For, Show, createSignal, onSettled } from "solid-js";
import { api, ApiError, type WorldBootstrap } from "../client/api";
import { useSession } from "../client/session";
import { createCompendium } from "../client/compendium";
import { BuilderPanel } from "../components/builder";
import { CompendiumSettings } from "../components/compendium-settings";
import { MembersPanel } from "../components/members";
import { Libraries } from "../components/libraries";
import { styles } from "../components/styles.stylex";
import { Button, ErrorBanner, Spinner, TopBar } from "../components/ui";
import type { SheetTemplate, WorldMember } from "../domain/schemas";
import { sx } from "../theme/sx";

type Section = "members" | "templates" | "compendium" | "libraries";

const sections: { id: Section; label: string }[] = [
  { id: "members", label: "Members" },
  { id: "templates", label: "Sheet templates" },
  { id: "compendium", label: "Compendium" },
  { id: "libraries", label: "Libraries" },
];

/** DM-only setup that doesn't belong in the in-session tools panel. */
export default function WorldSettings() {
  const params = useParams<{ id: string }>();
  const session = useSession();
  const navigate = useNavigate();
  const [boot, setBoot] = createSignal<WorldBootstrap | null>(null);
  const [members, setMembers] = createSignal<WorldMember[]>([]);
  const [templates, setTemplates] = createSignal<SheetTemplate[]>([]);
  const [search] = useSearchParams();
  const requested = sections.find((item) => item.id === search.section)?.id;
  const [section, setSection] = createSignal<Section>(requested ?? "members");
  const compendium = createCompendium(params.id);
  const [error, setError] = createSignal("");
  const backToTable = () => navigate(`/worlds/${params.id}`);

  onSettled(() => {
    void (async () => {
      const started = Date.now();
      while (session.loading() && Date.now() - started < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      if (!session.user()) {
        navigate("/", { replace: true });
        return;
      }
      try {
        const bootstrap = await api.bootstrapWorld(params.id);
        if (bootstrap.member.role !== "dm") {
          navigate(`/worlds/${params.id}`, { replace: true });
          return;
        }
        setBoot(bootstrap);
        if (requested === "libraries" && !bootstrap.features?.corpus) setSection("members");
        setMembers(bootstrap.members);
        setTemplates(bootstrap.templates);
        void compendium.refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load world");
      }
    })();
  });

  return (
    <div {...sx(styles.app)}>
      <TopBar>
        <Button variant="ghost" small onClick={backToTable}>
          ← Back to the table
        </Button>
      </TopBar>
      <ErrorBanner message={error()} />
      <Show
        when={boot()}
        fallback={
          <div {...sx(styles.center)}>
            <Spinner label="Loading settings..." />
          </div>
        }
      >
        {(world) => (
          <main {...sx(styles.settingsPage)}>
            <h1 {...sx(styles.h2)}>{world().world.name} settings</h1>
            <div {...sx(styles.tabBar)} role="tablist" aria-label="Settings sections">
              <For
                each={sections.filter(
                  (item) => item.id !== "libraries" || world().features?.corpus,
                )}
              >
                {(item) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={section() === item.id ? "true" : "false"}
                    {...sx(styles.tab, section() === item.id && styles.tabActive)}
                    onClick={() => setSection(item.id)}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
            <Show when={section() === "members"}>
              <MembersPanel
                worldId={params.id}
                me={world().member}
                members={members()}
                onMembers={setMembers}
              />
            </Show>
            <Show when={section() === "templates"}>
              <BuilderPanel
                worldId={params.id}
                templates={templates()}
                onTemplates={setTemplates}
                entryTypes={compendium.types()}
              />
            </Show>
            <Show when={section() === "compendium"}>
              <CompendiumSettings
                worldId={params.id}
                worldName={world().world.name}
                templates={templates()}
                compendium={compendium}
              />
            </Show>
            <Show when={section() === "libraries" && world().features?.corpus}>
              <Libraries
                worldId={params.id}
                compendium={compendium}
                onChanged={async () => {
                  await compendium.refresh();
                }}
              />
            </Show>
          </main>
        )}
      </Show>
    </div>
  );
}
