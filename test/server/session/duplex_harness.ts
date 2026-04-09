const assert = require("assert").strict;
const { loadSessionHarness } = require("../../helpers/session_harness");
const {
  makeBroadbandNoiseFrame,
  makeRaudFrame,
  makeSilenceFrame,
  makeSparseClickFrame,
  makeSineFrame,
  repeatFrames,
} = require("../../helpers/pcm");

function emitDuplexStart(ws, sampleRate = 16_000) {
  ws.emitMessage(JSON.stringify({ type: "duplex_start", sampleRate }));
}

function emitDuplexStop(ws) {
  ws.emitMessage(JSON.stringify({ type: "duplex_stop" }));
}

function emitFrames(ws, frames, sampleRate = 16_000) {
  for (const frame of frames) {
    ws.emitMessage(makeRaudFrame(frame, sampleRate));
  }
}

function messageTypes(ws) {
  return ws
    .parsedMessages()
    .map((msg) => (msg && typeof msg === "object" ? msg.type : null))
    .filter(Boolean);
}

async function runNoiseScenario(name, transcript, frames) {
  const { ws, restore } = loadSessionHarness({ transcript });
  try {
    emitDuplexStart(ws);
    emitFrames(ws, frames);
    emitDuplexStop(ws);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const types = messageTypes(ws);
    const turnStates = ws
      .parsedMessages()
      .filter((msg) => msg && typeof msg === "object" && msg.type === "turn_state")
      .map((msg) => msg.state);
    assert.equal(types.includes("assistant_entering"), false, `${name}: should not enter assistant`);
    assert.equal(types.includes("stt_final"), false, `${name}: should not emit stt_final`);
    return { name, messageTypes: types, turnStates };
  } finally {
    restore();
  }
}

async function runHumanScenario(name, transcript, frames) {
  const { ws, restore } = loadSessionHarness({ transcript });
  try {
    emitDuplexStart(ws);
    emitFrames(ws, frames);
    emitDuplexStop(ws);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const types = messageTypes(ws);
    const messages = ws.parsedMessages();
    const turnStates = messages
      .filter((msg) => msg && typeof msg === "object" && msg.type === "turn_state")
      .map((msg) => msg.state);
    const sttFinals = messages.filter((msg) => msg && msg.type === "stt_final");
    const assistantEnterings = messages.filter(
      (msg) => msg && msg.type === "turn_state" && msg.state === "assistant_entering",
    );
    const sttFinal = sttFinals[0];
    const assistantEntering = assistantEnterings[0];

    assert.ok(sttFinal, `${name}: should emit stt_final`);
    assert.ok(assistantEntering, `${name}: should enter assistant`);
    assert.equal(sttFinal.content, transcript);
    assert.equal(sttFinals.length, 1, `${name}: should emit exactly one stt_final`);
    assert.equal(assistantEnterings.length, 1, `${name}: should enter assistant exactly once`);

    return { name, messageTypes: types, turnStates };
  } finally {
    restore();
  }
}

async function main() {
  const sparseClickNoise = Array.from({ length: 12 }, () => makeSparseClickFrame());
  const strictNoPreviewNoise = [
    ...Array.from({ length: 3 }, () => makeSineFrame(0.08)),
    ...Array.from({ length: 12 }, () => makeSineFrame(0.028)),
  ];
  const lowEnergyHumNoise = Array.from({ length: 140 }, () => makeSineFrame(0.03));
  const humanSpeech = [
    ...repeatFrames(makeSineFrame(0.18), 14),
    ...repeatFrames(makeBroadbandNoiseFrame(0.05, 320, 11), 2),
    ...repeatFrames(makeSineFrame(0.18), 4),
  ];
  const speechWithShortInternalSilence = [
    ...repeatFrames(makeSineFrame(0.18), 6),
    ...repeatFrames(makeSilenceFrame(), 6),
    ...repeatFrames(makeSineFrame(0.18), 6),
  ];
  const speechResumeBeforeGapCommit = [
    ...repeatFrames(makeSineFrame(0.18), 6),
    ...repeatFrames(makeSilenceFrame(), 12),
    ...repeatFrames(makeSineFrame(0.18), 6),
  ];

  const sparseNoiseResult = await runNoiseScenario("sparseClickNoise", "词曲 李宗盛", sparseClickNoise);
  const strictNoiseResult = await runNoiseScenario(
    "strictNoPreviewNoise",
    "词曲 李宗盛",
    strictNoPreviewNoise,
  );
  const lowEnergyHumResult = await runNoiseScenario(
    "fallbackLongHumNoise",
    "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
    lowEnergyHumNoise,
  );
  const humanResult = await runHumanScenario("humanSpeech", "你好，我在这里。", humanSpeech);
  const shortSilenceResult = await runHumanScenario(
    "speechWithShortInternalSilence",
    "我中间停一下再继续。",
    speechWithShortInternalSilence,
  );
  const mergeAfterPauseResult = await runHumanScenario(
    "speechResumeBeforeGapCommit",
    "我停一下然后接着说完。",
    speechResumeBeforeGapCommit,
  );

  console.log(
    `HARNESS_RESULT ${JSON.stringify({
      ok: true,
      sparseClickNoise: sparseNoiseResult,
      strictNoPreviewNoise: strictNoiseResult,
      fallbackLongHumNoise: lowEnergyHumResult,
      humanSpeech: humanResult,
      speechWithShortInternalSilence: shortSilenceResult,
      speechResumeBeforeGapCommit: mergeAfterPauseResult,
    })}`,
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
