# Spec A — Chat Composer & Markdown Enhancements

**Date:** 2026-07-18
**Status:** Approved design
**Scope:** Four small, independent frontend changes clustered around the chat composer and markdown renderer. Split-view / multi-session is deliberately excluded and tracked as a separate spec (Spec B).

## Motivation

CloudCLI's chat surface lags the Shell surface in a few small ways, and one bug loses user work:

- Attached images vanish when switching Chat → Shell → Chat (draft text survives, images don't).
- The model can be changed in the Shell but not visibly in Chat.
- The Shell shows a context-window health bar (`8%`); Chat shows only a raw token count.
- Agents routinely emit Mermaid diagrams, which render as plain code blocks.

Each item ships independently. None depends on another.

---

## 1. Image-persistence fix (bug)

**Root cause.** `useChatComposerState.ts` holds `attachedImages` in `useState<File[]>([])` (~line 223). Switching to the Shell tab unmounts `ChatInterface` (`MainContent.tsx:148` renders it behind `activeTab === 'chat' && (...)`). Draft *text* survives because it is persisted to `localStorage` under `draft_input_${projectId}` (~line 217) and re-read on mount; images are not persisted, so they are lost on unmount.

**Fix.** Persist attachments the same way as the draft text:

- On change, serialize `attachedImages` to base64 and store under `draft_images_${selectedProject.projectId}`.
- On mount, restore from that key (reconstruct `File`/attachment objects), mirroring the draft-text init.
- On send (and on explicit clear), remove the stored images alongside the existing draft clear.
- **Size guard:** if total serialized size exceeds ~4 MB, skip persistence and warn once (console/log). Oversized attachments then behave exactly as today (lost on unmount) rather than throwing a quota error. This keeps us safely under the ~5 MB localStorage quota.

**Out of scope.** No IndexedDB migration, no server-side attachment storage. base64-in-localStorage with a size guard matches the existing draft pattern and keeps the blast radius small.

**Test.** Unit test the storage round-trip: persist N images → restore → identical set; and the size guard: oversized payload is skipped (no throw), small payload persists.

---

## 2. Model chip in composer

**Current state.** The capability already exists: `/models` slash command → `CommandResultModal.handleSelectModel` (~line 281) → `onSelectProviderModel(provider, model, sessionId)`. It is simply not surfaced as a visible control; the composer shows only the Mode and Effort chips.

**Fix.** Add a model chip in `ChatComposer.tsx` next to the Mode/Effort chips:

- Label shows the active model for the current provider (from the existing `claudeModel` / `codexModel` / `geminiModel` / `cursorModel` / `opencodeModel` state already threaded through `useChatComposerState`).
- Clicking opens the existing models modal (reuse the same command path that `/models` triggers — `onShowModels` / the models `CommandResultModal`). No new selection logic, no new backend call.

**Out of scope.** No inline dropdown reimplementation; reuse the modal that already exists.

**Test.** Verified in the running app (chip renders current model, opens modal, selection applies).

---

## 3. Context health bar

**Current state.** The usage payload already carries both `used` and `total` (context window): `claude-sdk.js` returns `{ used, total, ... }` where `total = process.env.CONTEXT_WINDOW || 160000` (~line 396/428); the Codex provider emits `total: info.model_context_window || 200000`. `TokenUsageSummary.tsx` receives `usage.used` and `usage.total` but renders only the count.

**Fix.** In `TokenUsageSummary.tsx`, render a thin percentage bar alongside the existing count:

- Percentage = `used / total`, guarded for `total <= 0` (render count only, no bar).
- Color thresholds: green (low), amber (mid), red (near-full) — thresholds defined as named constants.
- Where a provider's usage omits `total`, fall back to a small per-provider default map (Claude 160K/200K, Codex 200K, others per their documented window).

**Follow-up (not in this spec).** The global `CONTEXT_WINDOW=160000` default in `claude-sdk.js` is not per-model. Making it accurate per active model is a separate backend refinement; the bar works correctly with the current payload today.

**Test.** Unit test the %/color logic: known `used`/`total` pairs map to the expected bucket; `total <= 0` yields no bar.

---

## 4. Mermaid rendering

**Current state.** `Markdown.tsx` supports KaTeX (`rehypeKatex`) and Prism syntax highlighting, but ` ```mermaid ` fenced blocks fall through to the plain code renderer.

**Fix.** In the existing code-block renderer in `Markdown.tsx`:

- Detect `language-mermaid` fenced blocks and render them via a Mermaid component.
- Lazy-import the `mermaid` library so it does not bloat the main bundle (only loaded when a diagram appears).
- Theme the diagram to light/dark from `ThemeContext`.
- On parse/render error, fall back to the raw code block (never break the message).

**Out of scope.** No live editing of diagrams, no export button.

**Test.** Verified in the running app (valid diagram renders; invalid diagram falls back to code; theme follows dark/light toggle).

---

## Testing summary

- **Unit:** image storage round-trip + size guard; context %/color bucket logic.
- **In-app:** model chip, Mermaid rendering (incl. error fallback + theme).

## Non-goals

- Split-view / multi-session tabs (Spec B).
- Per-model backend context-window accuracy (follow-up).
- IndexedDB / server-side attachment storage.
- Mermaid editing/export.
