"use client";

import { useSyncExternalStore } from "react";
import type { AvatarActionCommand, AvatarIntent, RemState } from "@/types/avatar";

export interface AvatarDevtoolsLogEntry {
  id: number;
  ts: number;
  kind: "ws" | "intent" | "runtime" | "expression" | "system";
  summary: string;
  data?: unknown;
}

export interface AvatarRuntimeSnapshot {
  ts: number;
  emotion: string;
  remState: RemState;
  voiceActive: boolean;
  lipEnvelope: number;
  expressionWeights: Partial<Record<string, number>>;
  activeAction?: AvatarActionCommand | null;
  activeCue?: string | null;
  runtimeState?: string;
  intent?: AvatarIntent | null;
}

type AvatarDevtoolsState = {
  logs: AvatarDevtoolsLogEntry[];
  snapshot: AvatarRuntimeSnapshot | null;
};

const MAX_LOGS = 180;

let state: AvatarDevtoolsState = {
  logs: [],
  snapshot: null,
};
let nextLogId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(next: AvatarDevtoolsState): void {
  state = next;
  emit();
}

export function pushAvatarDevtoolsLog(
  kind: AvatarDevtoolsLogEntry["kind"],
  summary: string,
  data?: unknown,
): void {
  const entry: AvatarDevtoolsLogEntry = {
    id: nextLogId++,
    ts: Date.now(),
    kind,
    summary,
    data,
  };
  const logs = [...state.logs, entry].slice(-MAX_LOGS);
  setState({ ...state, logs });
}

export function publishAvatarRuntimeSnapshot(snapshot: AvatarRuntimeSnapshot): void {
  state = { ...state, snapshot };
  emit();
}

export function getAvatarDevtoolsState(): AvatarDevtoolsState {
  return state;
}

export function clearAvatarDevtoolsLogs(): void {
  setState({ ...state, logs: [] });
}

export function useAvatarDevtoolsState(): AvatarDevtoolsState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}
