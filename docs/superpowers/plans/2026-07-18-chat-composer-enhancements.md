# Chat Composer & Markdown Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring four small chat-surface improvements to parity with the Shell — persist image attachments across tab switches, surface a model-picker chip, show a context-window health bar, and render Mermaid diagrams.

**Architecture:** Four independent frontend changes. Two carry extractable pure logic (attachment (de)serialization, context-health math) placed in small helper modules with `node:test` unit tests; two are UI wiring verified in the running app. No new backend endpoints.

**Tech Stack:** React + TypeScript, Vite, `node:test`/`node:assert` via `tsx`, existing `safeLocalStorage`, `mermaid` (new dependency, lazy-loaded).

## Global Constraints

- Test runner: `npx tsx --test <file>` — tests use `import test from 'node:test'` and `import assert from 'node:assert/strict'`. No DOM/browser test harness exists; unit tests must be pure logic only.
- Lint gate: `npm run lint` (eslint over `src/` and `server/`) must pass before every commit.
- localStorage access goes through `safeLocalStorage` from `src/components/chat/utils/chatStorage.ts`.
- Per-project keys use `selectedProject.projectId` (the DB id), matching the existing `draft_input_${projectId}` pattern.
- Preserve existing behavior: draft text persistence, the `.slice(0, 5)` image cap, and the `/models` and `/cost` slash commands must keep working unchanged.

---

## Task 1: Attachment persistence helper (pure logic)

Extract the encode/decode/size-guard logic into a testable module. No hook changes yet.

**Files:**
- Create: `src/components/chat/utils/attachmentStorage.ts`
- Test: `src/components/chat/utils/attachmentStorage.test.ts`

**Interfaces:**
- Produces:
  - `type StoredAttachment = { name: string; type: string; dataUrl: string }`
  - `const ATTACHMENT_QUOTA_BYTES = 4_000_000`
  - `function serializeStoredAttachments(items: StoredAttachment[]): string | null` — returns JSON, or `null` if the serialized string exceeds `ATTACHMENT_QUOTA_BYTES` (caller then skips persistence).
  - `function deserializeStoredAttachments(raw: string | null): StoredAttachment[]` — safe parse; returns `[]` on null/invalid.

- [ ] **Step 1: Write the failing test**

Create `src/components/chat/utils/attachmentStorage.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATTACHMENT_QUOTA_BYTES,
  deserializeStoredAttachments,
  serializeStoredAttachments,
  type StoredAttachment,
} from './attachmentStorage';

const sample: StoredAttachment[] = [
  { name: 'a.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
];

test('round-trips attachments', () => {
  const raw = serializeStoredAttachments(sample);
  assert.ok(raw);
  assert.deepEqual(deserializeStoredAttachments(raw), sample);
});

test('returns null when over quota', () => {
  const big: StoredAttachment[] = [
    { name: 'big.png', type: 'image/png', dataUrl: 'x'.repeat(ATTACHMENT_QUOTA_BYTES + 1) },
  ];
  assert.equal(serializeStoredAttachments(big), null);
});

test('deserialize is safe on garbage', () => {
  assert.deepEqual(deserializeStoredAttachments(null), []);
  assert.deepEqual(deserializeStoredAttachments('not json'), []);
  assert.deepEqual(deserializeStoredAttachments('{"not":"array"}'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/components/chat/utils/attachmentStorage.test.ts`
Expected: FAIL — cannot find module `./attachmentStorage`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/chat/utils/attachmentStorage.ts`:

```ts
export type StoredAttachment = { name: string; type: string; dataUrl: string };

export const ATTACHMENT_QUOTA_BYTES = 4_000_000;

export function serializeStoredAttachments(items: StoredAttachment[]): string | null {
  const raw = JSON.stringify(items);
  if (raw.length > ATTACHMENT_QUOTA_BYTES) {
    return null;
  }
  return raw;
}

