# Rem Avatar Runtime

## Data Flow

1. `useRemChat.ts` receives WS events and derives:
- `avatarFrame`: server-provided face and lip-sync overlays
- `avatarIntent`: high-level intent derived from emotion and action

2. `Rem3DAvatar.tsx` forwards runtime inputs to the adapter:
- `setEmotion()`
- `setState()`
- `setIntent()`
- `setFrame()`
- `playAction()`

3. `runtimeAdapter.ts` keeps the live lip-signal reference and bridges React props to `RemVrmViewer`.

4. `vrmViewer.ts` is the renderer/runtime:
- resolves bones and camera
- blends idle, speech, emotion, action, and intent cues
- consumes `face` and `lipSync`
- publishes runtime snapshots to devtools

## Module Ownership

- `avatarIntent.ts`
  High-level schema and rule fallback. This is the place to evolve LLM output parsing later.

- `faceToVrm.ts`
  Mapping from protocol face/lip inputs to VRM expression presets.

- `emotionToVrm.ts`
  Baseline emotion weights and low-level expression merge helpers.

- `speechMotion.ts`
  Talking-state micro motion and envelope-driven speaking behavior.

- `devtoolsStore.ts`
  Shared ring-buffer log store and latest runtime snapshot.

## Rules For Future Changes

- Do not add direct bone-control fields to network payloads.
- New gestures should enter through high-level intent or action labels first.
- Keep mouth control layered:
  1. emotion
  2. face overlay
  3. action / intent accent
  4. speech micro motion
  5. viseme / lip-sync override
- If a new debug surface needs avatar internals, subscribe to `devtoolsStore` instead of reading viewer internals directly.
