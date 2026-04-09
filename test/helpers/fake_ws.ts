const { EventEmitter } = require("events");
const { WebSocket } = require("ws");

class FakeWebSocket extends EventEmitter {
  sent: string[] = [];
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  binaryType = "nodebuffer";
  protocol = "";
  extensions = "";

  send(data: unknown): boolean {
    if (Buffer.isBuffer(data)) {
      this.sent.push(data.toString("utf8"));
    } else if (typeof data === "string") {
      this.sent.push(data);
    } else if (data instanceof Uint8Array) {
      this.sent.push(Buffer.from(data).toString("utf8"));
    } else {
      this.sent.push(String(data));
    }
    return true;
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }

  terminate(): void {
    this.close();
  }

  emitMessage(payload: unknown): void {
    this.emit("message", payload);
  }

  emitError(err: Error): void {
    this.emit("error", err);
  }

  parsedMessages(): any[] {
    return this.sent.map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    });
  }
}

module.exports = { FakeWebSocket };
