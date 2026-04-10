See also:
- CURRENT_FOCUS.md
- TASKS.md
- PROJECT_CONTEXT.md
- VOICE_ROADMAP.md
- ARCHITECTURE.md
- PIPELINE.md

# AGENTS.md

## Project
Rem is a real-time AI companion system focused on low-latency voice interaction, interruptibility, character consistency, and long-term relationship feel.

This project is not a generic chatbot.
Primary product goal:
- make Rem feel alive in real-time voice interaction

Secondary goals:
- stable architecture
- maintainable modules
- low-latency streaming
- clear separation between fast response path and slow cognition path

---

## Top Priorities

When making changes, optimize for these in order:

1. Real-time interaction quality
   - lower perceived latency
   - reduce awkward pauses
   - improve interrupt handling
   - improve turn-taking accuracy

2. Character consistency
   - preserve Rem's personality, tone, and emotional continuity
   - avoid generic assistant-like responses

3. Architectural clarity
   - avoid hacks that blur responsibilities between modules
   - prefer explicit state and boundaries

4. Reliability
   - do not break existing text chat flow
   - do not break fallback modes
   - keep feature flags for risky changes

---

## Current Focus

Current main thread: 关系层第一阶段。

Current goal:
- make "她记得我们" real across reconnects, not just inside one session

Do not prioritize first:
- pure VAD threshold tuning
- TTS first-audio micro-optimizations by themselves
- avatar presentation expansion without relationship continuity payoff

Success means:
- per-user relationship state
- cross-reconnect restore
- prompt consumption of relationship summary / topic continuity / mood trajectory / proactive hooks
- interrupted partials do not pollute formal state

Read [CURRENT_FOCUS.md](CURRENT_FOCUS.md) before touching `server/session/*`, `brains/*`, `memory/*`, or `brain/*` for roadmap-sensitive work.
After finishing code for a current-thread task, update the corresponding task status in [TASKS.md](TASKS.md) and any directly affected roadmap docs before reporting completion.

---

## Core Architecture Principles

### 1. Fast brain vs slow brain
Keep the distinction sharp.

- Fast brain:
  - handles low-latency conversational response
  - handles backchannel, short acknowledgements, interruption recovery
  - should never do heavy blocking work

- Slow brain:
  - handles memory extraction
  - deeper reasoning
  - topic analysis
  - emotional analysis
  - long-horizon context updates

Do not move slow tasks into the fast path.

### 2. Voice UX is a first-class system
Voice is not just "text + TTS".
Any voice-related change must consider:
- turn-taking
- interruption
- streaming behavior
- first-audio latency
- sentence chunking stability
- playback continuity

### 3. Interruptions must feel conversational
Interrupt handling must not behave like a media player stop button.
Prefer:
- graceful stop
- contextual carry-over
- interruption-aware response policy

### 4. Memory must not block live interaction
Memory retrieval and write-back should not noticeably slow down real-time response.
Prefer async updates and bounded retrieval.

---

## Current Known Product Direction

The current system is a hybrid pipeline:
- VAD
- STT
- LLM
- TTS
- interrupt controller
- fast/slow brain
- memory pipeline

Desired direction:
- more incremental input
- better turn-taking
- more natural interruption recovery
- stronger real-time character behavior

Avoid full rewrites unless explicitly required.
Prefer staged upgrades.

---

## Rules For Code Changes

### Always do
- preserve existing behavior unless task explicitly changes it
- add feature flags for risky behavior changes
- keep fallback paths when introducing new real-time logic
- add logging around turn-taking, interruption, and latency-sensitive decisions
- keep modules small and responsibilities explicit
- document new state fields and event types

### Never do
- do not merge large architectural rewrites without staged migration
- do not add blocking work into the fast response path
- do not tightly couple memory logic into voice streaming logic
- do not hardcode product behavior into random utility files
- do not silently remove fallback modes
- do not fake completion in reports

---

## Reporting Requirements

When you finish a task, do not give marketing-style summaries.
Always report in this format:

### 1. What changed
- files modified
- functions/classes added or changed
- new config flags
- new state fields
- new events

### 2. Why it changed
- what problem this solves
- what tradeoff was made

### 3. Risk
- what could break
- what fallback exists
- how to disable the feature

### 4. Evidence
- test cases
- logs
- latency measurements
- before/after comparison

### 5. Remaining gaps
- what is still not solved
- what this task did NOT do

If the work maps to a tracked task, update that task's document status before saying it is complete.

Do not say "all done" unless all acceptance criteria are explicitly verified.

---

## Task Execution Style

For non-trivial tasks, work in phases.

Preferred pattern:
1. inspect current implementation
2. propose minimal change plan
3. implement smallest viable version
4. test
5. report risks and next step

For voice pipeline work, prefer incremental improvement over sweeping rewrite.

---

## Voice-Specific Guidance

### Turn-taking
Current known weakness:
- over-reliance on silence/VAD thresholds

Preferred improvements:
- combine VAD + transcript growth + simple semantic completion rules
- make decisions observable through logs
- keep response speed high while reducing premature replies

### STT
Preferred direction:
- incremental or partial transcript support
- preserve final transcript path as source of truth
- partial transcript must not corrupt final state

### TTS
Preferred direction:
- lower first-audio latency
- stable sentence chunking
- preserve emotional tone and continuity
- avoid over-fragmented chunks

### Interruptions
Preferred direction:
- classify interruption types when possible
- support graceful conversational continuation
- avoid full state reset unless necessary

---

## Memory Guidance

Memory should affect:
- what Rem remembers
- how Rem relates to the user
- how Rem phrases responses over time

Memory should not:
- stall the live response path
- flood prompts with irrelevant context
- overwrite short-term conversational flow

Prefer bounded retrieval and explicit write-back timing.

---

## File Areas

These are high-sensitivity areas. Be careful when editing:

- `server/session/*`
- `server/pipeline/*`
- `voice/*`
- `brains/*`
- `memory/*`
- `web/src/hooks/useRemChat.ts`

If changing one of these, explain state transitions clearly.

---

## Acceptance Mindset

A change is only successful if it improves user experience, not just internal elegance.

For voice tasks, success should usually be measurable through at least one of:
- lower first-token latency
- lower first-audio latency
- fewer premature turn-takes
- better interruption recovery
- smoother playback continuity

---

## If Unsure

When uncertain, choose:
- simpler design
- clearer state
- safer rollout
- measurable behavior
- minimal invasive change

Do not optimize for cleverness.
Optimize for Rem feeling alive.

---

## Product Context Summary

Rem is not being built as a generic assistant.
The core product bet is:

- Rem should feel alive in real-time interaction
- voice interaction quality is a primary differentiator
- long-term memory matters, but must not damage live interaction
- the goal is not "feature breadth", but "felt aliveness"

### What matters most
In practice, user experience quality depends on these layers:

1. real-time conversational feel
   - low delay
   - natural turn-taking
   - interruption handling
   - smooth response onset

2. character identity
   - replies must feel like Rem
   - avoid generic assistant tone
   - maintain emotional continuity

3. long-term relationship feel
   - memory should shape behavior over time
   - memory should affect style and relationship, not just factual recall

### What we are NOT optimizing for
- maximizing number of supported models/platforms at all costs
- generic assistant capability breadth
- shipping large rewrites with unclear UX benefit
- stuffing heavy cognition into the live response path

### Strategic product positioning
Rem should aim to become:
- not the most feature-rich open-source companion
- but one of the most alive-feeling real-time voice character systems
⸻
