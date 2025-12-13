import { execa, type ResultPromise } from "execa";
import { parseArgsStringToArgv } from "string-argv";
import { ffmpegPath, ffprobePath } from "./executable.js";
import { StreamInput, StreamOutput } from "./stream-wrapper.js";
import { EventEmitter } from "node:events";
import type { EventMap } from "./events.js";
import type { Readable, Writable } from "node:stream";

export type Options = {
  timeout?: number;
  niceness?: number;
  priority?: number;
  stdoutLines?: number
}

type TimeString =
  | `${number}`                     // ss
  | `${number}:${number}`           // mm:ss
  | `${number}:${number}:${number}` // hh:mm:ss

type TimeStringWithMilliseconds = `${TimeString}.${number}`

type Time = number | TimeString | TimeStringWithMilliseconds;

type Bitrate = number | `${number}` | `${number}k`;

type Filter = string | {
  filter: string,
  options: string | string[] | Record<string, unknown>
}

type Size = `${number}x${number}` | `${number}x?` | `?x${number}` | `${number}%`;

type InputSettings = {
  src: string | Readable,
  format?: string,
  fps?: number,
  readrateNative?: boolean,
  startTime?: Time,
  loop?: boolean,
  extraOpts?: string[],
}

type AudioSettings = {
  codec?: string,
  bitrate?: Bitrate,
  channels?: number,
  freq?: number,
  quality?: number,
  filters?: Filter[],
}

type VideoSettings = {
  codec?: string,
  bitrate?: Bitrate,
  filters?: Filter[],
  fps?: number,
  frames?: number,
  size?: {
    width: number,
    height?: number
  } | {
    width: undefined
    height: number,
  } | {
    percent: number,
  }
}

type OutputSettings = {
  dst: string | {
    stream: Writable,
    pipeArgs?: PipeArgs
  },
  audio?: AudioSettings,
  video?: VideoSettings,
  format?: string,
  duration?: Time,
  startTime?: Time,
  extraOpts?: string[],
}

function filtersToString(filters: Filter[]) {
  return filters.map(el => {
    if (typeof el === "string") {
      return el;
    }
    else {
      const opts = typeof el.options === "string" ? el.options
        : Array.isArray(el.options) ? el.options.join(":")
          : Object.entries(el.options).map(([k, v]) => `${k}=${v}`).join(":");
      return `${el.filter}=${opts}`
    }
  }).join(",");
}

type PipeArgs = Parameters<Writable["pipe"]>[1];

export class FFmpegCommand extends EventEmitter<EventMap> {
  private _options: Options;
  private _inputs: InputSettings[] = [];
  private _outputs: OutputSettings[] = [];
  private _proc?: ResultPromise;
  private _stderrLines: string[] = [];