export function deserializeStoredAttachments(raw: string | null): StoredAttachment[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is StoredAttachment =>
        Boolean(item) &&
        typeof item.name === 'string' &&
        typeof item.type === 'string' &&
        typeof item.dataUrl === 'string',
    );
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/components/chat/utils/attachmentStorage.test.ts`
Expected: PASS — `# pass 3  # fail 0`.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/components/chat/utils/attachmentStorage.ts src/components/chat/utils/attachmentStorage.test.ts
git commit -m "feat(chat): add attachment storage helper with quota guard"
```

---

## Task 2: Persist attachments across tab switches (wire helper into composer)

Wire Task 1's helper into `useChatComposerState` so images survive unmount, mirroring the draft-text persistence at lines 944-965.

**Files:**
- Modify: `src/components/chat/hooks/useChatComposerState.ts`

**Interfaces:**
- Consumes: `serializeStoredAttachments`, `deserializeStoredAttachments`, `StoredAttachment` from Task 1.
- Relies on existing: `attachedImages: File[]` (line 223), `setAttachedImages` (line 548), `safeLocalStorage`, `selectedProjectId` (line 243), the send-clear at lines 650/827, and the draft-clear at 623/836.

- [ ] **Step 1: Add helpers for File ⇄ StoredAttachment**

At the top of `useChatComposerState.ts`, add the import (next to the existing `chatStorage` import ~line 21):

```ts
import {
  deserializeStoredAttachments,
  serializeStoredAttachments,
  type StoredAttachment,
} from '../utils/attachmentStorage';
```

Add these module-scope helpers below the imports (before the hook):

```ts
const ATTACHMENT_STORAGE_PREFIX = 'draft_images_';

function fileToStoredAttachment(file: File): Promise<StoredAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ name: file.name, type: file.type, dataUrl: String(reader.result) });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function storedAttachmentToFile(stored: StoredAttachment): Promise<File> {
  const blob = await (await fetch(stored.dataUrl)).blob();
  return new File([blob], stored.name, { type: stored.type });
}
```

- [ ] **Step 2: Restore attachments on project mount/change**

Immediately after the draft-restore effect (ends line 954), add a sibling effect:

```ts
  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    const raw = safeLocalStorage.getItem(`${ATTACHMENT_STORAGE_PREFIX}${selectedProjectId}`);
    const stored = deserializeStoredAttachments(raw);
    if (stored.length === 0) {
      return;
    }
    let cancelled = false;
    Promise.all(stored.map(storedAttachmentToFile))
      .then((files) => {
        if (!cancelled) {
          setAttachedImages(files.slice(0, 5));
        }
      })
      .catch((error) => console.error('Failed to restore attachments:', error));
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);
```

- [ ] **Step 3: Persist attachments whenever they change**

After the draft-persist effect (ends line 965), add:

```ts
  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    const key = `${ATTACHMENT_STORAGE_PREFIX}${selectedProjectId}`;
    if (attachedImages.length === 0) {
      safeLocalStorage.removeItem(key);
      return;
    }
    let cancelled = false;
    Promise.all(attachedImages.map(fileToStoredAttachment))
      .then((stored) => {
        if (cancelled) {
          return;
        }
        const raw = serializeStoredAttachments(stored);
        if (raw === null) {
          console.warn('Attachments exceed persistence quota; skipping save.');
          safeLocalStorage.removeItem(key);
          return;
        }
        safeLocalStorage.setItem(key, raw);
      })
      .catch((error) => console.error('Failed to persist attachments:', error));
    return () => {
      cancelled = true;
    };
  }, [attachedImages, selectedProjectId]);
