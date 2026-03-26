"use client";
import { useState, useMemo, useCallback } from "react";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface STTModel  { id: string; provider: string; name: string; pricePerMin: number; notes?: string }
interface LLMModel  { id: string; provider: string; name: string; inputPer1M: number; outputPer1M: number; notes?: string }
interface TTSModel  { id: string; provider: string; name: string; pricePerMin?: number; charPer1M?: number; notes?: string }
interface TelModel  { id: string; provider: string; name: string; pricePerMin: number; notes?: string }
interface InfraModel { id: string; name: string; baseMonthly: number; agentMinIncluded: number; overagePerMin: number; notes?: string }
type AnyModel = STTModel | LLMModel | TTSModel | TelModel | InfraModel;
type TabKey = "STT" | "LLM" | "TTS" | "Telephony" | "Infra";

// ─── DATA (prices verified March 2026 from official provider pages) ───────────
//
// STT: prices are per audio minute, PAYG/standard tier
// LLM: prices per 1M tokens (input / output)
// TTS: prices per 1M characters OR per minute where char-based isn't applicable
// Telephony: per minute, US calls
// Infra: monthly base + overage per agent-minute

const STT_MODELS: STTModel[] = [
  // Source: deepgram.com/pricing (fetched March 2026)
  { id: "dg-nova3-mono",  provider: "Deepgram",        name: "Nova-3 Monolingual",      pricePerMin: 0.0077, notes: "PAYG; Growth: $0.0065" },
  { id: "dg-nova3-multi", provider: "Deepgram",        name: "Nova-3 Multilingual",     pricePerMin: 0.0092, notes: "PAYG; Growth: $0.0078 · 45+ langs" },
  { id: "dg-flux",        provider: "Deepgram",        name: "Flux",                    pricePerMin: 0.0077, notes: "PAYG; built-in turn detection" },
  { id: "dg-nova12",      provider: "Deepgram",        name: "Nova-1 / Nova-2",         pricePerMin: 0.0058, notes: "PAYG; Growth: $0.0047" },
  { id: "dg-enhanced",    provider: "Deepgram",        name: "Enhanced",                pricePerMin: 0.0165, notes: "PAYG; keyword boosting" },
  { id: "dg-base",        provider: "Deepgram",        name: "Base",                    pricePerMin: 0.0145, notes: "PAYG; Growth: $0.0105" },

  // Source: assemblyai.com/pricing & /products (March 2026)
  // Universal-Streaming & Universal-3 Pro Streaming both $0.15/hr = $0.0025/min
  // Universal-3 Pro pre-recorded $0.21/hr; streaming price not separately listed → use $0.15/hr same as U-Streaming
  { id: "aai-u3pro",      provider: "AssemblyAI",      name: "Universal-3 Pro Streaming", pricePerMin: 0.0035, notes: "$0.21/hr pre-recorded; streaming ~$0.21/hr" },
  { id: "aai-ustream",    provider: "AssemblyAI",      name: "Universal-Streaming",     pricePerMin: 0.0025, notes: "$0.15/hr; $50 free credit" },
  { id: "aai-whisper",    provider: "AssemblyAI",      name: "Whisper-Streaming (legacy)", pricePerMin: 0.0025, notes: "$0.15/hr; same tier as Universal-Streaming" },

  // Source: cloud.google.com/speech-to-text/pricing
  // V2 Chirp / default model: $0.016/min (0–500k min/mo), tiered down to $0.004 >2M min/mo
  { id: "gcp-stt",        provider: "Google Cloud",    name: "Speech-to-Text V2 (Chirp)", pricePerMin: 0.016,  notes: "0–500k min/mo; $0.004 at >2M min" },

  // Source: aws.amazon.com/transcribe/pricing
  // Standard streaming: $0.024/min for first 250k; batch slightly less
  { id: "amz-transcribe", provider: "Amazon",          name: "Transcribe Standard",     pricePerMin: 0.024,  notes: "First 250k min/mo; tiered down to $0.0078" },

  // Source: azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/
  // Standard real-time: $1.00/hr = $0.01667/min; Custom: $1.40/hr = $0.0233/min
  { id: "az-std",         provider: "Microsoft Azure", name: "Standard Real-time",      pricePerMin: 0.01667, notes: "$1.00/hr; 5 hrs free/mo" },
  { id: "az-custom",      provider: "Microsoft Azure", name: "Custom Real-time",        pricePerMin: 0.02333, notes: "$1.40/hr; endpoint hosting extra" },

  // LiveKit Inference passes through Deepgram Nova-3 at same rate
  { id: "lk-stt",         provider: "LiveKit",         name: "Hosted STT (Inference)",  pricePerMin: 0.0092, notes: "Via plan credits; Nova-3 multi rate" },
];

