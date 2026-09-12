import { useEffect, useRef, useState } from "react";

/** Shares the recorder's stream; never requests or stops microphone tracks. */
export function LiveWaveform({ stream }: { stream: MediaStream | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!stream || !canvas) return;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let frame = 0;
    let disposed = false;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const paint = () => {
        if (disposed) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const ratio = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        analyser.getFloatTimeDomainData(samples);
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = "#fafafa";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < samples.length; i++) {
          const x = i / (samples.length - 1) * width;
          // Boost quiet speech visually, with a soft limit for louder peaks.
          // Float samples preserve subtle movement on lower-volume microphones.
          const amplitude = Math.tanh(samples[i] * 5);
          const y = height / 2 + amplitude * height * 0.46;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        frame = requestAnimationFrame(paint);
      };
      void context.resume().then(paint).catch(() => {
        if (!disposed) setUnavailable(true);
      });
    } catch {
      setUnavailable(true);
    }
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      source?.disconnect();
      void context?.close().catch(() => {});
    };
  }, [stream]);

  return unavailable || !stream
    ? <span className="rec-status">Recording · preview unavailable</span>
    : <canvas ref={canvasRef} className="live-waveform" role="img" aria-label="Live microphone waveform" />;
}
