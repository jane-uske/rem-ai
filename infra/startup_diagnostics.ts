import fs from "fs";

import { createLogger } from "./logger";

const logger = createLogger("startup");

type DiagnosticLevel = "info" | "warn";

function emit(level: DiagnosticLevel, message: string, data?: Record<string, unknown>): void {
  if (level === "warn") {
    logger.warn(message, data);
    return;
  }
  logger.info(message, data);
}

function filePresence(pathValue: string | undefined): "missing" | "exists" | "not_found" {
  if (!pathValue?.trim()) return "missing";
  return fs.existsSync(pathValue) ? "exists" : "not_found";
}

export function logStartupDiagnostics(): void {
  const llmConfigured = Boolean(
    process.env.key?.trim() &&
      process.env.base_url?.trim() &&
      process.env.model?.trim(),
  );
  emit("info", "[Startup] Runtime summary", {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: process.env.PORT ?? 3000,
    llmConfigured,
    sttProvider: process.env.stt_provider || "openai",
    ttsProvider: process.env.tts_provider || "edge",
    dbConfigured: Boolean(process.env.DATABASE_URL?.trim()),
    redisConfigured: Boolean(process.env.REDIS_URL?.trim()),
  });

  const whisperModelPath = process.env.whisper_model;
  const whisperModelStatus = filePresence(whisperModelPath);
  if ((process.env.stt_provider || "openai").toLowerCase() === "whisper-cpp") {
    emit(
      whisperModelStatus === "exists" ? "info" : "warn",
      "[Startup] whisper.cpp model check",
      {
        path: whisperModelPath ?? null,
        status: whisperModelStatus,
      },
    );
  }

  const piperModelPath = process.env.piper_model;
  const piperModelStatus = filePresence(piperModelPath);
  if ((process.env.tts_provider || "edge").toLowerCase() === "piper") {
    emit(
      piperModelStatus === "exists" ? "info" : "warn",
      "[Startup] Piper model check",
      {
        path: piperModelPath ?? null,
        status: piperModelStatus,
      },
    );
  }

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (wsUrl && !/^(ws|wss):\/\//i.test(wsUrl)) {
    emit("warn", "[Startup] NEXT_PUBLIC_WS_URL should include ws:// or wss://", {
      value: wsUrl,
    });
  }
}
