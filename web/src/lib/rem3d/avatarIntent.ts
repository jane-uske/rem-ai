import type {
  AvatarActionCommand,
  AvatarFaceOverlay,
  AvatarIntent,
  AvatarIntentFacialAccent,
  AvatarIntentGesture,
  AvatarIntentSource,
} from "@/types/avatar";

function clampBand(value: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0.75) return 0;
  if (value <= 1.5) return 1;
  if (value <= 2.35) return 2;
  return 3;
}

function clampHoldMs(value: number): number {
  if (!Number.isFinite(value)) return 700;
  return Math.max(180, Math.min(2400, Math.round(value)));
}

function emotionToAccent(
  emotion: AvatarIntent["emotion"],
  face?: AvatarFaceOverlay | null,
): AvatarIntentFacialAccent {
  const browDown = Math.max(face?.browDownL ?? 0, face?.browDownR ?? 0);
  const browUp = Math.max(face?.browUpL ?? 0, face?.browUpR ?? 0);
  const mouthSmile = face?.mouthSmile ?? 0;
  const mouthFrown = face?.mouthFrown ?? 0;

  if (browDown >= 0.35 || mouthFrown >= 0.45 || emotion === "sad") {
    return "brow_furrow";
  }
  if (browUp >= 0.38) {
    return "brow_raise";
  }
  if (mouthSmile >= 0.42 || emotion === "happy") {
    return "soft_smile";
  }
  if (mouthFrown >= 0.22) {
    return "sad_mouth";
  }
  return "none";
}

function mapActionToGesture(action?: AvatarActionCommand | null): AvatarIntentGesture {
  switch (action?.action) {
    case "nod":
    case "shake_head":
    case "wave":
    case "tilt_head":
    case "shrug":
      return action.action;
    case "eyebrow_raise":
      return "none";
    default:
      return "none";
  }
}

export function deriveAvatarIntent(input: {
  emotion: string;
  action?: AvatarActionCommand | null;
  face?: AvatarFaceOverlay | null;
  source?: AvatarIntentSource;
  reason?: string;
}): AvatarIntent {
  const emotion =
    input.emotion === "happy" ||
    input.emotion === "curious" ||
    input.emotion === "shy" ||
    input.emotion === "sad"
      ? input.emotion
      : "neutral";

  const actionGesture = mapActionToGesture(input.action);
  let gesture: AvatarIntentGesture = actionGesture;

  if (gesture === "none") {
    if (emotion === "happy") {
      gesture = "happy_hop";
    } else if (emotion === "sad" || emotion === "shy") {
      gesture = "shrink_in";
    } else if (emotion === "curious") {
      gesture = "lean_in";
    }
  }

  const facialAccent =
    input.action?.action === "eyebrow_raise"
      ? "brow_raise"
      : emotionToAccent(emotion, input.face);

  let energy: 0 | 1 | 2 | 3 = 1;
  if (emotion === "happy") energy = 3;
  else if (emotion === "curious") energy = 2;
  else if (emotion === "neutral") energy = 1;
  else energy = 0;

  const gestureIntensity = clampBand(
    input.action?.intensity ??
      (gesture === "happy_hop" ? 2.8
      : gesture === "shrink_in" ? 1.8
      : gesture === "lean_in" ? 1.4
      : 0),
  );

  return {
    emotion,
    gesture,
    gestureIntensity,
    facialAccent,
    energy,
    holdMs: clampHoldMs(input.action?.duration ?? (gesture === "happy_hop" ? 820 : 700)),
    source: input.source ?? "rule",
    reason: input.reason,
  };
}
