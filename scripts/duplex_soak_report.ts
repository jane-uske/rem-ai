import fs from "fs";
import path from "path";

const {
  loadSoakSessionHarness,
  emitDuplexStart,
  emitDuplexStop,
  emitFrames,
  waitFor,
} = require("../test/helpers/soak_session_harness");
const {
  makeBroadbandNoiseFrame,
  makeSilenceFrame,
  makeSineFrame,
  makeSparseClickFrame,
  repeatFrames,
} = require("../test/helpers/pcm");

type MetricName =
  | "speech_end_to_stt_final"
  | "stt_final_to_llm_first"
  | "llm_first_to_tts_first"
  | "tts_first_to_playback";

type MetricSummary = {
  count: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

type BehaviorAnomalies = {
  unexpected_interrupt_count: number;
  noise_promoted_to_assistant_count: number;
  missing_stt_final_count: number;
  duplicate_stt_final_count: number;
  duplicate_assistant_entering_count: number;
  missing_chat_end_count: number;
  stuck_turn_state_count: number;
};

type BehaviorScenarioSummary = {
  name: string;
  loops: number;
  passCount: number;
  failureCount: number;
  anomalies: BehaviorAnomalies;
  messageTypeHistogram: Record<string, number>;
  turnStateHistogram: Record<string, number>;
};

type LatencyTraceRecord = {
  generationId: number | null;
  source: string | null;
  metrics: Record<string, number | null>;
};

type LatencyScenarioSummary = {
  name: string;
  loops: number;
  traceCount: number;
  metricSummaries: Record<MetricName, MetricSummary>;
};

type FailureRecord = {
  category: "behavior" | "latency";
  scenario: string;
  loop: number;
  reason: string;
  details?: Record<string, unknown>;
};

type WarningRecord = {
  scenario: string;
  metric: MetricName;
  baselineP95: number;
  scenarioP95: number;
  driftPct: number;
};

type SoakRunConfig = {
  behaviorLoops: number;
  latencyLoops: number;
  seed: number;
  outputDir: string;
  generatedAt: string;
};

type SoakReport = {
  runConfig: SoakRunConfig;
  behaviorSummary: {
    totals: BehaviorAnomalies;
    scenarios: BehaviorScenarioSummary[];
  };
  latencySummary: {
    scenarios: LatencyScenarioSummary[];
    warnings: WarningRecord[];
  };
  failures: FailureRecord[];
  recommendedAction: {
    status: "healthy" | "investigate";
    topSignals: string[];
  };
};

type ParsedArgs = {
  behaviorLoops: number;
  latencyLoops: number;
  seed: number;
  outputDir: string;
};

type BehaviorRunResult = {
  messageTypes: string[];
  turnStates: string[];
};

const METRIC_NAMES: MetricName[] = [
  "speech_end_to_stt_final",
  "stt_final_to_llm_first",
  "llm_first_to_tts_first",
  "tts_first_to_playback",
];

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    behaviorLoops: 100,
    latencyLoops: 50,
    seed: 20260409,
    outputDir: path.resolve(process.cwd(), "artifacts/soak"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--behavior-loops":
        args.behaviorLoops = parsePositiveInt(next, args.behaviorLoops);
        i += 1;
        break;
      case "--latency-loops":
        args.latencyLoops = parsePositiveInt(next, args.latencyLoops);
        i += 1;
        break;
      case "--seed":
        args.seed = parsePositiveInt(next, args.seed);
        i += 1;
        break;
      case "--output-dir":
        if (next?.trim()) {
          args.outputDir = path.resolve(process.cwd(), next.trim());
          i += 1;
        }
        break;
      default:
        break;
    }
  }

  return args;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampSlug(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function normalizeMessages(ws: any) {
  const parsed = ws.parsedMessages();
  const messageTypes = parsed
    .map((msg: any) => (msg && typeof msg === "object" ? msg.type : null))
    .filter(Boolean);
  const turnStates = parsed
    .filter((msg: any) => msg && typeof msg === "object" && msg.type === "turn_state")
    .map((msg: any) => msg.state);
  return { parsed, messageTypes, turnStates };
}

function emptyAnomalies(): BehaviorAnomalies {
  return {
    unexpected_interrupt_count: 0,
    noise_promoted_to_assistant_count: 0,
    missing_stt_final_count: 0,
    duplicate_stt_final_count: 0,
    duplicate_assistant_entering_count: 0,
    missing_chat_end_count: 0,
    stuck_turn_state_count: 0,
  };
}

function addHistogram(target: Record<string, number>, values: string[]): void {
  for (const value of values) {
    target[value] = (target[value] ?? 0) + 1;
  }
}

function countOccurrences<T>(values: T[], target: T): number {
  return values.filter((value) => value === target).length;
}

async function runBehaviorScenario(def: {
  name: string;
  transcript: string;
  frames: Buffer[];
  mode: "noise" | "speech";
}): Promise<BehaviorRunResult> {
  const harness = loadSoakSessionHarness({
    transcript: def.transcript,
  });
  try {
    emitDuplexStart(harness.ws);
    emitFrames(harness.ws, def.frames);
    emitDuplexStop(harness.ws);

    if (def.mode === "noise") {
      await sleep(140);
    } else {
      try {
        await waitFor(() => {
          const { messageTypes, turnStates } = normalizeMessages(harness.ws);
          return (
            messageTypes.includes("stt_final") &&
            messageTypes.includes("chat_end") &&
            turnStates.includes("assistant_speaking")
          );
        }, 1200);
      } catch {
        await sleep(80);
      }
    }

    const { messageTypes, turnStates } = normalizeMessages(harness.ws);
    return { messageTypes, turnStates };
  } finally {
    harness.restore();
  }
}

function createInterruptChatStream() {
  return async function* interruptChatStream(
    _ctx: any,
    message: string,
    _emotion: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (message === "先开一轮") {
      yield "我";
      while (!signal?.aborted) {
        await sleep(10);
      }
      return;
    }
    if (signal?.aborted) return;
    yield "新的回复已经接上了。";
  };
}

async function runLatencyVoiceRoundtrip(): Promise<LatencyTraceRecord[]> {
  const harness = loadSoakSessionHarness({
    transcript: "你好，我在这里。",
  });
  try {
    const frames = [
      ...repeatFrames(makeSineFrame(0.18), 14),
      ...repeatFrames(makeBroadbandNoiseFrame(0.05, 320, 11), 2),
      ...repeatFrames(makeSineFrame(0.18), 4),
    ];
    emitDuplexStart(harness.ws);
    emitFrames(harness.ws, frames);
    emitDuplexStop(harness.ws);

    await waitFor(
      () =>
        harness.latencyLogs.some(
          (log: any) => log.metrics.tts_first_to_playback !== null,
        ),
      1500,
    );

    return harness.latencyLogs.map((log: any) => ({
      generationId: log.generationId,
      source: log.source,
      metrics: log.metrics,
    }));
  } finally {
    harness.restore();
  }
}

async function runLatencyTextInterruptThenNewTurn(): Promise<LatencyTraceRecord[]> {
  const chatStreamImpl = createInterruptChatStream();
  const harness = loadSoakSessionHarness({
    chatStreamImpl,
    transcript: "你好，我在这里。",
  });

  try {
    harness.ws.emitMessage(
      JSON.stringify({
        type: "chat",
        content: "先开一轮",
      }),
    );

    await waitFor(() => {
      const { parsed } = normalizeMessages(harness.ws);
      return parsed.some(
        (msg: any) => msg && msg.type === "chat_chunk" && msg.generationId === 1,
      );
    }, 1000);

    harness.ws.emitMessage(
      JSON.stringify({
        type: "chat",
        content: "现在换个问题",
      }),
    );

    await waitFor(
      () =>
        harness.latencyLogs.some(
          (log: any) =>
            log.generationId === 2 && log.metrics.tts_first_to_playback !== null,
        ),
      1500,
    );

    return harness.latencyLogs.map((log: any) => ({
      generationId: log.generationId,
      source: log.source,
      metrics: log.metrics,
    }));
  } finally {
    harness.restore();
  }
}

function metricSummary(values: number[]): MetricSummary {
  if (values.length === 0) {
    return { count: 0, min: null, p50: null, p95: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  return {
    count: sorted.length,
    min: sorted[0],
    p50: pick(0.5),
    p95: pick(0.95),
    max: sorted[sorted.length - 1],
  };
}

function aggregateLatencyScenario(
  name: string,
  loops: number,
  traces: LatencyTraceRecord[],
): LatencyScenarioSummary {
  const completeTraces = traces.filter(
    (trace) => trace.metrics.tts_first_to_playback !== null,
  );
  const metricSummaries = Object.fromEntries(
    METRIC_NAMES.map((metric) => {
      const values = completeTraces
        .map((trace) => trace.metrics[metric])
        .filter((value): value is number => typeof value === "number");
      return [metric, metricSummary(values)];
    }),
  ) as Record<MetricName, MetricSummary>;

  return {
    name,
    loops,
    traceCount: completeTraces.length,
    metricSummaries,
  };
}

export function buildSoakReport(input: {
  config: SoakRunConfig;
  behaviorScenarios: BehaviorScenarioSummary[];
  latencyScenarios: LatencyScenarioSummary[];
  failures: FailureRecord[];
}): SoakReport {
  const totals = emptyAnomalies();
  for (const scenario of input.behaviorScenarios) {
    for (const [key, value] of Object.entries(scenario.anomalies)) {
      totals[key as keyof BehaviorAnomalies] += value;
    }
  }

  const warnings: WarningRecord[] = [];
  const baseline = input.latencyScenarios.find(
    (scenario) => scenario.name === "voice_roundtrip_baseline",
  );
  if (baseline) {
    for (const scenario of input.latencyScenarios) {
      if (scenario.name === baseline.name) continue;
      for (const metric of METRIC_NAMES) {
        const baseP95 = baseline.metricSummaries[metric].p95;
        const currentP95 = scenario.metricSummaries[metric].p95;
        if (baseP95 == null || currentP95 == null || baseP95 <= 0) continue;
        const driftPct = ((currentP95 - baseP95) / baseP95) * 100;
        if (driftPct > 25) {
          warnings.push({
            scenario: scenario.name,
            metric,
            baselineP95: baseP95,
            scenarioP95: currentP95,
            driftPct: Number(driftPct.toFixed(2)),
          });
        }
      }
    }
  }

  const topSignals: string[] = [];
  if (totals.noise_promoted_to_assistant_count > 0) {
    topSignals.push("噪音场景出现 assistant_entering，说明 VAD/turn 链路存在误提升。");
  }
  if (totals.duplicate_stt_final_count > 0 || totals.duplicate_assistant_entering_count > 0) {
    topSignals.push("存在重复 stt_final / assistant_entering，说明会话状态或 gap 提交可能有竞态。");
  }
  if (warnings.length > 0) {
    topSignals.push("部分 latency p95 相对基线漂移超过 25%，需要进一步检查长会话下的性能稳定性。");
  }
  if (topSignals.length === 0) {
    topSignals.push("当前 soak 未发现严重异常，底线稳定性可接受，可继续推进下一轮体验优化。");
  }

  return {
    runConfig: input.config,
    behaviorSummary: {
      totals,
      scenarios: input.behaviorScenarios,
    },
    latencySummary: {
      scenarios: input.latencyScenarios,
      warnings,
    },
    failures: input.failures,
    recommendedAction: {
      status:
        input.failures.length > 0 ||
        totals.noise_promoted_to_assistant_count > 0 ||
        totals.duplicate_stt_final_count > 0 ||
        totals.duplicate_assistant_entering_count > 0
          ? "investigate"
          : "healthy",
      topSignals,
    },
  };
}

export function renderMarkdownReport(report: SoakReport): string {
  const behaviorLines = report.behaviorSummary.scenarios.map((scenario) => {
    return [
      `- ${scenario.name}: loops=${scenario.loops}, pass=${scenario.passCount}, fail=${scenario.failureCount}`,
      `  anomalies=${JSON.stringify(scenario.anomalies)}`,
    ].join("\n");
  });

  const latencyLines = report.latencySummary.scenarios.map((scenario) => {
    const metrics = METRIC_NAMES.map((metric) => {
      const summary = scenario.metricSummaries[metric];
      return `${metric}: count=${summary.count}, min=${summary.min}, p50=${summary.p50}, p95=${summary.p95}, max=${summary.max}`;
    }).join(" | ");
    return `- ${scenario.name}: traces=${scenario.traceCount}\n  ${metrics}`;
  });

  const failureLines =
    report.failures.length > 0
      ? report.failures.map(
          (failure) =>
            `- [${failure.category}] ${failure.scenario}#${failure.loop}: ${failure.reason}`,
        )
      : ["- none"];

  const warningLines =
    report.latencySummary.warnings.length > 0
      ? report.latencySummary.warnings.map(
          (warning) =>
            `- ${warning.scenario} ${warning.metric}: baseline p95=${warning.baselineP95}, scenario p95=${warning.scenarioP95}, drift=${warning.driftPct}%`,
        )
      : ["- none"];

  return [
    "# 1. Run Config",
    "",
    `- behavior_loops: ${report.runConfig.behaviorLoops}`,
    `- latency_loops: ${report.runConfig.latencyLoops}`,
    `- seed: ${report.runConfig.seed}`,
    `- generated_at: ${report.runConfig.generatedAt}`,
    "",
    "# 2. Behavior Summary",
    "",
    ...behaviorLines,
    "",
    "# 3. Latency Summary",
    "",
    ...latencyLines,
    "",
    "Warnings:",
    ...warningLines,
    "",
    "# 4. Failures / Anomalies",
    "",
    ...failureLines,
    "",
    "# 5. Recommended Action",
    "",
    `- status: ${report.recommendedAction.status}`,
    ...report.recommendedAction.topSignals.map((signal) => `- ${signal}`),
    "",
  ].join("\n");
}

async function runBehaviorLoops(
  loops: number,
  seed: number,
): Promise<{ scenarios: BehaviorScenarioSummary[]; failures: FailureRecord[] }> {
  const scenarioDefs = [
    {
      name: "sparseClickNoise",
      transcript: "词曲 李宗盛",
      frames: Array.from({ length: 12 }, () => makeSparseClickFrame()),
      mode: "noise" as const,
    },
    {
      name: "strictNoPreviewNoise",
      transcript: "词曲 李宗盛",
      frames: [
        ...Array.from({ length: 3 }, () => makeSineFrame(0.08)),
        ...Array.from({ length: 12 }, () => makeSineFrame(0.028)),
      ],
      mode: "noise" as const,
    },
    {
      name: "fallbackLongHumNoise",
      transcript: "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
      frames: Array.from({ length: 140 }, () => makeSineFrame(0.03)),
      mode: "noise" as const,
    },
    {
      name: "humanSpeech",
      transcript: "你好，我在这里。",
      frames: [
        ...repeatFrames(makeSineFrame(0.18), 14),
        ...repeatFrames(makeBroadbandNoiseFrame(0.05, 320, 11), 2),
        ...repeatFrames(makeSineFrame(0.18), 4),
      ],
      mode: "speech" as const,
    },
    {
      name: "speechWithShortInternalSilence",
      transcript: "我中间停一下再继续。",
      frames: [
        ...repeatFrames(makeSineFrame(0.18), 6),
        ...repeatFrames(makeSilenceFrame(), 6),
        ...repeatFrames(makeSineFrame(0.18), 6),
      ],
      mode: "speech" as const,
    },
    {
      name: "speechResumeBeforeGapCommit",
      transcript: "我停一下然后接着说完。",
      frames: [
        ...repeatFrames(makeSineFrame(0.18), 6),
        ...repeatFrames(makeSilenceFrame(), 12),
        ...repeatFrames(makeSineFrame(0.18), 6),
      ],
      mode: "speech" as const,
    },
  ];

  const scenarioMap = new Map<string, BehaviorScenarioSummary>();
  for (const def of scenarioDefs) {
    scenarioMap.set(def.name, {
      name: def.name,
      loops,
      passCount: 0,
      failureCount: 0,
      anomalies: emptyAnomalies(),
      messageTypeHistogram: {},
      turnStateHistogram: {},
    });
  }

  const failures: FailureRecord[] = [];
  const rng = mulberry32(seed);

  for (let loop = 0; loop < loops; loop += 1) {
    for (const def of shuffle(scenarioDefs, rng)) {
      const summary = scenarioMap.get(def.name)!;
      try {
        const result = await runBehaviorScenario(def);
        const sttFinalCount = countOccurrences(result.messageTypes, "stt_final");
        const chatEndCount = countOccurrences(result.messageTypes, "chat_end");
        const interruptCount = countOccurrences(result.messageTypes, "interrupt");
        const assistantEnteringCount = countOccurrences(
          result.turnStates,
          "assistant_entering",
        );
        const finalTurnState = result.turnStates[result.turnStates.length - 1] ?? "none";

        addHistogram(summary.messageTypeHistogram, result.messageTypes);
        addHistogram(summary.turnStateHistogram, result.turnStates);

        if (interruptCount > 0) {
          summary.anomalies.unexpected_interrupt_count += interruptCount;
          failures.push({
            category: "behavior",
            scenario: def.name,
            loop,
            reason: "unexpected interrupt emitted during soak",
            details: { interruptCount },
          });
        }

        if (def.mode === "noise") {
          if (assistantEnteringCount > 0) {
            summary.anomalies.noise_promoted_to_assistant_count += assistantEnteringCount;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "noise promoted to assistant_entering",
              details: { assistantEnteringCount },
            });
          }
          if (sttFinalCount > 0) {
            summary.anomalies.duplicate_stt_final_count += sttFinalCount;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "noise emitted stt_final",
              details: { sttFinalCount },
            });
          }
          if (
            finalTurnState === "listening_active" ||
            finalTurnState === "listening_hold" ||
            finalTurnState === "likely_end" ||
            finalTurnState === "assistant_entering" ||
            finalTurnState === "assistant_speaking"
          ) {
            summary.anomalies.stuck_turn_state_count += 1;
          }
        } else {
          if (sttFinalCount === 0) {
            summary.anomalies.missing_stt_final_count += 1;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "speech scenario missing stt_final",
            });
          }
          if (sttFinalCount > 1) {
            summary.anomalies.duplicate_stt_final_count += sttFinalCount - 1;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "duplicate stt_final detected",
              details: { sttFinalCount },
            });
          }
          if (assistantEnteringCount > 1) {
            summary.anomalies.duplicate_assistant_entering_count += assistantEnteringCount - 1;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "duplicate assistant_entering detected",
              details: { assistantEnteringCount },
            });
          }
          if (chatEndCount === 0) {
            summary.anomalies.missing_chat_end_count += 1;
            failures.push({
              category: "behavior",
              scenario: def.name,
              loop,
              reason: "response scenario missing chat_end",
            });
          }
          if (
            finalTurnState === "listening_active" ||
            finalTurnState === "listening_hold" ||
            finalTurnState === "likely_end" ||
            finalTurnState === "assistant_entering"
          ) {
            summary.anomalies.stuck_turn_state_count += 1;
          }
        }

        summary.passCount += 1;
      } catch (err) {
        summary.failureCount += 1;
        failures.push({
          category: "behavior",
          scenario: def.name,
          loop,
          reason: (err as Error).message,
        });
      }
    }
  }

  return {
    scenarios: scenarioDefs.map((def) => scenarioMap.get(def.name)!),
    failures,
  };
}

