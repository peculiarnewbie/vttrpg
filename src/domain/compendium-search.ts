import type { CompendiumEntry } from "./compendium";

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type SearchOptions = { typeId?: string; tag?: string };

export const indexEntries = (entries: readonly CompendiumEntry[]) =>
  [...entries]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const name = normalize(entry.name);
      return {
        entry,
        name,
        words: name.split(/[^\p{L}\p{N}]+/u),
        tags: entry.tags.map(normalize),
        body: normalize(entry.body),
      };
    });

export const searchIndex = (
  index: ReturnType<typeof indexEntries>,
  query: string,
  opts: SearchOptions = {},
): CompendiumEntry[] => {
  const needle = normalize(query.trim());
  const tag = opts.tag === undefined ? undefined : normalize(opts.tag);
  const ranked: CompendiumEntry[][] = [[], [], [], [], []];
  for (const item of index) {
    if (opts.typeId !== undefined && item.entry.typeId !== opts.typeId) continue;
    if (tag !== undefined && !item.tags.includes(tag)) continue;
    const rank =
      !needle || item.name === needle
        ? 0
        : item.name.startsWith(needle)
          ? 1
          : item.words.some((word) => word.startsWith(needle))
            ? 2
            : item.tags.some((value) => value.includes(needle))
              ? 3
              : item.body.includes(needle)
                ? 4
                : -1;
    if (rank >= 0) ranked[rank].push(item.entry);
  }
  return ranked.flat();
};

export const searchEntries = (
  entries: readonly CompendiumEntry[],
  query: string,
  opts: SearchOptions = {},
) => searchIndex(indexEntries(entries), query, opts);