// LLM token-to-cost assumptions for voice: 150 wpm × 1.3 tokens/word ≈ 200 in, 200 out per minute
const AVG_INPUT_TOKENS_PER_MIN  = 200;
const AVG_OUTPUT_TOKENS_PER_MIN = 200;

const LLM_MODELS: LLMModel[] = [
  // Source: platform.openai.com/docs/models/compare (March 2026 — GPT-5.4 family live)
  { id: "oai-gpt54",       provider: "OpenAI",        name: "GPT-5.4 (≤1M ctx)",        inputPer1M: 2.50,  outputPer1M: 15.00 },
  { id: "oai-gpt54-long",  provider: "OpenAI",        name: "GPT-5.4 (long ctx)",       inputPer1M: 5.00,  outputPer1M: 22.50, notes: "1M+ token context" },
  { id: "oai-gpt54-mini",  provider: "OpenAI",        name: "GPT-5.4 mini",             inputPer1M: 0.75,  outputPer1M: 4.50  },
  { id: "oai-gpt54-nano",  provider: "OpenAI",        name: "GPT-5.4 nano",             inputPer1M: 0.20,  outputPer1M: 1.25  },
  { id: "oai-gpt54-pro",   provider: "OpenAI",        name: "GPT-5.4-pro",              inputPer1M: 30.00, outputPer1M: 180.00, notes: "Highest capability" },
  // Realtime API audio tokens: $32/M audio input, $64/M audio output (text: $4/$16 per M)
  { id: "oai-realtime",    provider: "OpenAI",        name: "GPT-Realtime-1.5 (audio)", inputPer1M: 32.00, outputPer1M: 64.00, notes: "Audio token rates" },
  // gpt-4o still widely used: $2.50/$10 per M
  { id: "oai-gpt4o",       provider: "OpenAI",        name: "GPT-4o",                   inputPer1M: 2.50,  outputPer1M: 10.00 },
  // gpt-4o-mini: $0.15/$0.60 per M (confirmed)
  { id: "oai-gpt4o-mini",  provider: "OpenAI",        name: "GPT-4o mini",              inputPer1M: 0.15,  outputPer1M: 0.60  },

  // Source: groq.com/pricing (fetched March 2026 — exact table)
  { id: "groq-llama8b",    provider: "Groq",          name: "Llama 3.1 8B Instant",     inputPer1M: 0.05,  outputPer1M: 0.08,  notes: "840 tok/s" },
  { id: "groq-llama4s",    provider: "Groq",          name: "Llama 4 Scout (17Bx16E)",  inputPer1M: 0.11,  outputPer1M: 0.34,  notes: "594 tok/s" },
  { id: "groq-qwen3",      provider: "Groq",          name: "Qwen3 32B",                inputPer1M: 0.29,  outputPer1M: 0.59,  notes: "662 tok/s" },
  { id: "groq-llama70b",   provider: "Groq",          name: "Llama 3.3 70B Versatile",  inputPer1M: 0.59,  outputPer1M: 0.79,  notes: "394 tok/s" },
  { id: "groq-oss20b",     provider: "Groq",          name: "GPT OSS 20B",              inputPer1M: 0.075, outputPer1M: 0.30,  notes: "1,000 tok/s" },
  { id: "groq-oss120b",    provider: "Groq",          name: "GPT OSS 120B",             inputPer1M: 0.15,  outputPer1M: 0.60,  notes: "500 tok/s" },
  { id: "groq-kimi",       provider: "Groq",          name: "Kimi K2-0905 1T",          inputPer1M: 1.00,  outputPer1M: 3.00,  notes: "200 tok/s · 256k ctx" },

  // Source: docs.x.ai/developers/models & costgoat.com/pricing/grok-api (March 2026)
  // Grok 4 = $3/$15; Grok 4 Fast / 4.1 Fast = $0.20/$0.50
  // "Grok-4.20" in original data is the Grok 4.20 alias = Grok 4 ($3/$15)
  // "grok-4-1-fast" = Grok 4.1 Fast = $0.20/$0.50
  { id: "xai-grok4",       provider: "xAI",           name: "Grok 4 (reasoning)",       inputPer1M: 3.00,  outputPer1M: 15.00, notes: "256k ctx; frontier reasoning" },
  { id: "xai-grok4fast",   provider: "xAI",           name: "Grok 4.1 Fast",            inputPer1M: 0.20,  outputPer1M: 0.50,  notes: "2M ctx; latency-optimised" },

  // Source: ai.google.dev/gemini-api/docs/pricing & tldl.io/resources/google-gemini-api-pricing (March 2026)
  // 2.5 Pro: $1.25/$10 (≤200k ctx) — NOTE original had wrong $2.50/$15 which is >200k rate
  // 2.5 Flash: $0.30/$2.50 (confirmed)
  // 2.5 Flash-Lite: $0.10/$0.40 (confirmed)
  // 3.1 Pro: $2.00/$12.00 (>200k ctx $4/$18) — using standard rate
  // 3.1 Flash: $0.50/$3.00 (confirmed)
  { id: "gem-25pro",       provider: "Google Gemini", name: "Gemini 2.5 Pro (≤200k)",  inputPer1M: 1.25,  outputPer1M: 10.00, notes: "Free tier; >200k: $2.50/$15" },
  { id: "gem-25flash",     provider: "Google Gemini", name: "Gemini 2.5 Flash",         inputPer1M: 0.30,  outputPer1M: 2.50,  notes: "Free tier" },
  { id: "gem-25flashlite", provider: "Google Gemini", name: "Gemini 2.5 Flash-Lite",    inputPer1M: 0.10,  outputPer1M: 0.40,  notes: "Free tier; cheapest Gemini" },
  { id: "gem-31pro",       provider: "Google Gemini", name: "Gemini 3.1 Pro (≤200k)",  inputPer1M: 2.00,  outputPer1M: 12.00, notes: ">200k: $4/$18 · preview" },
  { id: "gem-31flash",     provider: "Google Gemini", name: "Gemini 3.1 Flash",         inputPer1M: 0.50,  outputPer1M: 3.00,  notes: "Free tier" },

  // LiveKit Inference – example DeepSeek-V3 rate via LiveKit
  { id: "lk-llm",          provider: "LiveKit",       name: "Hosted LLM (Inference)",   inputPer1M: 0.15,  outputPer1M: 0.60,  notes: "DeepSeek-V3 example; see LiveKit docs" },
];

