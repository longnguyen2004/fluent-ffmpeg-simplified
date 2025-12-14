import net from "node:net";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type stream from "node:stream";

export class NamedPipeStream {
  private _socketPath: string;
  private _url: string;
  private _server: net.Server;

  constructor(stream: stream.Stream, onSocket?: (sock: net.Socket) => unknown)
  {
    const id = randomUUID();
    if (process.platform === "win32")
    {
      this._url = this._socketPath = `\\\\.\\pipe\\${id}.sock`;
    }
    else
    {
      // Assuming /tmp is available (it should be, or else your system is very screwed)
      this._socketPath = `/tmp/${id}.sock`;
      this._url = "unix:" + this._socketPath;
    }

    try
    {
      fs.statSync(this._socketPath);
      fs.unlinkSync(this._socketPath);
    }
    catch {}

    this._server = net.createServer(onSocket);
    stream.on("close", () => { this._server.close(); });
    this._server.listen(this._socketPath);
  }

  get url(): string
  {
    return this._url;
  }

  close(): void
  {
    this._server.close();
  }
}

function StreamInput(stream: stream.Readable): NamedPipeStream
{
  return new NamedPipeStream(stream, sock => stream.pipe(sock));
}

function StreamOutput(stream: stream.Writable, pipeArgs: Parameters<stream.Writable["pipe"]>[1]): NamedPipeStream
{
  return new NamedPipeStream(stream, sock => sock.pipe(stream, pipeArgs));
}

export { StreamInput, StreamOutput };
