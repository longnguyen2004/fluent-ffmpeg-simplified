let ffmpegPath: string = process.env.FFMPEG_PATH ?? "ffmpeg";
let ffprobePath: string = process.env.FFPROBE_PATH ?? "ffprobe";

function setFFmpegPath(path: string): void {
  ffmpegPath = path;
}

function setFFprobePath(path: string): void {
  ffprobePath = path;
}

export { ffmpegPath, ffprobePath, setFFmpegPath, setFFprobePath };
