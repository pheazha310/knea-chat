/**
 * VoiceMessage — WhatsApp-style waveform player for voice/audio attachments.
 *
 * Renders a green bubble with a circular play button, a dotted waveform,
 * duration, and metadata (current time + file size). Clicking the waveform
 * seeks; the play button toggles playback.
 */
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../common/Icon';

const NUM_BARS = 50;

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const fmtBytes = (bytes?: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

interface VoiceMessageProps {
  src: string;
  fileSize?: number | null;
  fileName?: string;
  duration?: number;
}

const VoiceMessage = ({ src, fileSize, fileName, duration: durationProp }: VoiceMessageProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [bars, setBars] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(durationProp || 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audioBuf) => {
        if (cancelled) return;
        const raw = audioBuf.getChannelData(0);
        const step = Math.floor(raw.length / NUM_BARS) || 1;
        const amplitudes = Array.from({ length: NUM_BARS }, (_, i) => {
          let sum = 0;
          const start = i * step;
          const end = Math.min(start + step, raw.length);
          for (let j = start; j < end; j++) sum += Math.abs(raw[j]);
          return sum / (end - start || 1);
        });
        const peak = Math.max(...amplitudes, 0.01);
        setBars(amplitudes.map((a) => a / peak));
        setDuration(audioBuf.duration);
      })
      .catch(() => {
        if (!cancelled) {
          setBars(Array(NUM_BARS).fill(0.3));
        }
      })
      .finally(() => {
        if (!cancelled) ctx.close();
      });
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      const d = audio.duration || 1;
      setProgress(audio.currentTime / d);
      setDuration(d);
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      if (audio.currentTime >= audio.duration) audio.currentTime = 0;
      audio.play().then(() => setPlaying(true)).catch((err: any) => {
        console.warn('Voice playback failed:', err);
        setError('Cannot play audio — check your browser permissions');
      });
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * duration;
    setProgress(pct);
  };

  const filledIndex = Math.floor(progress * bars.length);
  const currentTime = playing
    ? fmt((duration || 0) - (audioRef.current?.currentTime || 0))
    : fmt(duration);

  return (
    <div className="wa-voice-bubble">
      <div className="wa-vm-main">
        <button
          type="button"
          className="wa-vm-play"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play voice message'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>

        <div className="wa-vm-waveform" onClick={handleSeek} role="slider"
          aria-label="Seek" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}
        >
          {bars.map((h, i) => (
            <span
              key={i}
              className={`wa-vm-bar${i < filledIndex ? ' filled' : ''}`}
              style={{ height: `${Math.max(h * 100, 8)}%` }}
            />
          ))}
        </div>

        <span className="wa-vm-duration">{fmt(duration)}</span>
      </div>

      <div className="wa-vm-meta">
        <span className="wa-vm-mic">
          <Icon name="mic" size={11} />
        </span>
        <span className="wa-vm-time">{currentTime}</span>
        <span className="wa-vm-sep">●</span>
        <span className="wa-vm-size">{fmtBytes(fileSize)}</span>
        {fileName && (
          <>
            <span className="wa-vm-sep">●</span>
            <span className="wa-vm-filename">{fileName}</span>
          </>
        )}
      </div>

      {error && <span className="wa-vm-error" title={error}>⚠</span>}

      <audio ref={audioRef} src={src} preload="auto" onError={() => setError('Audio file could not be loaded')} />
    </div>
  );
};

export default VoiceMessage;
