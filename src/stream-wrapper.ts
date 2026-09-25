import net from "node:net";
import { randomUUID } from "node:crypto";
import type stream from "node:stream";
import { Duplex, PassThrough, Readable } from "node:stream";

export class NamedPipeStream {
  private _socketPath: string;
  private _url: string;
  private _server: net.Server;

  constructor(stream: stream.Stream, onSocket?: (sock: net.Socket) => unknown) {
    const id = randomUUID();
    this._url = this._socketPath = `\\\\.\\pipe\\${id}.sock`;

    this._server = net.createServer(onSocket);
    stream.on("close", () => {
      this._server.close();
    });
    this._server.listen(this._socketPath);
  }

  get url(): string {
    return this._url;
  }

  close(): void {
    this._server.close();
  }
}

/**
 * One extra file descriptor passed to the ffmpeg child process
 * (macOS/Linux). The child sees it as `pipe:N`. The held Node stream is
 * placed directly in the child stdio array as `[stream, "pipe"]`, so the
 * spawner owns all piping: OS pipes apply backpressure naturally and there
 * is no per-connection setup or buffer tuning.
 *
 * Instances are created synchronously by `StreamInput`/`StreamOutput`, then
 * `claim()` assigns the child fd number in stdio order when building the
 * spawn arguments.
 */
export class FdStream {
  private _fd: number = -1;
  private _url: string = "";

  /** Node stream placed directly in the child stdio array. */
  readonly stdioStream: stream.Readable | stream.Writable;

  /**
   * Which side of the child pipe this is. Records the factory intent so the
   * stdio entry can be typed per-direction (the spawner infers direction
   * from the value at runtime; no behavior branches on this).
   */
  readonly direction: "input" | "output";

  constructor(
    stream: stream.Readable | stream.Writable,
    direction: "input" | "output",
  ) {
    this.stdioStream = stream;
    this.direction = direction;
  }

  get fd(): number {
    return this._fd;
  }

  get url(): string {
    return this._url;
  }

  claim(fd: number): string {
    if (this._fd !== -1) {
      throw new Error("FdStream already claimed");
    }
    this._fd = fd;
    this._url = `pipe:${fd}`;
    return this._url;
  }

  close(): void {
    // Nothing to release: the spawner owns the stdio pipes and tears them
    // down when the child exits. Kept for interface parity with
    // NamedPipeStream so both can be closed uniformly.
  }
}

function StreamInput(stream: stream.Readable): NamedPipeStream | FdStream {
  if (process.platform === "win32") {
    return new NamedPipeStream(stream, (sock) => {
      sock.on("error", () => {});
      stream.pipe(sock);
    });
  }
  // The spawner infers extra-fd direction from the value: a Duplex is
  // ambiguous and defaults to "output", which would hang an input. Bridge
  // Duplex inputs to a pure Readable so the direction is unambiguous.
  if (stream instanceof Duplex) {
    return new FdStream(Readable.from(stream), "input");
  }
  return new FdStream(stream, "input");
}

function StreamOutput(
  stream: stream.Writable,
  pipeArgs?: Parameters<stream.Writable["pipe"]>[1],
): NamedPipeStream | FdStream {
  if (process.platform === "win32") {
    return new NamedPipeStream(stream, (sock) => {
      sock.on("error", () => {});
      sock.pipe(stream, pipeArgs);
    });
  }
  // The spawner pipes without options, so honor pipeArgs (e.g. { end: false })
  // through a bridge. The bridge itself is direction-unambiguous ("output").
  if (pipeArgs) {
    const bridge = new PassThrough();
    bridge.pipe(stream, pipeArgs);
    return new FdStream(bridge, "output");
  }
  return new FdStream(stream, "output");
}

export { StreamInput, StreamOutput };