// TTS chars/min assumption: 150 wpm × ~5 chars/word = 750 chars/min
const AVG_CHARS_PER_MIN = 750;

const TTS_MODELS: TTSModel[] = [
  // Source: elevenlabs.io/pricing/api (fetched March 2026)
  // Multilingual v2/v3: Creator=$0.22/1k (overage $0.30), Pro=$0.17/$0.24, Scale=$0.12/$0.18, Business=$0.12 base
  // Flash/Turbo: Creator=$0.11/1k (overage $0.15), Pro=$0.10/$0.12, Scale=$0.08/$0.09, Business=$0.06 base
  // Per-minute = (charPer1k × 750chars/min / 1000)
  { id: "el-multi-creator",  provider: "ElevenLabs", name: "Multilingual v2/v3 (Creator overage)", charPer1M: 300.0, notes: "$0.30/1k chars" },
  { id: "el-multi-pro",      provider: "ElevenLabs", name: "Multilingual v2/v3 (Pro)",             charPer1M: 240.0, notes: "$0.24/1k chars" },
  { id: "el-multi-scale",    provider: "ElevenLabs", name: "Multilingual v2/v3 (Scale)",           charPer1M: 180.0, notes: "$0.18/1k chars" },
  { id: "el-multi-biz",      provider: "ElevenLabs", name: "Multilingual v2/v3 (Business base)",   charPer1M: 120.0, notes: "$0.12/1k chars · lowest self-serve" },
  { id: "el-flash-creator",  provider: "ElevenLabs", name: "Flash/Turbo (Creator overage)",        charPer1M: 150.0, notes: "$0.15/1k chars; ultra-low latency" },
  { id: "el-flash-biz",      provider: "ElevenLabs", name: "Flash/Turbo (Business base)",          charPer1M: 60.0,  notes: "$0.06/1k chars; cheapest EL" },

  // Source: Cartesia pricing page (March 2026) — 1 credit = 1 char; plan prices in $/1M chars
  // Free: 20k credits; Pro: 100k credits ($5/mo); Startup: 1.25M ($49/mo); Scale: 8M ($299/mo)
  // Credit cost at each tier: Free ~$0.00 (but tiny), Pro=$0.05/1k, Startup=$0.039/1k, Scale=$0.037/1k
  // For PAYG overage reference: ~$5 per 100k chars = $50/M chars
  { id: "car-sonic3",     provider: "Cartesia",       name: "Sonic-3 (Pro tier ~$50/M)",            charPer1M: 50.0,  notes: "1 credit/char; ~$5/100k at Pro" },
  { id: "car-startup",    provider: "Cartesia",       name: "Sonic-3 (Startup tier ~$39/M)",         charPer1M: 39.2,  notes: "$49/mo for 1.25M credits" },
  { id: "car-scale",      provider: "Cartesia",       name: "Sonic-3 (Scale tier ~$37/M)",           charPer1M: 37.4,  notes: "$299/mo for 8M credits" },

  // Source: cloud.google.com/text-to-speech/pricing
  { id: "gcp-wavenet",    provider: "Google Cloud",   name: "WaveNet / Standard",                   charPer1M: 4.0,   notes: "4M chars free/mo" },
  { id: "gcp-neural2",    provider: "Google Cloud",   name: "Neural2 / Polyglot",                   charPer1M: 16.0,  notes: "1M chars free/mo" },
  { id: "gcp-chirp3",     provider: "Google Cloud",   name: "Chirp 3 HD",                           charPer1M: 30.0,  notes: "1M chars free/mo" },
  { id: "gcp-studio",     provider: "Google Cloud",   name: "Studio (custom)",                      charPer1M: 160.0, notes: "Premium studio voices" },
  // Gemini 2.5 Flash TTS: $0.50/1M text tokens input + $10/1M audio output tokens (25 audio tok/sec)
  // ~750 chars/min ÷ 4 chars/token = 188 text input tokens/min; 60s × 25 = 1500 audio output tokens/min
  // Cost/min = (188/1M)×$0.50 + (1500/1M)×$10 = $0.000094 + $0.015 ≈ $0.015/min → $20/M chars
  { id: "gcp-gem25flash", provider: "Google Cloud",   name: "Gemini 2.5 Flash TTS",                 charPer1M: 20.0,  notes: "$0.50/1M text + $10/1M audio tokens" },
  { id: "gcp-gem25pro",   provider: "Google Cloud",   name: "Gemini 2.5 Pro TTS",                   charPer1M: 40.0,  notes: "$1/1M text + $20/1M audio tokens" },

  // Source: aws.amazon.com/polly/pricing
  { id: "amz-std",        provider: "Amazon",         name: "Polly Standard",                       charPer1M: 4.0,   notes: "5M chars/mo free" },
  { id: "amz-neural",     provider: "Amazon",         name: "Polly Neural",                         charPer1M: 16.0,  notes: "1M chars free (first 12 mo)" },
  { id: "amz-gen",        provider: "Amazon",         name: "Polly Generative",                     charPer1M: 30.0,  notes: "100k chars free (first 12 mo)" },
  { id: "amz-longform",   provider: "Amazon",         name: "Polly Long-Form",                      charPer1M: 100.0, notes: "500k chars free (first 12 mo)" },

  // Source: azure.microsoft.com/pricing/details/cognitive-services/speech-services/
  { id: "az-neural",      provider: "Microsoft Azure",name: "Neural (standard)",                    charPer1M: 15.0,  notes: "0.5M chars free/mo" },
  { id: "az-custom",      provider: "Microsoft Azure",name: "Custom Professional",                  charPer1M: 36.0,  notes: "Avg $24–$48/M; voice training extra" },

  // LiveKit Inference (ElevenLabs Cartesia Sonic via plan credits)
  { id: "lk-tts",         provider: "LiveKit",        name: "Hosted TTS (Inference)",               charPer1M: 50.0,  notes: "Cartesia Sonic via plan credits" },

  // Source: sarvam.ai docs (₹15/10k chars = ₹1500/M chars ÷ 83 ≈ $18/M; v3 ₹30/10k = $36/M)
  { id: "sar-v2",         provider: "Sarvam AI",      name: "Bulbul v2",                            charPer1M: 18.1,  notes: "₹15/10k chars @₹83/USD · Indian langs" },
  { id: "sar-v3",         provider: "Sarvam AI",      name: "Bulbul v3 Beta",                       charPer1M: 36.1,  notes: "₹30/10k chars @₹83/USD · beta" },
];