async function runLatencyLoops(
  loops: number,
): Promise<{ scenarios: LatencyScenarioSummary[]; failures: FailureRecord[] }> {
  const latencyDefs = [
    {
      name: "voice_roundtrip_baseline",
      run: runLatencyVoiceRoundtrip,
    },
    {
      name: "text_interrupt_then_new_turn",
      run: runLatencyTextInterruptThenNewTurn,
    },
  ];

  const aggregated = new Map<string, LatencyTraceRecord[]>();
  const failures: FailureRecord[] = [];
  for (const def of latencyDefs) {
    aggregated.set(def.name, []);
  }

  for (let loop = 0; loop < loops; loop += 1) {
    for (const def of latencyDefs) {
      try {
        const traces = await def.run();
        aggregated.get(def.name)!.push(...traces);

        if (def.name === "text_interrupt_then_new_turn") {
          const hasCompleteNewTurn = traces.some(
            (trace) =>
              trace.generationId === 2 && trace.metrics.tts_first_to_playback !== null,
          );
          if (!hasCompleteNewTurn) {
            failures.push({
              category: "latency",
              scenario: def.name,
              loop,
              reason: "new generation did not produce a complete playback trace",
            });
          }
        }
      } catch (err) {
        failures.push({
          category: "latency",
          scenario: def.name,
          loop,
          reason: (err as Error).message,
        });
      }
    }
  }

  return {
    scenarios: latencyDefs.map((def) =>
      aggregateLatencyScenario(def.name, loops, aggregated.get(def.name)!),
    ),
    failures,
  };
}

async function writeReportFiles(report: SoakReport, outputDir: string): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  const base = `duplex_soak_${timestampSlug()}`;
  const jsonPath = path.join(outputDir, `${base}.json`);
  const mdPath = path.join(outputDir, `${base}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, renderMarkdownReport(report), "utf8");
  console.log(`SOAK_REPORT_JSON ${jsonPath}`);
  console.log(`SOAK_REPORT_MD ${mdPath}`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const config: SoakRunConfig = {
    behaviorLoops: args.behaviorLoops,
    latencyLoops: args.latencyLoops,
    seed: args.seed,
    outputDir: args.outputDir,
    generatedAt: new Date().toISOString(),
  };

  const behavior = await runBehaviorLoops(args.behaviorLoops, args.seed);
  const latency = await runLatencyLoops(args.latencyLoops);
  const report = buildSoakReport({
    config,
    behaviorScenarios: behavior.scenarios,
    latencyScenarios: latency.scenarios,
    failures: [...behavior.failures, ...latency.failures],
  });

  await writeReportFiles(report, args.outputDir);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
