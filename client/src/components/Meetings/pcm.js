/** Every posted frame becomes a complete WAV file; silence remains part of the capture timeline. */
class MeetingPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    // Dynamic chunking: minimum 3s, pause trigger at 600ms of silence, maximum 8s
    this.minSamples = Math.floor(sampleRate * 3.0);
    this.maxSamples = Math.floor(sampleRate * 8.0);
    this.silenceSamplesRequired = Math.floor(sampleRate * 0.6);
    this.samples = new Float32Array(this.maxSamples);
    this.offset = 0;
    this.silenceCounter = 0;
    this.hasSpoken = false;
    this.silenceThreshold = 0.012; // RMS voice presence threshold
    this.ticks = 0;

    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.emit();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  emit() {
    if (!this.offset) return;
    // Align to 16 samples (32 bytes PCM16 = 1 ms) so sample count is integer milliseconds
    const alignedLength = this.offset - (this.offset % 16);
    if (alignedLength === 0) return;
    const samples = this.samples.slice(0, alignedLength);
    this.port.postMessage({ type: 'frame', samples: samples.buffer }, [samples.buffer]);
    this.offset = 0;
    this.silenceCounter = 0;
    this.hasSpoken = false;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (!input) return true;

    let energy = 0;
    for (const value of input) {
      energy += value * value;
    }
    const rms = Math.sqrt(energy / input.length);
    const isSpeech = rms > this.silenceThreshold;

    if (isSpeech) {
      this.hasSpoken = true;
      this.silenceCounter = 0;
    } else if (this.hasSpoken) {
      this.silenceCounter += input.length;
    }

    for (const value of input) {
      this.samples[this.offset++] = value;
      if (this.offset === this.maxSamples) {
        this.emit();
        break;
      }
    }

    // Natural pause cut: minimum chunk reached AND speaker took a natural pause
    if (this.hasSpoken && this.offset >= this.minSamples && this.silenceCounter >= this.silenceSamplesRequired) {
      this.emit();
    }

    if (++this.ticks % 12 === 0) {
      this.port.postMessage({ type: 'level', level: Math.min(1, rms * 4) });
    }
    return true;
  }
}
registerProcessor('meeting-pcm', MeetingPCM);
