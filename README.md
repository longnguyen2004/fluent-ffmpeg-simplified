# fluent-ffmpeg-simplified: A much simpler implementation of [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/)

## About

This is a reimplementation of `fluent-ffmpeg`, aimed to be much simpler in code, and free from tech debt and old development practices. Due to that, there are several differences that one should be aware of.

## Differences from original `fluent-ffmpeg`

### Constructors can't be called without `new`

This will not work

```javascript
import { FFmpegCommand } from "fluent-ffmpeg-simplified";
const command = FFmpegCommand(...) // !!!
```

Please add `new` before `FFmpegCommand`

### No method aliases

All methods that are listed as aliases in `fluent-ffmpeg`'s README aren't implemented. Please use the main function names.

### Multi-inputs and outputs

This package integrates [`ffmpeg-multistream`](https://github.com/s074/ffmpeg-multistream), allowing you to specify multiple output files/streams and have separate options for them.

Due to this greater flexibility, an output must be specified using the `output` method before running the command. Methods like `save()` and `stream()` don't exist. If you want to get an output stream, pass a `PassThrough` stream to `output`.

Because each output can have its own options, an output must be specified before any output option methods are called.

```javascript
const command = new FFmpegCommand();
command.audioFrequency(...).output(...); // This does not work
command.output(...).audioFrequency(...); // Do this instead
```

### No thumbnail generation, no `flvtool` among others

Those seems to be rare use cases, and thus are not included here.

### No `stdout`

Due to explicit output requirement, event handlers receiving `stdout` will always get an empty string.

### No manual `kill` signal sending

Please use the standard `AbortController` mechanism.

## Improvements

### More robust process handling

Instead of a custom-made process handler, this package uses the battle-tested [`execa`](https://github.com/sindresorhus/execa) package, which should be more robust and handles more edge cases.

## Install

No npm packages are published for this yet. For now, use the pkg.pr.new install links.
