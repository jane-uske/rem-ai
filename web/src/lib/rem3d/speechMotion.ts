import { VRMExpressionPresetName } from "@pixiv/three-vrm";
import type { RemState } from "@/types/avatar";
import type { VrmExpressionWeights } from "./emotionToVrm";

export interface SpeechMotionInput {
  delta: number;
  elapsed: number;
  emotion: string;
  remState: RemState;
  lipEnvelope: number;
  voiceActive: boolean;
}

export interface SpeechMotionFrame {
  expressions: VrmExpressionWeights;
  speakingAmount: number;
  chestPitch: number;
  chestYaw: number;
  chestRoll: number;
  neckPitch: number;
  neckYaw: number;
  neckRoll: number;
}

const MIN_BLINK_INTERVAL = 2.4;
const MAX_BLINK_INTERVAL = 5.2;
const SPEECH_HOLD_SECONDS = 0.12;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smooth(current: number, target: number, speed: number, delta: number): number {
  const alpha = 1 - Math.exp(-speed * delta);
  return current + (target - current) * alpha;
}

function pickBlinkInterval(isSpeaking: boolean): number {
  const base = MIN_BLINK_INTERVAL + Math.random() * (MAX_BLINK_INTERVAL - MIN_BLINK_INTERVAL);
  return isSpeaking ? base * 1.1 : base;
}

export class SpeechMotionController {
  private speakingAmount = 0;
  private mouthOpen = 0;
  private mouthRound = 0;
  private speakingHold = 0;
  private blinkTimer = pickBlinkInterval(false);
  private blinkPhase = 0;
  private gazeX = 0;
  private gazeY = 0;
  private gazeTargetX = 0;
  private gazeTargetY = 0;
  private gazeRetargetIn = 0.9;

  reset(): void {
    this.speakingAmount = 0;
    this.mouthOpen = 0;
    this.mouthRound = 0;
    this.speakingHold = 0;
    this.blinkTimer = pickBlinkInterval(false);
    this.blinkPhase = 0;
    this.gazeX = 0;
    this.gazeY = 0;
    this.gazeTargetX = 0;
    this.gazeTargetY = 0;
    this.gazeRetargetIn = 0.9;
  }

