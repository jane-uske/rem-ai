# PROJECT_CONTEXT.md

## What Rem is

Rem is a real-time AI companion / character system.
Its differentiator is not generic utility.
Its intended differentiation is:

- real-time voice interaction that feels alive
- strong character presence
- interruption-aware conversation
- memory that supports relationship feel over time

The product should not feel like:
- a customer support bot
- a generic voice assistant
- a collection of disconnected AI features

It should feel like:
- a responsive character
- someone who is present in the conversation
- someone with stable tone and gradually evolving familiarity

---

## Core Product Insight

Real-time voice aliveness is not the whole product, but it is the entry ticket.

Without it:
- the product feels slow
- the product feels artificial
- the product feels like a pipeline

With only it:
- the product may still feel empty

So the real target is:

"Make users feel they are interacting with a living Rem."

This requires three layers working together:

1. real-time interaction quality
2. stable character identity
3. long-term relationship continuity

---

## Current Priority

The biggest current gap is not that Rem cannot talk.
The biggest current gap is that relationship continuity is not yet real.

Current main thread:
- relationship layer phase 1

This means the project should currently prioritize:
- per-user relationship state
- cross-reconnect restore
- prompt consumption of relationship summary / topic continuity / mood trajectory / proactive hooks

This also means the project should not spend its main energy on:
- more silence-threshold tuning by itself
- isolated TTS first-audio optimizations
- avatar presentation expansion without relationship payoff

See [CURRENT_FOCUS.md](CURRENT_FOCUS.md) for the short execution-facing version.

---

## Current Diagnosis

The current system is not fundamentally wrong.
It already has many correct bones:

- websocket duplex communication
- session-level isolation
- fast brain / slow brain split
- interrupt controller
- sentence-level TTS
- memory pipeline

But the current live experience is still limited by structural bottlenecks.

### Recently tightened foundations

- interruption semantics are cleaner than before:
  - real user interruption is now separated from background slow-brain cancellation
  - interrupted assistant partials no longer pollute formal history / slow brain / normal persistence
- turn lifecycle semantics are clearer:
  - `interrupt` is no longer used as an idle text-send queue-clear signal
  - `chat_end` is now understood as text completion, not guaranteed playback completion
- observability is more usable for iteration:
  - `/health` exists as a lightweight gateway health endpoint
  - latency metrics and duplex harness scenario names are now stable enough for before/after comparison

### Main bottlenecks
1. input understanding begins too late
   - current flow is still too dependent on end-of-utterance recognition

2. turn-taking is too silence-driven
   - short pauses can be mistaken as turn completion
   - interruption/rhythm can feel unnatural

3. fast brain is still "fast reply" more than "fast reaction"
   - it becomes active too late in the user speech timeline

4. interruption is better scoped semantically, but recovery quality is still limited
   - correctness improved, but conversational branch recovery is still not yet rich enough
   - current system can preserve carry-forward context, but still does not fully behave like a live reactive character

---

## Product Philosophy

The project should favor:
- alive feeling over feature inflation
- staged upgrades over big rewrites
- real-time smoothness over heavy cognition in the fast path
- behavior quality over raw benchmark obsession

The project should preserve:
- fallback modes
- observability
- architectural boundaries
- role separation between fast and slow systems

---

## Competitive Direction

Rem should not try to win by doing everything.

It should not primarily compete on:
- number of supported backends
- number of integrations
- number of agent features
- "works with everything" claims

It should aim to compete on:
- conversational timing
- interruption quality
- voice UX
- character continuity
- relationship feel

A good positioning sentence:

"Rem is a real-time voice character system optimized for aliveness, not a generic chatbot with TTS."

---

## Local vs Server Deployment

High-performance local development is still valuable even if production will run on servers.

Local machine role:
- development machine
- low-friction iteration
- voice pipeline debugging
- local model experiments
- prototype validation

Server role:
- production inference
- scalable deployment
- hosted services

Do not confuse development machine decisions with production serving decisions.

---

## Open Source Direction

Open source can be viable, but not as "give everything away and hope."

Better direction:
- open core
- open client/framework layers
- monetize hosted services, premium voice, memory sync, character/content ecosystem

What may be open:
- client UI
- plugin interfaces
- local model adapters
- basic memory abstractions
- basic voice pipeline framework

What may stay closed / paid:
- hosted service
- premium voice stack
- sync
- content ecosystem
- scalable infra
- advanced behavior tuning
