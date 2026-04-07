import { VRMExpressionPresetName } from "@pixiv/three-vrm";
import type { AvatarFaceOverlay, LipSignal } from "@/types/avatar";
import type { LipSyncFrame } from "../../../../avatar/types";
import type { VrmExpressionWeights } from "./emotionToVrm";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function faceToExpressionWeights(face?: AvatarFaceOverlay | null): VrmExpressionWeights {
  if (!face) return {};

  const browUp = clamp01(Math.max(face.browUpL ?? 0, face.browUpR ?? 0));
  const browDown = clamp01(Math.max(face.browDownL ?? 0, face.browDownR ?? 0));
  const eyeSquint = clamp01(Math.max(face.eyeSquintL ?? 0, face.eyeSquintR ?? 0));
  const eyeClosed = clamp01(
    1 - ((face.eyeOpenL ?? 1) + (face.eyeOpenR ?? 1)) / 2,
  );
  const mouthSmile = clamp01(face.mouthSmile ?? 0);
  const mouthFrown = clamp01(face.mouthFrown ?? 0);
  const mouthOpen = clamp01(face.mouthOpen ?? 0);
  const mouthPucker = clamp01(face.mouthPucker ?? 0);
  const cheekPuff = clamp01(face.cheekPuff ?? 0);

  const weights: VrmExpressionWeights = {};

  if (browDown > 0.02) {
    weights[VRMExpressionPresetName.Angry] = browDown * 0.78;
  }
  if (browUp > 0.02) {
    weights[VRMExpressionPresetName.Surprised] = browUp * 0.72;
    weights[VRMExpressionPresetName.LookUp] = browUp * 0.22;
  }
  if (eyeClosed > 0.02) {
    weights[VRMExpressionPresetName.Blink] = eyeClosed;
  }
  if (eyeSquint > 0.02 || cheekPuff > 0.04) {
    weights[VRMExpressionPresetName.Relaxed] = Math.max(
      eyeSquint * 0.45,
      cheekPuff * 0.2,
    );
  }
  if (mouthSmile > 0.02) {
    weights[VRMExpressionPresetName.Happy] = mouthSmile * 0.78;
  }
  if (mouthFrown > 0.02) {
    weights[VRMExpressionPresetName.Sad] = mouthFrown * 0.85;
    weights[VRMExpressionPresetName.Angry] = Math.max(
      weights[VRMExpressionPresetName.Angry] ?? 0,
      mouthFrown * 0.28,
    );
  }
  if (mouthOpen > 0.02) {
    weights[VRMExpressionPresetName.Aa] = mouthOpen;
  }
  if (mouthPucker > 0.02) {
    weights[VRMExpressionPresetName.Oh] = mouthPucker;
  }

  return weights;
}

export function lipSyncToExpressionWeights(
  lipSync?: LipSyncFrame | null,
): VrmExpressionWeights {
  if (!lipSync) return {};
  const weight = clamp01(lipSync.weight);
  switch (lipSync.viseme) {
    case "aa":
    case "ih":
    case "ee":
      return { [VRMExpressionPresetName.Aa]: weight };
    case "oh":
    case "oo":
      return { [VRMExpressionPresetName.Oh]: weight };
    case "sil":
      return {};
    default:
      return { [VRMExpressionPresetName.Aa]: weight * 0.52 };
  }
}

export function visemeSignalToExpressionWeights(
  viseme?: LipSignal["viseme"] | null,
): VrmExpressionWeights {
  if (!viseme) return {};
  return lipSyncToExpressionWeights({
    time: 0,
    viseme: viseme.name,
    weight: viseme.weight,
  });
}