  constructor(options?: Options) {
    super();
    this._options = {
      niceness: 0,
      stdoutLines: 100,
      ...options
    }
  }
  input(src: string | Readable): this {
    this._inputs.push({ src });
    return this;
  }
  private _getLastInput() {
    const input = this._inputs.at(-1);
    if (!input)
      throw new Error("No input added. Please add an input");
    return input;
  }
  inputFormat(format: string): this {
    const input = this._getLastInput();
    input.format = format;
    return this;
  }
  inputFPS(fps: number): this {
    const input = this._getLastInput();
    input.fps = fps;
    return this;
  }
  native(): this {
    const input = this._getLastInput();
    input.readrateNative = true;
    return this;
  }
  seekInput(time: Time): this {
    const input = this._getLastInput();
    input.startTime = time;
    return this;
  }
  loop(length: unknown): this {
    if (length)
      throw new Error("Please specify loop output duration on the output instead");
    const input = this._getLastInput();
    input.loop = true;
    return this;
  }
  inputOptions(...options: (string | string[])[]): this {
    const input = this._getLastInput();
    input.extraOpts = [
      ...(input.extraOpts ?? []),
      ...options.flat().flatMap(option => parseArgsStringToArgv(option))
    ];
    return this;
  }
  output(dst: string): this;
  output(dst: Writable, pipeArgs?: PipeArgs): this;
  output(dst: string | Writable, pipeArgs?: PipeArgs): this {
    this._outputs.push({
      dst: typeof dst === "string" ? dst : { stream: dst, pipeArgs },
      audio: {},
      video: {}
    });
    return this;
  }
  outputOptions(...options: (string | string[])[]): this {
    const output = this._getLastOutput();
    output.extraOpts = [
      ...(output.extraOpts ?? []),
      ...options.flat().flatMap(option => parseArgsStringToArgv(option))
    ];
    return this;
  }
  private _getLastOutput() {
    const output = this._outputs.at(-1);
    if (!output)
      throw new Error("No output added. Please add an output");
    return output;
  }
  noAudio(): this {
    const output = this._getLastOutput();
    output.audio = undefined;
    return this;
  }
  private setAudioProps<T extends keyof AudioSettings>(key: T, value: AudioSettings[T]) {
    const output = this._getLastOutput();
    if (!output.audio)
      throw new Error("Audio disabled");
    output.audio[key] = value;
  }
  audioCodec(codec: string): this {
    this.setAudioProps("codec", codec);
    return this;
  }
  audioBitrate(bitrate: Bitrate): this {
    this.setAudioProps("bitrate", bitrate);
    return this;
  }
  audioChannels(count: number): this {
    this.setAudioProps("channels", count);
    return this;
  }
  audioFrequency(freq: number): this {
    this.setAudioProps("freq", freq);
    return this;
  }
  audioQuality(q: number): this {
    this.setAudioProps("quality", q);
    return this;
  }
  audioFilters(...filters: (Filter | Filter[])[]): this {
    const output = this._getLastOutput();
    if (!output.audio)
      throw new Error("Audio disabled");
    output.audio.filters = [
      ...(output.audio.filters) ?? [],
      ...filters.flat()
    ];
    return this;
  }
  noVideo(): this {
    const output = this._getLastOutput();
    output.video = undefined;
    return this;
  }
  private setVideoProps<T extends keyof VideoSettings>(key: T, value: VideoSettings[T]) {
    const output = this._getLastOutput();
    if (!output.video)
      throw new Error("Video disabled");
    output.video[key] = value;
  }
  videoCodec(codec: string): this {
    this.setVideoProps("codec", codec);
    return this;
  }
  videoBitrate(bitrate: Bitrate): this {
    this.setVideoProps("bitrate", bitrate);
    return this;
  }
  fps(fps: number): this {
    this.setVideoProps("fps", fps);
    return this;
  }
  frames(count: number): this {
    this.setVideoProps("frames", count);
    return this;
  }
  size(size: Size): this {
    if (size.endsWith("%")) {
      const percentStr = size.substring(0, size.length - 1);
      const percent = Number.parseFloat(percentStr);
      if (!Number.isFinite(percent) || percent <= 0)
        throw new Error(`Invalid size: ${size}`);
      this.setVideoProps("size", { percent });
      return this;
    }
    const [widthStr, heightStr] = size.split("x");
    if (!widthStr || !heightStr)
      throw new Error(`Invalid size: ${size}`);
    const width = widthStr === "?" ? undefined : Number.parseInt(widthStr);
    const height = heightStr === "?" ? undefined : Number.parseInt(heightStr);
    if (typeof width === "number" && (Number.isNaN(width) || width <= 0))
      throw new Error(`Invalid width: ${widthStr}`)
    if (typeof height === "number" && (Number.isNaN(height) || height <= 0))
      throw new Error(`Invalid height: ${heightStr}`)
    if (width)
      this.setVideoProps("size", { width, height });
    else if (height)
      this.setVideoProps("size", { width: undefined, height });
    else
      throw new Error("Width and height can't both be unknown");
    return this;
  }
  videoFilters(...filters: (Filter | Filter[])[]): this {
    const output = this._getLastOutput();
    if (!output.video)
      throw new Error("Video disabled");
    output.video.filters = [
      ...(output.video.filters) ?? [],
      ...filters.flat()
    ];
    return this;
  }
  duration(dur: Time): this {
    this._getLastOutput().duration = dur;
    return this;
  }
  seek(start: Time): this {
    this._getLastOutput().startTime = start;
    return this;
  }
  format(format: string): this {
    this._getLastOutput().format = format;
    return this;
  }
  private processStderr(line: string) {
    this.emit("stderr", line);
    this._stderrLines.push(line);
    if (this._options.stdoutLines && this._stderrLines.length > this._options.stdoutLines)
      this._stderrLines = this._stderrLines.slice(this._stderrLines.length - this._options.stdoutLines);
  }
  run(cancelSignal?: AbortSignal): ResultPromise {
    if (this._proc)
      throw new Error("This instance is already run");
    if (!this._inputs.length)
      throw new Error("No inputs specified");
    if (!this._outputs.length)
      throw new Error("No outputs specified");
    let args: string[] = [];
    for (const input of this._inputs) {
      const { extraOpts, format, fps, readrateNative, startTime, loop, src } = input;
      if (extraOpts)
        args.push(...extraOpts);
      if (format)
        args.push("-f", format);
      if (fps)
        args.push("-r", fps.toString());
      if (readrateNative)
        args.push("-re");
      if (startTime)
        args.push("-ss", startTime.toString());
      if (loop)
        args.push("-loop", "-1");
      if (typeof src === "string") {
        args.push("-i", src);
      }
      else {
        const stream = StreamInput(src);
        args.push("-i", stream.url);
      }
    }
    for (const output of this._outputs) {
      const { dst, format, startTime, duration, extraOpts, audio, video } = output;
      if (format)
        args.push("-f", format);
      if (startTime)
        args.push("-ss", startTime.toString());
      if (duration)
        args.push("-t", duration.toString());
      if (!audio) {
        args.push("-an");
      }
      else {
        const { codec, bitrate, channels, freq, quality, filters } = audio;
        if (codec)
          args.push("-c:a", codec);
        if (bitrate)
          args.push("-b:a", bitrate.toString());
        if (channels)
          args.push("-ac", channels.toString());
        if (freq)
          args.push("-ar", freq.toString());
        if (quality)
          args.push("-q:a", quality.toString());
        if (filters)
          args.push("-af", filtersToString(filters));
      }
      if (!video) {
        args.push("-vn");
      }
      else {
        const { codec, bitrate, filters, fps, frames, size } = video;
        if (codec)
          args.push("-c:v", codec);
        if (bitrate)
          args.push("-b:v", bitrate.toString());
        if (fps)
          args.push("-r", fps.toString());
        if (frames)
          args.push("-frames:v", frames.toString());
        let resolvedFilters = [...(filters ?? [])];
        if (size) {
          if ("percent" in size) {
            const factor = size.percent / 100;
            resolvedFilters.push({
              filter: "scale",
              options: {
                w: `trunc(iw*${factor}/2)*2`,
                h: `trunc(ih*${factor}/2)*2`,
              }
            })
          }
          else {
            const { width, height } = size;
            resolvedFilters.push({
              filter: "scale",
              options: {
                w: width ? width : "-2",
                h: height ? height : "-2"
              }
            })
          }
        }
        if (resolvedFilters.length) {
          args.push("-vf", filtersToString(resolvedFilters));
        }
      }
      if (extraOpts)
        args.push(...extraOpts);
      if (typeof dst === "string") {
        args.push(dst);
      }
      else {
        const stream = StreamOutput(dst.stream, dst.pipeArgs);
        args.push(stream.url);
      }
    }
    const proc = execa(ffmpegPath, args, {
      cancelSignal,
      lines: true,
      buffer: { stdout: false }
    });
    this._proc = proc;
    proc.once("spawn", () => this.emit("start", proc.spawnargs.join(" ")));
    (async () => {
      for await (const line of proc.iterable({ from: "stderr" }))
        this.processStderr(line);
    })();
    proc
      .then(() => { this.emit("end", "", this._stderrLines.join("\n")) })
      .catch((err) => { this.emit("error", err, "", this._stderrLines.join("\n")) });
    return proc;
  }
}
