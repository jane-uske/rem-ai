export type {
  ActionCommand,
  AvatarFrame,
  Emotion,
  FaceParams,
  LipSyncFrame,
  Viseme,
} from "./types";

export {
  createTransition,
  DEFAULT_FACE,
  EMOTION_FACE_MAP,
  getEmotionFace,
  interpolateFace,
} from "./emotion_mapper";

export {
  ACTION_TRIGGERS,
  detectAction,
  detectActions,
  type TriggerRule,
} from "./action_triggers";

export { AvatarController } from "./avatar_controller";

export type {
  AvatarCommand,
  Emotion as AvatarEmotion,
  Motion,
  RemState,
} from "./command_types";

export {
  EMOTIONS,
  MOTIONS,
  REM_STATES,
  isEmotion,
  isMotion,
  isRemState,
} from "./command_types";
