import type { ExecaError } from "execa";

export type EventMap = {
  start: [string];
  codecData: [
    {
      format: string;
      duration: string;
      audio: string;
      audio_details: unknown;
      video: string;
      video_details: unknown;
    },
  ];
  progress: [
    {
      frames: number;
      currentFps: number;
      currentKbps: number;
      targetSize: number;
      timemark: number;
    },
  ];
  stderr: [string];
  error: [ExecaError, string, string];
  end: [string, string];
};
