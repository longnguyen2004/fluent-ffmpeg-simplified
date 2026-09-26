import net from "node:net";
import type stream from "node:stream";
import { configureSocket } from "./sockopt.js";

/**
 * Low socket buffer size (bytes) applied to both ends of each TCP
 * connection: `SO_SNDBUF`/`SO_RCVBUF` via `setsockopt` on the Node side,
 * and `send_buffer_size`/`recv_buffer_size` query params on the ffmpeg side.
 * Small buffers enforce backpressure instead of letting data pile up in
 * kernel buffers.
 */
export const SOCKET_BUFFER_SIZE: number = 256 * 1024;

/**
 * Pick a random loopback address. On Linux the whole 127/8 is usable
 * without setup (verified); other platforms only guarantee 127.0.0.1, so
 * they keep it. With ~16.7M candidates, clashing with another process's
 * address is exceedingly unlikely, so no collision checks are done.
 */
function randomLoopbackHost(): string {
  if (process.platform !== "linux") {
    return "127.0.0.1";
  }
  // Last 24 bits in [2, 0xFFFFFE]: skips 127.0.0.0, 127.0.0.1 and
  // 127.255.255.255.
  const n = 2 + Math.floor(Math.random() * (0xff_ff_fe - 1));
  return `127.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

/**
 * Pick a random port in the IANA dynamic range. Combined with a random
 * loopback address, the (address, port) pair effectively never collides
 * with another process's listener, so no collision checks are done.
 */
function randomLoopbackPort(): number {
  return 49152 + Math.floor(Math.random() * 16384);
}

export class NamedPipeStream {
  private _host: string;
  private _port: number;
  private _url: string;
  private _server: net.Server;

  constructor(
    stream: stream.Stream,
    onSocket?: (sock: net.Socket) => unknown,
    bufferSize: number = SOCKET_BUFFER_SIZE,
  ) {
    // Node listens; ffmpeg dials in as a TCP client so that its
    // `send_buffer_size`/`recv_buffer_size` URL options land on the actual
    // data socket (in `listen` mode ffmpeg would only tune its listen socket).
    this._host = randomLoopbackHost();
    this._port = randomLoopbackPort();
    this._url =
      `tcp://${this._host}:${this._port}` +
      `?send_buffer_size=${bufferSize}&recv_buffer_size=${bufferSize}&tcp_nodelay=1`;

    this._server = net.createServer((sock) => {
      sock.on("error", () => {});
      try {
        configureSocket(sock, bufferSize);
      } catch {}
      sock.setNoDelay(true);
      onSocket?.(sock);
    });
    // A bind collision (or any other async listen failure) must never crash
    // the process; it surfaces as ffmpeg failing to connect.
    this._server.on("error", () => {});
    stream.on("close", () => {
      this.close();
    });
    this._server.listen(this._port, this._host);
  }

  get url(): string {
    return this._url;
  }

  get host(): string {
    return this._host;
  }

  get port(): number {
    return this._port;
  }

  close(): void {
    this._server.close();
  }
}

function StreamInput(
  stream: stream.Readable,
  bufferSize?: number,
): NamedPipeStream {
  return new NamedPipeStream(
    stream,
    (sock) => {
      sock.on("error", () => {});
      stream.pipe(sock);
    },
    bufferSize,
  );
}

function StreamOutput(
  stream: stream.Writable,
  pipeArgs?: Parameters<stream.Writable["pipe"]>[1],
  bufferSize?: number,
): NamedPipeStream {
  return new NamedPipeStream(
    stream,
    (sock) => {
      sock.on("error", () => {});
      sock.pipe(stream, pipeArgs);
    },
    bufferSize,
  );
}

export { StreamInput, StreamOutput };