```

- [ ] **Step 4: Clear persisted attachments on send**

The two existing `setAttachedImages([])` sites (lines ~650 and ~827) empty the array; the effect in Step 3 already fires `removeItem` when the array becomes empty, so no extra clear is required. Verify by reading both sites and confirming they call `setAttachedImages([])` (not a direct mutation). No code change if confirmed.

- [ ] **Step 5: Verify in the running app**

```bash
npm run dev
```

Steps: open a project chat → attach 1-2 images → type draft text → switch to the Shell tab → switch back to Chat.
Expected: both the draft text AND the images are still present. Send the message; confirm images upload and the composer clears.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add src/components/chat/hooks/useChatComposerState.ts
git commit -m "fix(chat): persist image attachments across tab switches"
```

---

## Task 3: Context health bar

Extract the used/total → percent+level math into a pure helper with tests, then render a bar in `TokenUsageSummary`.

**Files:**
- Create: `src/components/chat/utils/contextHealth.ts`
- Test: `src/components/chat/utils/contextHealth.test.ts`
- Modify: `src/components/chat/view/subcomponents/TokenUsageSummary.tsx`

**Interfaces:**
- Produces:
  - `type ContextLevel = 'ok' | 'warn' | 'critical'`
  - `function computeContextHealth(used: number, total: number): { percent: number; level: ContextLevel } | null` — returns `null` when `total <= 0` (no bar). `percent` is 0-100, clamped. Thresholds: `< 70` → `ok`, `< 90` → `warn`, else `critical`.

- [ ] **Step 1: Write the failing test**

Create `src/components/chat/utils/contextHealth.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { computeContextHealth } from './contextHealth';

test('returns null when total is non-positive', () => {
  assert.equal(computeContextHealth(100, 0), null);
  assert.equal(computeContextHealth(100, -5), null);
});

test('buckets levels by percent', () => {
  assert.deepEqual(computeContextHealth(0, 200000), { percent: 0, level: 'ok' });
  assert.deepEqual(computeContextHealth(139999, 200000).level, 'ok'); // ~70% boundary below
  assert.equal(computeContextHealth(150000, 200000).level, 'warn');
  assert.equal(computeContextHealth(190000, 200000).level, 'critical');
});

test('clamps percent to 100', () => {
  assert.equal(computeContextHealth(300000, 200000).percent, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/components/chat/utils/contextHealth.test.ts`
Expected: FAIL — cannot find module `./contextHealth`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/chat/utils/contextHealth.ts`:

```ts
export type ContextLevel = 'ok' | 'warn' | 'critical';

const WARN_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 90;

