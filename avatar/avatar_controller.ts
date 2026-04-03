import { createTransition, getEmotionFace } from "./emotion_mapper";
import { detectActions } from "./action_triggers";
import type { ActionCommand, AvatarFrame, Emotion, FaceParams } from "./types";

const DEFAULT_EMOTION_TRANSITION_MS = 450;

export class AvatarController {
  private currentEmotion: Emotion = "neutral";
  private currentFace: FaceParams = getEmotionFace("neutral");

  setEmotion(emotion: Emotion): AvatarFrame[] {
    if (emotion === this.currentEmotion) {
      return [];
    }
    const frames = createTransition(
      this.currentEmotion,
      emotion,
      DEFAULT_EMOTION_TRANSITION_MS
    );
    this.currentEmotion = emotion;
    this.currentFace = getEmotionFace(emotion);
    return frames;
  }

  processReply(text: string): AvatarFrame[] {
    const actions = detectActions(text);
    return actions.map((action: ActionCommand) => ({ action }));
  }

  getFrame(): AvatarFrame {
    return {
      emotion: this.currentEmotion,
      face: this.currentFace,
    };
  }
}
