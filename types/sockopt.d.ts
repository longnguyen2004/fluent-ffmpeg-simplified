declare module "sockopt" {
  import type { Socket } from "node:net";
  import type { Socket as DgramSocket } from "node:dgram";

  type NodeSocket = Socket | DgramSocket;

  export function getsockopt(
    socket: NodeSocket,
    level: number,
    option: number,
  ): number;

  export function setsockopt(
    socket: NodeSocket,
    level: number,
    option: number,
    value: number,
  ): void;
}
