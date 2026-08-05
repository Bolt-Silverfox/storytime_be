import { Injectable } from '@nestjs/common';
import { metrics, Counter } from '@opentelemetry/api';

export type TtsProviderName = 'elevenlabs' | 'deepgram' | 'edgetts';
export type TtsAttemptResult =
  | 'success'
  | 'quota_error'
  | 'transient_error'
  | 'permanent_error';
export type TtsParagraphResult = 'completed' | 'failed';

/**
 * TtsMetricsService
 *
 * Emits OTLP counters for the TTS batch pipeline so provider health and
 * fallback behaviour are visible in Grafana:
 *
 * - tts_provider_attempts_total{provider,result} — every synthesis attempt,
 *   including the ones that fail over to the next provider. Lets us see
 *   per-provider success rate, quota exhaustion, and how often the fallback
 *   chain is exercised.
 * - tts_paragraphs_total{result} — final per-paragraph outcome after the whole
 *   provider chain + retries (completed vs failed), for batch success rate.
 *
 * Counters are created in the constructor, which Nest runs during DI (after
 * otel-setup registered the global MeterProvider at the top of main.ts).
 * Recording is best-effort — a metrics failure must never affect synthesis.
 */
@Injectable()
export class TtsMetricsService {
  private readonly attempts: Counter;
  private readonly paragraphs: Counter;

  constructor() {
    const meter = metrics.getMeter('storytime-api');
    this.attempts = meter.createCounter('tts_provider_attempts_total', {
      description:
        'TTS synthesis attempts per provider (labelled by provider + result)',
    });
    this.paragraphs = meter.createCounter('tts_paragraphs_total', {
      description:
        'Final per-paragraph TTS outcome after the full provider chain',
    });
  }

  recordAttempt(provider: TtsProviderName, result: TtsAttemptResult): void {
    try {
      this.attempts.add(1, { provider, result });
    } catch {
      // best-effort: never let metrics break synthesis
    }
  }

  recordParagraph(result: TtsParagraphResult): void {
    try {
      this.paragraphs.add(1, { result });
    } catch {
      // best-effort
    }
  }
}