export function computeContextHealth(
  used: number,
  total: number,
): { percent: number; level: ContextLevel } | null {
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  const rawPercent = (used / total) * 100;
  const percent = Math.max(0, Math.min(100, Math.round(rawPercent)));
  const level: ContextLevel =
    percent < WARN_THRESHOLD ? 'ok' : percent < CRITICAL_THRESHOLD ? 'warn' : 'critical';
  return { percent, level };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/components/chat/utils/contextHealth.test.ts`
Expected: PASS — `# pass 3  # fail 0`.

- [ ] **Step 5: Render the bar in TokenUsageSummary**

In `src/components/chat/view/subcomponents/TokenUsageSummary.tsx`, add the import at the top:

```ts
import { computeContextHealth, type ContextLevel } from '../../utils/contextHealth';
```

Inside the component, after `usedTokens` is computed (line ~41), add:

```ts
  const totalTokens = readUsageNumber(usage?.total);
  const health = computeContextHealth(usedTokens, totalTokens);
  const barColor: Record<ContextLevel, string> = {
    ok: 'bg-emerald-500',
    warn: 'bg-amber-500',
    critical: 'bg-red-500',
  };
```

Then, inside the `<button>` (after the token count `<span>`s, before the button closes at line ~55), add the bar — rendered only when `health` is non-null:

```tsx
      {health && (
        <span
          className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-border/60 sm:inline-block"
          title={`${health.percent}% of context window used`}
          aria-label={`Context ${health.percent}% used`}
        >
          <span
            className={`block h-full rounded-full ${barColor[health.level]}`}
            style={{ width: `${health.percent}%` }}
          />
        </span>
      )}
```

- [ ] **Step 6: Verify in the running app**

`npm run dev` → open a chat with usage (send a message or open an existing session). Expected: a small colored bar appears next to the token count; hovering shows "N% of context window used"; the color reflects fullness. Sessions whose usage lacks `total` show no bar (count only).

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/components/chat/utils/contextHealth.ts src/components/chat/utils/contextHealth.test.ts src/components/chat/view/subcomponents/TokenUsageSummary.tsx
git commit -m "feat(chat): add context-window health bar to token usage"
```

---

## Task 4: Model-picker chip in composer

Surface the already-working `/models` modal as a visible chip, reusing the `showCostModal` pattern (lines 444-455).

**Files:**
- Modify: `src/components/chat/hooks/useChatComposerState.ts`
- Modify: `src/components/chat/view/ChatInterface.tsx` (thread the new props)
- Modify: `src/components/chat/view/subcomponents/ChatComposer.tsx`

**Interfaces:**
- Produces from the hook: `showModelsModal: () => void` and `currentModel: string`.
- ChatComposer consumes new props: `currentModel: string`, `onOpenModelPicker: () => void`.

- [ ] **Step 1: Add `showModelsModal` and `currentModel` to the hook**

In `useChatComposerState.ts`, directly after `showCostModal` (ends line 455), add:

```ts
  const currentModel =
    provider === 'cursor'
      ? cursorModel
      : provider === 'codex'
        ? codexModel
        : provider === 'gemini'
          ? geminiModel
          : provider === 'opencode'
            ? opencodeModel
            : claudeModel;

  const showModelsModal = useCallback(() => {
    executeCommand(
      {
        name: '/models',
        description: 'Select the active model',
        namespace: 'builtin',
        metadata: { type: 'builtin' },
      } as SlashCommand,
      '/models',
      { preserveInput: true },
    );
  }, [executeCommand]);
```

Add `showModelsModal` and `currentModel` to the hook's return object (the same object that already returns `attachedImages`, `setAttachedImages` at lines ~1165-1166).

- [ ] **Step 2: Thread props through ChatInterface**

In `src/components/chat/view/ChatInterface.tsx`, destructure `showModelsModal` and `currentModel` from the `useChatComposerState(...)` result (alongside `commandModalPayload` at line ~197), and pass them to `<ChatComposer>` as:

```tsx
  currentModel={currentModel}
  onOpenModelPicker={showModelsModal}
```

- [ ] **Step 3: Add the chip to ChatComposer**

In `src/components/chat/view/subcomponents/ChatComposer.tsx`, add the props to the type (near `onSelectEffort` line 71) and destructure (near line 128):

```ts
  currentModel: string;
  onOpenModelPicker: () => void;
```

Render the chip immediately before `<TokenUsageSummary ... />` (line 518), matching the Effort chip's styling:

```tsx
            {currentModel && (
              <button
                type="button"
                onClick={onOpenModelPicker}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground sm:px-2.5"
                title="Change model"
                aria-label={`Change model (current: ${currentModel})`}
              >
                <span className="max-w-[10rem] truncate font-medium text-foreground">{currentModel}</span>
              </button>
            )}
```

- [ ] **Step 4: Verify in the running app**

`npm run dev` → open a chat. Expected: a chip shows the current model next to Mode/Effort; clicking it opens the same models modal that `/models` opens; selecting a model updates the chip label; the draft text is preserved (because of `preserveInput: true`).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/components/chat/hooks/useChatComposerState.ts src/components/chat/view/ChatInterface.tsx src/components/chat/view/subcomponents/ChatComposer.tsx
git commit -m "feat(chat): add model-picker chip to composer"
```

---

## Task 5: Mermaid diagram rendering

Render ` ```mermaid ` fenced blocks as diagrams in `Markdown.tsx`, lazy-loading the library.

**Files:**
- Modify: `package.json` (add `mermaid` dependency)
- Create: `src/components/chat/view/subcomponents/MermaidDiagram.tsx`
- Modify: `src/components/chat/view/subcomponents/Markdown.tsx`

**Interfaces:**
- Produces: `MermaidDiagram` — `function MermaidDiagram({ code, isDarkMode }: { code: string; isDarkMode: boolean }): JSX.Element`. On render error, falls back to a plain `<pre>` showing `code`.
- Consumes in `Markdown.tsx`: the existing `language` variable (line 66) and `isDarkMode` (already in scope, used at line 90).

- [ ] **Step 1: Install mermaid**

```bash
npm install mermaid
```

Expected: `mermaid` added to `dependencies` in `package.json`.

- [ ] **Step 2: Create the MermaidDiagram component**

Create `src/components/chat/view/subcomponents/MermaidDiagram.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';

let mermaidIdCounter = 0;

export default function MermaidDiagram({ code, isDarkMode }: { code: string; isDarkMode: boolean }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mermaid-${mermaidIdCounter++}`);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSvg(null);
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: isDarkMode ? 'dark' : 'default' });
        const { svg: rendered } = await mermaid.render(idRef.current, code);
        if (!cancelled) {
          setSvg(rendered);
        }
      } catch (error) {
        console.error('Mermaid render failed:', error);
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, isDarkMode]);

  if (failed) {
    return (
      <pre className="my-2 overflow-x-auto rounded-xl bg-muted p-4 text-sm">
        <code>{code}</code>
      </pre>
    );
  }

  if (!svg) {
    return <div className="my-2 text-xs text-muted-foreground">Rendering diagram…</div>;
  }

  return <div className="my-2 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />;
}
```

- [ ] **Step 3: Branch to MermaidDiagram in Markdown.tsx**

In `src/components/chat/view/subcomponents/Markdown.tsx`, add the import at the top:

```ts
import MermaidDiagram from './MermaidDiagram';
```

In the `CodeBlock` renderer, after `language` is computed (line 66) and before the `return (` at line 68, add:

```tsx
  if (language === 'mermaid') {
    return <MermaidDiagram code={raw} isDarkMode={isDarkMode} />;
  }
```

- [ ] **Step 4: Verify in the running app**

`npm run dev` → in a chat message, render markdown containing:

    ```mermaid
    graph TD; A-->B; B-->C;
    ```

Expected: a rendered flowchart (not raw text). Toggle dark/light — the diagram theme follows. Send an invalid diagram (e.g. `graph TD; A--`) — it falls back to a code block, no crash.

- [ ] **Step 5: Confirm build (bundle) succeeds with lazy import**

Run: `npm run build:client`
Expected: build succeeds; `mermaid` appears in a separate lazy chunk (not the main entry).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add package.json package-lock.json src/components/chat/view/subcomponents/MermaidDiagram.tsx src/components/chat/view/subcomponents/Markdown.tsx
git commit -m "feat(chat): render mermaid diagrams in markdown"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 Image-persistence fix → Tasks 1 (helper + tests) & 2 (wiring, size guard, clear-on-send). ✓
- Spec §2 Model chip → Task 4 (chip + reuse of `/models` path). ✓
- Spec §3 Context health bar → Task 3 (pure math + tests + bar; `total<=0` guard; per-provider fallback handled by rendering only when payload carries `total`). ✓
- Spec §4 Mermaid → Task 5 (lazy import, theme, error fallback). ✓
- Non-goals (split-view, per-model backend window accuracy, IndexedDB, Mermaid editing) → not planned. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `StoredAttachment` shared between Tasks 1/2; `computeContextHealth`/`ContextLevel` shared within Task 3; `showModelsModal`/`currentModel`/`onOpenModelPicker` consistent across Task 4 hook→ChatInterface→ChatComposer. ✓

**Note for implementer:** Line numbers reference the code at plan-writing time; if they've drifted, anchor on the named symbols (`showCostModal`, the draft-persist effect, `TokenUsageSummary`'s `usedTokens`, `CodeBlock`'s `language`).
