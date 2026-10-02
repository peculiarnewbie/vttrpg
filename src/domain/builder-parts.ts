import { chooseKeys } from "./builder";
import { allBlocks } from "./layout-edit";
import type { BuilderPart, SheetLayout } from "./sheet-layout";

/*
 * The character builder's part kinds, as data: each kind's name in the
 * editor, a fresh part to start from, and the problems an author should see.
 * One entry per kind in a map keyed by type, so the schema union and this
 * registry can't drift (a kind missing here is a compile error), and how a
 * kind looks and is edited lives beside it in components/builder-parts.
 */

export type PartOf<T extends BuilderPart["type"]> = Extract<BuilderPart, { type: T }>;

/** What a kind's problem check can use; `problem` records one sentence. */
export type PartChecks = {
  readonly layout: SheetLayout;
  /** "Builder step "Name"", to start each sentence. */
  readonly name: string;
  readonly blockIds: ReadonlySet<string>;
  /** Keys of entry blocks. */
  readonly entryKeys: ReadonlySet<string>;
  /** Keys a choose part can fill: entry blocks and lists with a source. */
  readonly choosable: ReadonlySet<string>;
  readonly problem: (message: string) => void;
  /** Check roll notation (parse and refs), as the sheet's rolls are. */
  readonly roll: (label: string, dice: string) => void;
  /** Check a formula (parse and refs), as derived values are. */
  readonly formula: (label: string, expr: string) => void;
};

export type PartKind<T extends BuilderPart["type"]> = {
  /** Shown in the editor's "Add to this step…" and on the part's card. */
  readonly label: string;
  readonly blank: (layout: SheetLayout) => PartOf<T>;
  readonly check: (part: PartOf<T>, checks: PartChecks) => void;
};

export const builderParts: { readonly [T in BuilderPart["type"]]: PartKind<T> } = {
  blocks: {
    label: "Sheet blocks",
    blank: () => ({ type: "blocks", blocks: [] }),
    check: (part, { blockIds, name, problem }) => {
      for (const id of part.blocks)
        if (!blockIds.has(id)) problem(`${name} shows block "${id}", which isn't on the sheet`);
    },
  },
  choose: {
    label: "Choose from the compendium",
    blank: (layout) => ({ type: "choose", key: chooseKeys(layout)[0]?.key ?? "" }),
    check: (part, { choosable, entryKeys, name, problem }) => {
      if (!choosable.has(part.key))
        problem(
          `${name} chooses into "${part.key}", which isn't an entry block or a list from the compendium`,
        );
      if (part.from && !entryKeys.has(part.from.entry))
        problem(`${name} takes options from "${part.from.entry}", which isn't an entry block`);
    },
  },
  rolls: {
    label: "Roll buttons",
    blank: () => ({ type: "rolls", items: [{ label: "Roll", dice: "1d6" }] }),
    check: (part, { roll }) => {
      for (const item of part.items) roll(item.label, item.dice);
    },
  },
  tables: {
    label: "Table rolls",
    blank: () => ({ type: "tables", entries: [] }),
    check: (part, { entryKeys, name, problem }) => {
      if (part.from && !entryKeys.has(part.from.entry))
        problem(`${name} takes tables from "${part.from.entry}", which isn't an entry block`);
      if (!part.from && !part.entries?.length) problem(`${name} has a tables part with no tables`);
    },
  },
};

/** The kind of a part, typed for that part. */
export const partKind = <T extends BuilderPart["type"]>(part: PartOf<T>): PartKind<T> =>
  builderParts[part.type] as PartKind<T>;

/** Builder problems for {@link layoutProblems}: each step's condition and parts. */
export const builderProblems = (
  layout: SheetLayout,
  checks: Pick<PartChecks, "problem" | "roll" | "formula">,
) => {
  const blocks = allBlocks(layout);
  const context = {
    layout,
    blockIds: new Set(blocks.map((block) => block.id)),
    entryKeys: new Set(blocks.flatMap((block) => (block.type === "entry" ? [block.key] : []))),
    choosable: new Set(chooseKeys(layout).map((item) => item.key)),
    ...checks,
  };
  for (const step of layout.builder?.steps ?? []) {
    const name = `Builder step "${step.title}"`;
    if (step.when) checks.formula(`${step.title || "step"} applies when`, step.when);
    if (step.done) checks.formula(`${step.title || "step"} is done when`, step.done);
    for (const part of step.parts) {
      if (!(part.type in builderParts)) {
        checks.problem(`${name} has a "${part.type}" part, which this version can't show`);
        continue;
      }
      const known = part as BuilderPart;
      if (known.when) checks.formula(`${step.title || "step"} part applies when`, known.when);
      partKind(known).check(known, { ...context, name });
    }
  }
};
