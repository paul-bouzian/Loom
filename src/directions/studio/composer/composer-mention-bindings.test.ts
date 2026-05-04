import { describe, expect, it } from "vitest";

import {
  addComposerMentionBinding,
  prepareComposerMentionBindingsForSend,
  rebaseComposerMentionBindings,
} from "./composer-mention-bindings";
import type { ComposerAutocompleteItem } from "./composer-model";

describe("composer-mention-bindings", () => {
  it("rebases mention bindings after edits before the token", () => {
    const bindings = [
      {
        mention: "github",
        kind: "app" as const,
        path: "app://github",
        start: 4,
        end: 11,
      },
    ];

    expect(
      rebaseComposerMentionBindings("Use $github", "Please use $github", bindings),
    ).toEqual([
      {
        mention: "github",
        kind: "app",
        path: "app://github",
        start: 11,
        end: 18,
      },
    ]);
  });

  it("drops stale bindings once the token text changes", () => {
    const bindings = [
      {
        mention: "github",
        kind: "app" as const,
        path: "app://github",
        start: 4,
        end: 11,
      },
    ];

    expect(
      prepareComposerMentionBindingsForSend(
        "Use $github-app",
        rebaseComposerMentionBindings("Use $github", "Use $github-app", bindings),
      ),
    ).toEqual([]);
  });

  it("keeps bindings when the token casing changes", () => {
    const bindings = [
      {
        mention: "github",
        kind: "app" as const,
        path: "app://github",
        start: 4,
        end: 11,
      },
    ];

    expect(
      prepareComposerMentionBindingsForSend(
        "Use $GitHub",
        rebaseComposerMentionBindings("Use $github", "Use $GitHub", bindings),
      ),
    ).toEqual([
      {
        mention: "github",
        kind: "app",
        path: "app://github",
      },
    ]);
  });

  it("keeps bindings when the last token character changes casing", () => {
    const bindings = [
      {
        mention: "github",
        kind: "app" as const,
        path: "app://github",
        start: 4,
        end: 11,
      },
    ];

    expect(
      prepareComposerMentionBindingsForSend(
        "Use $github",
        rebaseComposerMentionBindings("Use $githuB", "Use $github", bindings),
      ),
    ).toEqual([
      {
        mention: "github",
        kind: "app",
        path: "app://github",
      },
    ]);
  });

  it("adds autocomplete-selected bindings at the inserted token range", () => {
    const item: ComposerAutocompleteItem = {
      id: "app:github",
      group: "Apps",
      label: "github",
      insertText: "$github",
      appendSpace: true,
      mentionBinding: {
        mention: "github",
        kind: "app",
        path: "app://github",
      },
    };

    expect(addComposerMentionBinding([], item, 4)).toEqual([
      {
        mention: "github",
        kind: "app",
        path: "app://github",
        start: 4,
        end: 11,
      },
    ]);
  });

  it("replaces an existing binding at the same token range", () => {
    const skillItem: ComposerAutocompleteItem = {
      id: "skill:github",
      group: "Skills",
      label: "github",
      insertText: "$github",
      appendSpace: true,
      mentionBinding: {
        mention: "github",
        kind: "skill",
        path: "/tmp/skein/.codex/skills/github/SKILL.md",
      },
    };
    const appItem: ComposerAutocompleteItem = {
      id: "app:github",
      group: "Apps",
      label: "github",
      insertText: "$github",
      appendSpace: true,
      mentionBinding: {
        mention: "github",
        kind: "app",
        path: "app://github",
      },
    };

    expect(
      addComposerMentionBinding(addComposerMentionBinding([], skillItem, 4), appItem, 4),
    ).toEqual([
      {
        mention: "github",
        kind: "app",
        path: "app://github",
        start: 4,
        end: 11,
      },
    ]);
  });

  it("adds file autocomplete bindings with at-mention ranges", () => {
    const item: ComposerAutocompleteItem = {
      id: "file:src/main.ts",
      group: "Files",
      label: "main.ts",
      insertText: "@src/main.ts",
      appendSpace: true,
      mentionBinding: {
        mention: "src/main.ts",
        kind: "file",
        path: "src/main.ts",
      },
    };

    const bindings = addComposerMentionBinding([], item, 7);

    expect(prepareComposerMentionBindingsForSend("Review @src/main.ts", bindings)).toEqual([
      {
        mention: "src/main.ts",
        kind: "file",
        path: "src/main.ts",
        start: 7,
        end: 19,
      },
    ]);
  });

  it("drops stale file bindings when the selected path is extended", () => {
    const bindings = [
      {
        mention: "src/main.ts",
        kind: "file" as const,
        path: "src/main.ts",
        start: 7,
        end: 19,
      },
    ];

    expect(
      prepareComposerMentionBindingsForSend(
        "Review @src/main.ts.old",
        rebaseComposerMentionBindings(
          "Review @src/main.ts",
          "Review @src/main.ts.old",
          bindings,
        ),
      ),
    ).toEqual([]);
  });
});
