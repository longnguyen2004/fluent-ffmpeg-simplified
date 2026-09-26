import type net from "node:net";
import { createRequire } from "node:module";

type KoffiModule = typeof import("koffi");

/**
 * Load koffi without letting a broken/missing FFI break the whole library:
 * buffer tuning is best-effort, everything else works without it.
 */
function loadKoffi(): KoffiModule | null {
  try {
    return createRequire(import.meta.url)("koffi") as KoffiModule;
  } catch {
    return null;
  }
}

/** Raw fd of a live socket, reaching through the (private) handle. */
function socketFd(sock: net.Socket): number | null {
  const handle = (sock as unknown as { _handle?: { fd?: unknown } })._handle;
  const fd = handle?.fd;
  // Windows sockets have no fd (Node reports -1); without one,
  // setsockopt is unreachable.
  return typeof fd === "number" && fd >= 0 ? fd : null;
}

type PlatformConfig = {
  libs: string[];
  SOL_SOCKET: number;
  SO_SNDBUF: number;
  SO_RCVBUF: number;
};

function platformConfig(): PlatformConfig | null {
  if (process.platform === "linux") {
    return {
      libs: ["libc.so.6"],
      SOL_SOCKET: 1,
      SO_SNDBUF: 7,
      SO_RCVBUF: 8,
    };
  }
  if (process.platform === "darwin") {
    return {
      libs: ["libc.dylib", "/usr/lib/libSystem.B.dylib"],
      SOL_SOCKET: 0xffff,
      SO_SNDBUF: 0x1001,
      SO_RCVBUF: 0x1002,
    };
  }
  // No tuning elsewhere: on Windows, sockets expose no fd to JS, so the
  // setsockopt path below is unreachable there — but the ffmpeg side of
  // each connection still gets low buffers via the URL params.
  return null;
}

export function configureSocket(sock: net.Socket, size: number): void {
  getSocketTuning()?.setBufferSize(sock, size);
}

type SocketTuning = {
  setBufferSize: (sock: net.Socket, size: number) => void;
};

let cachedTuning: SocketTuning | null | undefined;

function getSocketTuning(): SocketTuning | null {
  if (cachedTuning !== undefined) {
    return cachedTuning;
  }
  cachedTuning = createSocketTuning();
  return cachedTuning;
}

function createSocketTuning(): SocketTuning | null {
  const config = platformConfig();
  if (!config) {
    return null;
  }
  const koffi = loadKoffi();
  if (!koffi) {
    return null;
  }
  let lib: import("koffi").LibraryHandle | null = null;
  for (const name of config.libs) {
    try {
      lib = koffi.load(name);
      break;
    } catch {
      // Try the next candidate name.
    }
  }
  if (!lib) {
    return null;
  }
  const rawSetsockopt = lib.func("int setsockopt(int, int, int, int *, int)");
  const { SOL_SOCKET, SO_SNDBUF, SO_RCVBUF } = config;
  return {
    setBufferSize(sock: net.Socket, size: number): void {
      const fd = socketFd(sock);
      if (fd === null) {
        return;
      }
      for (const opt of [SO_SNDBUF, SO_RCVBUF]) {
        const ret: number = rawSetsockopt(fd, SOL_SOCKET, opt, [size], 4);
        if (ret !== 0) {
          throw new Error(`setsockopt failed (errno ${koffi.errno()})`);
        }
      }
    },
  };
}