  update(input: SpeechMotionInput): SpeechMotionFrame {
    const delta = Math.max(1 / 240, Math.min(input.delta || 0, 0.1));
    const emotion = String(input.emotion || "neutral").toLowerCase();
    const lip = clamp01(input.lipEnvelope);
    const activeSpeech = input.voiceActive || lip > 0.045;

    if (activeSpeech) {
      this.speakingHold = SPEECH_HOLD_SECONDS;
    } else {
      this.speakingHold = Math.max(0, this.speakingHold - delta);
    }

    const fallbackChatter =
      input.voiceActive && lip < 0.05
        ? 0.22 + 0.08 * (0.5 + 0.5 * Math.sin(input.elapsed * 15.2))
        : 0;
    const targetSpeech = Math.max(lip, fallbackChatter, this.speakingHold > 0 ? 0.08 : 0);
    const speechSpeed = targetSpeech > this.speakingAmount ? 15 : 10.5;
    this.speakingAmount = smooth(this.speakingAmount, targetSpeech, speechSpeed, delta);

    const talkPulse = 0.5 + 0.5 * Math.sin(input.elapsed * 18.5);
    const mouthTarget = clamp01(
      this.speakingAmount * 1.08 + talkPulse * this.speakingAmount * 0.08,
    );
    this.mouthOpen = smooth(
      this.mouthOpen,
      mouthTarget,
      mouthTarget > this.mouthOpen ? 22 : 12,
      delta,
    );
    this.mouthRound = smooth(
      this.mouthRound,
      clamp01(this.mouthOpen * (0.16 + 0.08 * Math.sin(input.elapsed * 7.6 + 1.4))),
      10,
      delta,
    );

    this.updateBlink(delta, input.voiceActive || this.speakingAmount > 0.12);
    this.updateGaze(delta, emotion, input.voiceActive);

    const blink = this.blinkValue();
    const speaking = this.speakingAmount;
    const thinking = input.remState === "thinking" ? 1 : 0;
    const listening = input.remState === "listening" ? 1 : 0;

    const speechBob = Math.sin(input.elapsed * 5.4) * speaking;
    const microSway = Math.sin(input.elapsed * 0.9) * 0.5 + Math.sin(input.elapsed * 1.7 + 1.2) * 0.5;

    const emotionPitchBias =
      emotion === "sad" ? 0.02
      : emotion === "curious" ? -0.022
      : emotion === "shy" ? 0.014
      : 0;
    const emotionRollBias =
      emotion === "happy" ? 0.016
      : emotion === "shy" ? -0.018
      : 0;

    const expressions: VrmExpressionWeights = {
      [VRMExpressionPresetName.Aa]: clamp01(this.mouthOpen),
      [VRMExpressionPresetName.Oh]: clamp01(this.mouthRound),
      [VRMExpressionPresetName.Blink]: blink,
    };

    if (this.gazeX > 0.02) {
      expressions[VRMExpressionPresetName.LookRight] = this.gazeX;
    } else if (this.gazeX < -0.02) {
      expressions[VRMExpressionPresetName.LookLeft] = -this.gazeX;
    }
    if (this.gazeY > 0.02) {
      expressions[VRMExpressionPresetName.LookUp] = this.gazeY;
    } else if (this.gazeY < -0.02) {
      expressions[VRMExpressionPresetName.LookDown] = -this.gazeY;
    }
    if (speaking > 0.08) {
      expressions[VRMExpressionPresetName.Relaxed] = 0.06 + speaking * 0.1;
    }
    if (emotion === "curious" && speaking > 0.1) {
      expressions[VRMExpressionPresetName.Surprised] = 0.04 + speaking * 0.06;
    }

    return {
      expressions,
      speakingAmount: speaking,
      chestPitch: 0.012 * speechBob + 0.018 * thinking,
      chestYaw: 0.012 * microSway + 0.01 * speaking * Math.sin(input.elapsed * 2.7),
      chestRoll: emotionRollBias * (0.45 + speaking * 0.55),
      neckPitch:
        emotionPitchBias +
        0.01 * speechBob +
        0.02 * listening +
        0.01 * Math.sin(input.elapsed * 1.3 + 0.6),
      neckYaw:
        this.gazeX * 0.08 +
        0.02 * speaking * Math.sin(input.elapsed * 3.1 + 0.4),
      neckRoll:
        emotionRollBias +
        this.gazeX * 0.03 +
        0.01 * Math.sin(input.elapsed * 1.9 + 2.1),
    };
  }

  private updateBlink(delta: number, speaking: boolean): void {
    if (this.blinkPhase > 0) {
      this.blinkPhase = Math.max(0, this.blinkPhase - delta / 0.18);
      if (this.blinkPhase === 0) {
        this.blinkTimer = pickBlinkInterval(speaking);
      }
      return;
    }

    this.blinkTimer -= delta;
    if (this.blinkTimer <= 0) {
      this.blinkPhase = 1;
      return;
    }
  }

  private blinkValue(): number {
    if (this.blinkPhase <= 0) return 0;
    const x = 1 - this.blinkPhase;
    if (x < 0.35) return clamp01(x / 0.35);
    return clamp01((1 - x) / 0.65);
  }

  private updateGaze(delta: number, emotion: string, voiceActive: boolean): void {
    this.gazeRetargetIn -= delta;
    if (this.gazeRetargetIn <= 0) {
      const rangeX = voiceActive ? 0.1 : 0.16;
      const rangeY = voiceActive ? 0.06 : 0.11;
      const biasY =
        emotion === "curious" ? 0.035
        : emotion === "shy" || emotion === "sad" ? -0.04
        : 0;
      this.gazeTargetX = (Math.random() * 2 - 1) * rangeX;
      this.gazeTargetY = clamp01((Math.random() * 2 - 1) * rangeY + 0.5) - 0.5 + biasY;
      this.gazeRetargetIn = 1.1 + Math.random() * 1.8;
    }

    this.gazeX = smooth(this.gazeX, this.gazeTargetX, 3.4, delta);
    this.gazeY = smooth(this.gazeY, this.gazeTargetY, 3.1, delta);
  }
}
