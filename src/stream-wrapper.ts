import net from "node:net";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { setsockopt } from "sockopt";
import type stream from "node:stream";

const socketConstants =
  process.platform === "darwin"
    ? {
        SOL_SOCKET: 0xffff,
        SO_SNDBUF: 0x1001,
        SO_RCVBUF: 0x1002,
      }
    : process.platform === "linux"
      ? {
          SOL_SOCKET: 1,
          SO_SNDBUF: 7,
          SO_RCVBUF: 8,
        }
      : null;

function configureSocket(sock: net.Socket, size: number) {
  if (!socketConstants) {
    return;
  }

  const { SOL_SOCKET, SO_SNDBUF, SO_RCVBUF } = socketConstants;

  setsockopt(sock, SOL_SOCKET, SO_SNDBUF, size);
  setsockopt(sock, SOL_SOCKET, SO_RCVBUF, size);
}

export class NamedPipeStream {
  private _socketPath: string;
  private _url: string;
  private _server: net.Server;

  constructor(stream: stream.Stream, onSocket?: (sock: net.Socket) => unknown) {
    const id = randomUUID();
    if (process.platform === "win32") {
      this._url = this._socketPath = `\\\\.\\pipe\\${id}.sock`;
    } else {
      // Assuming /tmp is available (it should be, or else your system is very screwed)
      this._socketPath = `/tmp/${id}.sock`;
      this._url = `unix:${this._socketPath}`;
    }

    try {
      fs.statSync(this._socketPath);
      fs.unlinkSync(this._socketPath);
    } catch {}

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

function StreamInput(stream: stream.Readable): NamedPipeStream {
  return new NamedPipeStream(stream, (sock) => {
    sock.on("error", () => {});
    configureSocket(sock, 64 * 1024);
    stream.pipe(sock);
  });
}

function StreamOutput(
  stream: stream.Writable,
  pipeArgs?: Parameters<stream.Writable["pipe"]>[1],
): NamedPipeStream {
  return new NamedPipeStream(stream, (sock) => {
    sock.on("error", () => {});
    configureSocket(sock, 64 * 1024);
    sock.pipe(stream, pipeArgs);
  });
}

export { StreamInput, StreamOutput };
