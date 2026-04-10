# VOICE_ROADMAP.md

## Goal

Upgrade Rem from a "pipeline that can talk" into a "real-time voice character system that feels alive."

This should be done in stages, not via a full rewrite.

---

## Current Priority Before Voice Expansion

Before expanding further into voice behavior, the current main thread is:
- relationship layer phase 1

Why this comes first:
- fast brain behavior upgrades only matter if relationship state can already be consumed consistently
- proactive behavior only feels natural if proactive hooks already exist and survive across reconnects
- otherwise the system risks becoming a smoother voice bot instead of a more continuous companion

Current focus:
- restore per-user relationship state
- restore continuity across reconnects
- inject relationship summary / topic continuity / mood trajectory / proactive hooks into prompt context

See [CURRENT_FOCUS.md](CURRENT_FOCUS.md) for the short execution view.

---

## Current Architecture Summary

Current broad flow:

user speech/text input
-> websocket gateway
-> session instance
-> pipeline runner
-> VAD/STT
-> fast/slow brain
-> memory update
-> sentence chunking
-> TTS
-> frontend playback

Key current strengths:
- duplex transport
- fast/slow brain split
- interrupt controller
- sentence-level TTS
- memory layer
- avatar controller
- interruption semantics have been tightened
- turn lifecycle semantics are clearer
- latency and replay baselines now exist for iterative tuning

Key current weaknesses:
- turn-taking too dependent on silence
- STT and live understanding still not real-time enough
- interruption carry-forward is now cleaner, but still not expressive enough
- fast brain enters too late
- voice UX still partly pipeline-like

### Current status after the latest semantics pass

- `interrupt` now means a real preemption of an active generation, not a generic queue-clear hint.
- `chat_end` now means text stream completion; the client can remain in `assistant_speaking` until local playback drains.
- interrupted assistant partials now stay out of formal history / slow brain / normal assistant persistence.
- `/health`, latency tracer snapshots, and duplex harness scenario keys are now usable as a repeatable baseline.
- the next bottleneck is no longer only voice semantics; relationship continuity is now the main missing layer

---

## Design Principle

Do not optimize only for lower latency numbers.
Optimize for perceived aliveness.

That means:
- response onset
- timing
- turn-taking
- interruption behavior
- continuity
- tone

matter as much as model quality.

---

## Stage 1: Incremental Input

### Objective
Shift from "wait until user is done" toward "start understanding while user is speaking."

### Main changes
- support partial / incremental transcript flow
- maintain final transcript as source of truth
- allow fast brain precomputation / pre-reaction preparation
- preserve fallback modes

### Why
This is the highest-leverage improvement because it moves understanding earlier in time.

### Success signals
- earlier system readiness
- lower first-token delay after final transcript
- no corruption of final transcript state
- rollback remains easy

---

## Stage 2: Better Turn-Taking

### Objective
Stop relying mainly on silence thresholds.
Move toward VAD + transcript growth + basic semantic completion signals.

### Main changes
- add a turn manager / turn detector
- classify turn state into hold / likely_end / confirmed_end
- reduce premature AI responses during short user pauses

### Current implementation note
- the project already exposes `listening_hold / likely_end / confirmed_end` style turn states
- the remaining work is not naming the states, but improving the decision quality behind them

### Why
Poor turn-taking kills aliveness even when models are good.

### Success signals
- fewer premature replies
- fewer awkward interruptions of the user
- response timing remains competitive

---

## Stage 3: Interruption Carry-Forward

### Objective
Move from "interrupt = hard stop" to "interrupt = conversational branch change."

### Main changes
- classify interruption type
- preserve interruption context
- generate different carry-forward behavior for correction, continuation, topic switch, emotional interruption

### Current implementation note
- interruption types and carry-forward hints already exist
- the recent fix was mainly about correctness:
  - only real interruptions should set interruption state
  - interrupted partials should not corrupt formal history
- the remaining work is behavioral richness, not basic semantics

### Why
Humans do not merely stop when interrupted. They adapt.

### Success signals
- interruption feels conversational
- less hard reset feeling
- next reply feels context-aware

---

## Stage 4: Fast Brain as Real-Time Character Engine

### Objective
Upgrade fast brain from low-latency responder into a live behavior engine.

### Main changes
- support short acknowledgements, fillers, backchannels
- let emotional state and relationship state shape delivery
- allow avatar and voice behavior coupling
- keep slow brain responsible for deeper cognition and memory extraction

### Why
"Alive feeling" comes from behavioral rhythm, not just textual prompt content.

### Success signals
- same semantic response can sound/feel different depending on relationship and emotional state
- short reactions feel in-character
- voice and avatar state reinforce each other

---

## Non-Goals

Do not optimize first for:
- maximum backend compatibility
- giant rewrites
- broad multimodal sprawl
- assistant-like tool overexpansion

These can come later if they do not damage the core voice experience.

---

## Architectural Boundaries To Preserve

### Fast brain
Owns:
- low-latency reactions
- response onset
- short acknowledgements
- interruption carry-forward
- behavior timing

Should not own:
- heavy retrieval
- long analysis
- large blocking tasks

### Slow brain
Owns:
- memory extraction
- deeper reasoning
- relationship summaries
- topic analysis
- emotional analysis

Should not block:
- live voice response path

### Memory
Should influence:
- style
- familiarity
- interaction habits
- relationship tone

Should not:
- flood prompts
- block live interaction
- dominate every response

---

## Product-Level Interpretation

The real target is not:
"make the voice system technically advanced"

The real target is:
"make Rem feel responsive, interruptible, and present like a character who is actually there."
