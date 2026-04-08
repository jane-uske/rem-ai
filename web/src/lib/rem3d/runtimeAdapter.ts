import type { VrmViewerState } from "./vrmViewer";
import { RemVrmViewer } from "./vrmViewer";
import type {
  AvatarActionCommand,
  AvatarEngine,
  AvatarModelPreset,
  LipSignal,
  RemState,
} from "@/types/avatar";

export interface CreateAvatarRuntimeOptions {
  engine?: AvatarEngine;
  modelPreset?: AvatarModelPreset;
  modelUrl?: string;
  onStateChange?: (state: VrmViewerState, error?: string) => void;
}

export interface AvatarRuntimeAdapter {
  load(): void;
  dispose(): void;
  resize(): void;
  setEmotion(emotion: string): void;
  setState(state: RemState): void;
  playAction(action: AvatarActionCommand): void;
  setLipSignal(signal: LipSignal): void;
}

export function createAvatarRuntime(
  container: HTMLElement,
  options: CreateAvatarRuntimeOptions,
): AvatarRuntimeAdapter {
  let viewer: RemVrmViewer | null = null;
  let lipSignal: LipSignal = { envelope: 0, active: false };

  return {
    load() {
      viewer = new RemVrmViewer(container, {
        modelUrl: options.modelUrl,
        onStateChange: options.onStateChange,
        getLipEnvelope: () => lipSignal.envelope,
        getVoiceActive: () => lipSignal.active,
      });
      viewer.startLoop();
    },
    dispose() {
      viewer?.dispose();
      viewer = null;
    },
    resize() {
      viewer?.resize();
    },
    setEmotion(emotion: string) {
      viewer?.setEmotion(emotion);
    },
    setState(state: RemState) {
      viewer?.setState(state);
    },
    playAction(action: AvatarActionCommand) {
      viewer?.playAction(action.action, action.intensity, action.duration);
    },
    setLipSignal(signal: LipSignal) {
      lipSignal = signal;
    },
  };
}