const TELEPHONY: TelModel[] = [
  { id: "none",             provider: "None",      name: "No Telephony (web/app only)",  pricePerMin: 0 },
  // Source: twilio.com/en-us/voice/pricing (US)
  { id: "twilio-inbound",   provider: "Twilio",    name: "Inbound Local",                pricePerMin: 0.0085, notes: "Volume tiers → $0.003" },
  { id: "twilio-inbound-tf",provider: "Twilio",    name: "Inbound Toll-Free",            pricePerMin: 0.0220, notes: "Volume tiers → $0.009" },
  { id: "twilio-outbound",  provider: "Twilio",    name: "Outbound US/CA",               pricePerMin: 0.0140, notes: "Volume tiers → $0.0102" },
  { id: "twilio-sip",       provider: "Twilio",    name: "SIP Interface / BYOC",         pricePerMin: 0.0040, notes: "Use own numbers" },
  { id: "twilio-trunk-out", provider: "Twilio",    name: "Elastic SIP Outbound",         pricePerMin: 0.0011, notes: "Cheapest Twilio option" },
  // Source: plivo.com/pricing
  { id: "plivo-inbound",    provider: "Plivo",     name: "Inbound US",                   pricePerMin: 0.0030, notes: "30–70% cheaper than Twilio" },
  { id: "plivo-outbound",   provider: "Plivo",     name: "Outbound US",                  pricePerMin: 0.0055 },
  // Source: telnyx.com/pricing
  { id: "telnyx-inbound",   provider: "Telnyx",    name: "Inbound US",                   pricePerMin: 0.0020, notes: "Native LiveKit plugin; $1/mo number" },
  { id: "telnyx-outbound",  provider: "Telnyx",    name: "Outbound US",                  pricePerMin: 0.0020, notes: "Flat $0.002/min" },
  // Source: bandwidth.com/pricing
  { id: "bw-inbound",       provider: "Bandwidth", name: "Inbound (Cloud)",              pricePerMin: 0.0100, notes: "Own network; enterprise-grade" },
  { id: "bw-outbound",      provider: "Bandwidth", name: "Outbound",                     pricePerMin: 0.0100 },
];

