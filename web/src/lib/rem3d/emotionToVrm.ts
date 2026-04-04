import type { VRM } from "@pixiv/three-vrm";
import { VRMExpressionPresetName } from "@pixiv/three-vrm";

/** 与后端 `Emotion` 对齐的字符串 */
export type RemUiEmotion =
  | "neutral"
  | "happy"
  | "curious"
  | "shy"
  | "sad";

function resetExpressions(vrm: VRM): void {
  const em = vrm.expressionManager;
  if (!em) return;
  em.resetValues();
}

/**
 * 将 Rem 情绪映射到 VRM 1.0 预设表情权重（组合）。
 * 不同模型若缺少某预设，setValue 会无害跳过。
 */
export function applyEmotionToVrm(vrm: VRM, emotion: string): void {
  const em = vrm.expressionManager;
  if (!em) return;

  resetExpressions(vrm);

  const e = String(emotion || "neutral").toLowerCase() as RemUiEmotion;

  const set = (name: string, w: number) => {
    if (w <= 0) return;
    try {
      em.setValue(name, Math.min(1, w));
    } catch {
      /* 模型无该预设 */
    }
  };

  switch (e) {
    case "happy":
      set(VRMExpressionPresetName.Happy, 1);
      set(VRMExpressionPresetName.Relaxed, 0.25);
      break;
    case "curious":
      set(VRMExpressionPresetName.Surprised, 0.55);
      set(VRMExpressionPresetName.LookUp, 0.35);
      set(VRMExpressionPresetName.Relaxed, 0.2);
      break;
    case "shy":
      set(VRMExpressionPresetName.Relaxed, 0.75);
      set(VRMExpressionPresetName.LookDown, 0.35);
      set(VRMExpressionPresetName.Happy, 0.15);
      break;
    case "sad":
      set(VRMExpressionPresetName.Sad, 1);
      set(VRMExpressionPresetName.LookDown, 0.25);
      break;
    case "neutral":
    default:
      set(VRMExpressionPresetName.Neutral, 0.85);
      set(VRMExpressionPresetName.Relaxed, 0.15);
      break;
  }
}
