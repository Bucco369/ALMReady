/**
 * useProgressETA – Shared hook for computing a stable ETA from progress updates.
 *
 * Uses exponential weighted moving average of velocity (Δprogress/Δtime) to
 * produce a smoothed "time remaining" estimate that doesn't oscillate wildly.
 *
 * Usage:
 *   const { etaText } = useProgressETA(progress, isActive);
 *   // etaText: "Estimating…" | "~45s remaining" | "~2m 30s remaining" | "Almost done…"
 */
import { useRef, useEffect, useState, useCallback } from 'react';

interface ProgressSample {
  t: number;  // timestamp ms
  p: number;  // progress 0–100
}

const MIN_SAMPLES = 3;
const MIN_SPAN_MS = 1500;      // need at least 1.5s of data
const MAX_SAMPLES = 20;
const ALPHA = 0.3;             // EWA decay (higher = more weight on recent)
const MAX_ETA_INCREASE = 1.3;  // ETA can increase by at most 30% from last shown
const MAX_ETA_SECONDS = 3600;  // cap at 1 hour

function formatEta(seconds: number): string {
  if (seconds < 3) return 'Almost done…';
  if (seconds < 60) return `~${Math.round(seconds)}s remaining`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return sec > 0 ? `~${min}m ${sec}s remaining` : `~${min}m remaining`;
}

export function useProgressETA(
  progress: number,
  isActive: boolean,
): string {
  const samplesRef = useRef<ProgressSample[]>([]);
  const lastEtaRef = useRef<number | null>(null);
  const [etaText, setEtaText] = useState('');

  const reset = useCallback(() => {
    samplesRef.current = [];
    lastEtaRef.current = null;
    setEtaText('');
  }, []);

  useEffect(() => {
    if (!isActive) {
      reset();
      return;
    }

    const now = Date.now();
    const samples = samplesRef.current;

    // Only record if progress actually increased
    if (samples.length === 0 || progress > samples[samples.length - 1].p) {
      samples.push({ t: now, p: progress });
      if (samples.length > MAX_SAMPLES) samples.shift();
    }

    // Need enough data points spanning enough time
    if (samples.length < MIN_SAMPLES || (now - samples[0].t) < MIN_SPAN_MS) {
      setEtaText('Estimating…');
      return;
    }

    // Compute velocity using exponential weighted average of recent deltas
    let weightedVelocity = 0;
    let totalWeight = 0;

    for (let i = 1; i < samples.length; i++) {
      const dt = (samples[i].t - samples[i - 1].t) / 1000; // seconds
      const dp = samples[i].p - samples[i - 1].p;
      if (dt <= 0 || dp <= 0) continue;
      const v = dp / dt; // %/s
      // More recent samples get exponentially more weight
      const weight = Math.pow(1 - ALPHA, samples.length - 1 - i);
      weightedVelocity += v * weight;
      totalWeight += weight;
    }

    if (totalWeight <= 0 || weightedVelocity <= 0) {
      setEtaText('Estimating…');
      return;
    }

    const velocity = weightedVelocity / totalWeight;
    const remaining = 100 - progress;
    let etaSeconds = remaining / velocity;

    // Clamp: don't let ETA spike more than 30% above last shown value
    if (lastEtaRef.current !== null && lastEtaRef.current > 5) {
      const cap = lastEtaRef.current * MAX_ETA_INCREASE;
      if (etaSeconds > cap) etaSeconds = cap;
    }

    etaSeconds = Math.max(0, Math.min(etaSeconds, MAX_ETA_SECONDS));
    lastEtaRef.current = etaSeconds;

    setEtaText(formatEta(etaSeconds));
  }, [progress, isActive, reset]);

  return etaText;
}