// Source: livekit.io/pricing (March 2026)
const LIVEKIT_INFRA: InfraModel[] = [
  { id: "lk-cloud-build",  name: "LiveKit Cloud — Build",  baseMonthly: 0,   agentMinIncluded: 1000,     overagePerMin: 0.01, notes: "5 concurrent; $2.50 inference credit" },
  { id: "lk-cloud-ship",   name: "LiveKit Cloud — Ship",   baseMonthly: 50,  agentMinIncluded: 5000,     overagePerMin: 0.01, notes: "20 concurrent; $5 inference credit" },
  { id: "lk-cloud-scale",  name: "LiveKit Cloud — Scale",  baseMonthly: 500, agentMinIncluded: 50000,    overagePerMin: 0.01, notes: "600 concurrent; $50 inference credit" },
  { id: "lk-self-small",   name: "Self-Host — Small VPS",  baseMonthly: 50,  agentMinIncluded: Infinity, overagePerMin: 0,    notes: "4-core/8GB · ~25 concurrent" },
  { id: "lk-self-medium",  name: "Self-Host — Medium",     baseMonthly: 450, agentMinIncluded: Infinity, overagePerMin: 0,    notes: "~100 concurrent (multi-server)" },
  { id: "lk-self-gpu",     name: "Self-Host — GPU Server", baseMonthly: 200, agentMinIncluded: Infinity, overagePerMin: 0,    notes: "For local LLM/TTS; RTX equiv." },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function calcTTSPerMin(m: TTSModel): number {
  if (m.pricePerMin !== undefined) return m.pricePerMin;
  return (AVG_CHARS_PER_MIN / 1_000_000) * (m.charPer1M ?? 0);
}

function calcLLMPerMin(m: LLMModel): number {
  return (AVG_INPUT_TOKENS_PER_MIN / 1_000_000) * m.inputPer1M +
         (AVG_OUTPUT_TOKENS_PER_MIN / 1_000_000) * m.outputPer1M;
}

function calcInfraPerMin(m: InfraModel, mm: number): number {
  if (!mm) return 0;
  const overage = Math.max(0, mm - m.agentMinIncluded);
  return (m.baseMonthly + overage * m.overagePerMin) / mm;
}

function groupBy<T extends { provider: string }>(arr: T[]): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    (acc[item.provider] = acc[item.provider] ?? []).push(item);
    return acc;
  }, {});
}

function fmt(n: number): string {
  return n < 0.0001 ? n.toExponential(2) : n.toFixed(4);
}
function fmtMo(n: number): string {
  return n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : "$" + n.toFixed(0);
}

const PROVIDER_DOT: Record<string, string> = {
  "Deepgram": "#3B82F6", "AssemblyAI": "#60A5FA", "Google Cloud": "#FBBF24",
  "Google Gemini": "#10B981", "Amazon": "#F97316", "Microsoft Azure": "#6366F1",
  "LiveKit": "#8B5CF6", "OpenAI": "#059669", "Groq": "#EF4444", "xAI": "#6B7280",
  "ElevenLabs": "#F472B6", "Cartesia": "#7C3AED", "Sarvam AI": "#D97706",
  "Twilio": "#EC4899", "Plivo": "#14B8A6", "Telnyx": "#0EA5E9",
  "Bandwidth": "#7C3AED", "None": "#CBD5E1", "LiveKit Infra": "#8B5CF6",
};

const LAYER_COLORS: Record<string, string> = {
  STT: "#3B82F6", LLM: "#7C3AED", TTS: "#F59E0B", Telephony: "#10B981", Infra: "#9CA3AF",
};

const TABS: TabKey[] = ["STT", "LLM", "TTS", "Telephony", "Infra"];

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

