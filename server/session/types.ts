export interface SessionState {
  pipelineChain: Promise<void>;
  duplexActive: boolean;
  speechBuffer: Buffer[];
}