interface LayerSelectProps<T extends AnyModel> {
  label: string; models: T[]; value: string;
  onChange: (id: string) => void; calcFn: (m: T) => number;
}

function LayerSelect<T extends AnyModel>({ label, models, value, onChange, calcFn }: LayerSelectProps<T>) {
  const isInfra = "baseMonthly" in (models[0] ?? {});
  const groups: Record<string, T[]> = isInfra
    ? { "LiveKit Infra": models }
    : groupBy(models as (T & { provider: string })[]);

  const sel = models.find((m) => m.id === value);
  const selectId = `sel-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="grid grid-cols-[96px_1fr] items-start gap-x-3">
      <label htmlFor={selectId} className="text-[11px] text-gray-400 font-medium pt-3 text-right leading-none">{label}</label>
      <div>
        <div className="relative">
          <select id={selectId} value={value} onChange={(e) => onChange(e.target.value)} title={label}
            className="w-full appearance-none bg-white border border-gray-200 hover:border-gray-300 text-gray-800 text-sm rounded-lg px-3 py-2.5 pr-7 focus:outline-none focus:ring-2 focus:ring-gray-200 cursor-pointer transition-all">
            {Object.entries(groups).map(([prov, items]) => (
              <optgroup key={prov} label={prov}>
                {(items as T[]).map((m) => (
                  <option key={m.id} value={m.id}>{m.name} — ${fmt(calcFn(m))}/min</option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">▾</span>
        </div>
        {sel?.notes && <p className="text-[11px] text-gray-400 mt-1 ml-0.5">{sel.notes}</p>}
      </div>
    </div>
  );
}

interface StackBarProps { stt: number; llm: number; tts: number; tel: number; infra: number; total: number }

function StackBar({ stt, llm, tts, tel, infra, total }: StackBarProps) {
  if (total === 0) return null;
  const segs = [
    { key: "STT", val: stt }, { key: "LLM", val: llm },
    { key: "TTS", val: tts }, { key: "Telephony", val: tel }, { key: "Infra", val: infra },
  ].filter((s) => s.val > 0);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
        {segs.map((s) => (
          <div key={s.key} className="h-full transition-all duration-500"
            style={{ width: `${(s.val / total) * 100}%`, background: LAYER_COLORS[s.key] }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segs.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LAYER_COLORS[s.key] }} />
            {s.key} <span className="font-mono text-gray-700">${fmt(s.val)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

interface PanelSelections { stt: string; llm: string; tts: string; tel: string; infra: string }
interface PanelSetters { stt:(v:string)=>void; llm:(v:string)=>void; tts:(v:string)=>void; tel:(v:string)=>void; infra:(v:string)=>void }
interface PanelProps { label: string; accent: string; sel: PanelSelections; set: PanelSetters; monthlyMin: number }

function Panel({ label, accent, sel, set, monthlyMin }: PanelProps) {
  const costs = useMemo(() => {
    const s  = STT_MODELS.find((m) => m.id === sel.stt)?.pricePerMin ?? 0;
    const lm = LLM_MODELS.find((m) => m.id === sel.llm);
    const tm = TTS_MODELS.find((m) => m.id === sel.tts);
    const p  = TELEPHONY.find((m)  => m.id === sel.tel)?.pricePerMin ?? 0;
    const im = LIVEKIT_INFRA.find((m) => m.id === sel.infra);
    const l  = lm ? calcLLMPerMin(lm) : 0;
    const t  = tm ? calcTTSPerMin(tm) : 0;
    const i  = im ? calcInfraPerMin(im, monthlyMin) : 0;
    const total = s + l + t + p + i;
    return { s, l, t, p, i, total };
  }, [sel.stt, sel.llm, sel.tts, sel.tel, sel.infra, monthlyMin]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
      <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <span className={`w-6 h-6 rounded-full ${accent} flex items-center justify-center text-[11px] font-bold text-white`}>{label}</span>
          <span className="text-xs font-medium text-gray-400 tracking-wide uppercase">Scenario {label}</span>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black text-gray-900 tabular-nums leading-none">${fmt(costs.total)}</div>
          <div className="text-[11px] text-gray-400 mt-1">per minute</div>
        </div>
      </div>
      <div className="px-6 py-5 flex flex-col gap-3.5">
        <LayerSelect<STTModel>   label="STT"       models={STT_MODELS}    value={sel.stt}   onChange={set.stt}   calcFn={(m) => m.pricePerMin} />
        <LayerSelect<LLMModel>   label="LLM"       models={LLM_MODELS}    value={sel.llm}   onChange={set.llm}   calcFn={calcLLMPerMin} />
        <LayerSelect<TTSModel>   label="TTS"       models={TTS_MODELS}    value={sel.tts}   onChange={set.tts}   calcFn={calcTTSPerMin} />
        <LayerSelect<TelModel>   label="Telephony" models={TELEPHONY}     value={sel.tel}   onChange={set.tel}   calcFn={(m) => m.pricePerMin} />
        <LayerSelect<InfraModel> label="Infra"     models={LIVEKIT_INFRA} value={sel.infra} onChange={set.infra} calcFn={(m) => calcInfraPerMin(m, monthlyMin)} />
      </div>
      <div className="px-6 py-4 border-t border-gray-100">
        <StackBar stt={costs.s} llm={costs.l} tts={costs.t} tel={costs.p} infra={costs.i} total={costs.total} />
      </div>
      <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
        <span className="text-[11px] text-gray-400">{monthlyMin.toLocaleString()} min/mo</span>
        <span className="text-lg font-black text-gray-900 tabular-nums">
          {fmtMo(costs.total * monthlyMin)}<span className="text-xs text-gray-400 font-normal ml-1">/mo</span>
        </span>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

interface TabData { models: AnyModel[]; fn: (m: AnyModel) => number }

export default function PriceComparison() {
  const [aSTT,   setASTT]   = useState("dg-nova3-mono");
  const [aLLM,   setALLM]   = useState("groq-llama70b");
  const [aTTS,   setATTS]   = useState("el-multi-biz");
  const [aTel,   setATel]   = useState("twilio-inbound");
  const [aInfra, setAInfra] = useState("lk-cloud-ship");

  const [bSTT,   setBSTT]   = useState("aai-ustream");
  const [bLLM,   setBLLM]   = useState("oai-gpt4o-mini");
  const [bTTS,   setBTTS]   = useState("gcp-wavenet");
  const [bTel,   setBTel]   = useState("telnyx-inbound");
  const [bInfra, setBInfra] = useState("lk-self-small");

  const [monthlyMin, setMonthlyMin] = useState(10000);
  const [tab, setTab] = useState<TabKey>("STT");

  const computeTotal = useCallback(
    (stt: string, llm: string, tts: string, tel: string, infra: string): number => {
      const s  = STT_MODELS.find((m) => m.id === stt)?.pricePerMin ?? 0;
      const lm = LLM_MODELS.find((m) => m.id === llm);
      const tm = TTS_MODELS.find((m) => m.id === tts);
      const p  = TELEPHONY.find((m) => m.id === tel)?.pricePerMin ?? 0;
      const im = LIVEKIT_INFRA.find((m) => m.id === infra);
      return s + (lm ? calcLLMPerMin(lm) : 0) + (tm ? calcTTSPerMin(tm) : 0) + p + (im ? calcInfraPerMin(im, monthlyMin) : 0);
    },
    [monthlyMin]
  );

  const aTotal = useMemo(() => computeTotal(aSTT, aLLM, aTTS, aTel, aInfra), [computeTotal, aSTT, aLLM, aTTS, aTel, aInfra]);
  const bTotal = useMemo(() => computeTotal(bSTT, bLLM, bTTS, bTel, bInfra), [computeTotal, bSTT, bLLM, bTTS, bTel, bInfra]);

  const diff   = Math.abs(aTotal - bTotal);
  const winner = aTotal < bTotal ? "A" : bTotal < aTotal ? "B" : null;
  const pct    = Math.max(aTotal, bTotal) > 0 ? Math.round((diff / Math.max(aTotal, bTotal)) * 100) : 0;

  const tabData: Record<TabKey, TabData> = {
    STT:       { models: STT_MODELS,    fn: (m) => (m as STTModel).pricePerMin },
    LLM:       { models: LLM_MODELS,    fn: (m) => calcLLMPerMin(m as LLMModel) },
    TTS:       { models: TTS_MODELS,    fn: (m) => calcTTSPerMin(m as TTSModel) },
    Telephony: { models: TELEPHONY,     fn: (m) => (m as TelModel).pricePerMin },
    Infra:     { models: LIVEKIT_INFRA, fn: (m) => calcInfraPerMin(m as InfraModel, monthlyMin) },
  };

  const { models: exModels, fn: exFn } = tabData[tab];
  const exSorted = [...exModels].sort((a, b) => exFn(a) - exFn(b));
  const exMax    = Math.max(...exSorted.map(exFn), 0.00001);

  const selA = new Set([aSTT, aLLM, aTTS, aTel, aInfra]);
  const selB = new Set([bSTT, bLLM, bTTS, bTel, bInfra]);

  return (
    <div className="min-h-screen bg-gray-50/80" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>

      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center shrink-0">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <rect x="1"   y="1"   width="4.5" height="4.5" rx="1" fill="white" fillOpacity=".9"/>
                <rect x="7.5" y="1"   width="4.5" height="4.5" rx="1" fill="white" fillOpacity=".45"/>
                <rect x="1"   y="7.5" width="4.5" height="4.5" rx="1" fill="white" fillOpacity=".45"/>
                <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1" fill="white" fillOpacity=".9"/>
              </svg>
            </div>
            <div>
              <span className="text-sm font-semibold text-gray-900">Voice AI Cost Calculator</span>
              <span className="hidden sm:inline text-gray-300 mx-2">·</span>
              <span className="hidden sm:inline text-xs text-gray-400">STT · LLM · TTS · Telephony · Infra</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="monthly-minutes" className="text-xs text-gray-400 hidden sm:block">Monthly minutes</label>
            <input id="monthly-minutes" type="number" value={monthlyMin} min={100} step={1000}
              title="Monthly minutes" placeholder="10000"
              onChange={(e) => setMonthlyMin(Math.max(100, Number(e.target.value)))}
              className="bg-white border border-gray-200 text-gray-800 text-sm rounded-lg px-3 py-1.5 w-28 focus:outline-none focus:ring-2 focus:ring-gray-200 font-mono tabular-nums"
            />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-7 flex flex-col gap-5">
        {winner && (
          <div className="self-start flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2">
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-black shrink-0 ${winner === "A" ? "bg-blue-500" : "bg-violet-500"}`}>{winner}</span>
            <span className="text-xs text-emerald-700 font-medium">Scenario {winner} is {pct}% cheaper</span>
            <span className="text-[11px] text-emerald-500">— saves ${fmt(diff)}/min · {fmtMo(diff * monthlyMin)}/mo</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Panel label="A" accent="bg-blue-500"
            sel={{ stt: aSTT, llm: aLLM, tts: aTTS, tel: aTel, infra: aInfra }}
            set={{ stt: setASTT, llm: setALLM, tts: setATTS, tel: setATel, infra: setAInfra }}
            monthlyMin={monthlyMin} />
          <Panel label="B" accent="bg-violet-500"
            sel={{ stt: bSTT, llm: bLLM, tts: bTTS, tel: bTel, infra: bInfra }}
            set={{ stt: setBSTT, llm: setBLLM, tts: setBTTS, tel: setBTel, infra: setBInfra }}
            monthlyMin={monthlyMin} />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-700">Rate Explorer</span>
            <div className="flex gap-1 flex-wrap" role="tablist" aria-label="Rate explorer tabs">
              {TABS.map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${tab === t ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-gray-50 overflow-y-auto" style={{ maxHeight: "320px" }}>
            {exSorted.map((m) => {
              const cost    = exFn(m);
              const pctBar  = (cost / exMax) * 100;
              const isA     = selA.has(m.id);
              const isB     = selB.has(m.id);
              const provider = "provider" in m ? (m as STTModel).provider : "LiveKit Infra";
              const dotColor = PROVIDER_DOT[provider] ?? "#94A3B8";
              return (
                <div key={m.id} className={`flex items-center gap-3 px-5 py-2.5 text-xs transition-colors ${(isA || isB) ? "bg-gray-50/70" : "hover:bg-gray-50/50"}`}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                  <span className="text-[11px] text-gray-400 w-28 shrink-0 truncate">{provider}</span>
                  <span className={`flex-1 truncate min-w-0 ${(isA || isB) ? "text-gray-800 font-medium" : "text-gray-600"}`}>
                    {m.name}
                    {m.notes && <span className="text-gray-400 font-normal ml-1.5">{m.notes}</span>}
                  </span>
                  <div className="w-20 h-0.5 bg-gray-100 rounded-full shrink-0">
                    <div className="h-full rounded-full bg-gray-400 transition-all duration-300" style={{ width: `${pctBar}%` }} />
                  </div>
                  <span className="font-mono text-gray-700 w-16 text-right shrink-0 tabular-nums">${fmt(cost)}</span>
                  <div className="flex gap-0.5 w-7 justify-end shrink-0">
                    {isA && <span className="text-[9px] text-blue-500 font-bold">A</span>}
                    {isB && <span className="text-[9px] text-violet-500 font-bold">B</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-0.5 text-[11px] text-gray-400 pb-6">
          <span>LLM: {AVG_INPUT_TOKENS_PER_MIN} in + {AVG_OUTPUT_TOKENS_PER_MIN} out tokens/min (~150 wpm)</span>
          <span>TTS: {AVG_CHARS_PER_MIN} chars/min</span>
          <span>Infra fee amortized over monthly volume</span>
          <span>INR at ₹83/USD (Sarvam AI)</span>
          <span>Prices verified March 2026 from official sources</span>
        </div>
      </main>
    </div>
  );
}