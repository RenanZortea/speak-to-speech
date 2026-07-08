// Thin wrapper over pywebview's JS bridge + a tiny event bus
// for Python-pushed events (Python calls window.__emit(...) via evaluate_js).

import type { Correction } from "./corrections";

export type Word = {
  start: number;
  end: number;
  word: string;
  probability: number;
};

export type Segment = {
  start: number;
  end: number;
  text: string;
  avg_logprob: number;
  no_speech_prob: number;
  words?: Word[]; // optional — sessions saved before word-timestamps lack it
};

export type GpuInfo = {
  cuda_available: boolean;
  device_count?: number;
  error?: string;
};

export type ModelCheck = {
  active_model_id: string;
  active_language: string;
  present: boolean;
  model_loaded: boolean;
  current_model_id: string | null;
  gpu: GpuInfo;
};

export type CatalogModel = {
  id: string;
  name: string;
  publisher: string;
  languages: string[];
  size_bytes: number;
  type: "official" | "fine-tune" | "custom";
  description: string;
  default?: boolean;
  present: boolean;
  // Present = bytes on disk. Usable = also loadable by faster-whisper (has
  // CTranslate2 model.bin). A Transformers-format repo is present but not usable.
  // Optional: older backends omit it — api.listModels() backfills from `present`.
  usable?: boolean;
  size_on_disk: number;
  active: boolean;
};

export type LanguageOption = { code: string; name: string };

export type Phoneme = {
  symbol: string;
  start: number;
  end: number;
  confidence: number;
};

export type PronModelCheck = {
  model_id: string;
  present: boolean;
  loaded: boolean;
};

export type PronStatusEvent =
  | { status: "loading_model" }
  | { status: "converting" }
  | { status: "analyzing" }
  | { status: "done"; phonemes: Phoneme[]; mean_confidence: number; duration: number }
  | { status: "error"; error: string };

export type PronunciationResult = { phonemes: Phoneme[]; mean_confidence: number };

export type SessionSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  duration: number | null;
  has_pronunciation: boolean;
};

export type FullSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  audio_stored_path: string | null;
  audio_url: string | null;
  language: string | null;
  model_id: string | null;
  duration: number | null;
  segments: Segment[];
  pronunciation: PronunciationResult | null;
  corrections?: Correction[];
};

export type GpuStats = {
  available: boolean;
  name?: string;
  gpu_util?: number;
  vram_used?: number;
  vram_total?: number;
};

export type ResourceStats = {
  cpu_percent: number;
  cpu_count: number;
  ram_percent: number;
  ram_used: number;
  ram_total: number;
  proc_ram: number;
  gpu: GpuStats;
};

export type Settings = {
  version: string;
  cpu_threads: number;
  cpu_count: number;
  release_when_idle: boolean;
  whisper_loaded: boolean;
  pron_loaded: boolean;
  models_dir: string;
  models_dir_custom: boolean;
};

export type UpdateInfo = {
  update_available: boolean;
  current_version: string;
  latest_version?: string;
  notes?: string;
  html_url?: string;
  download_url?: string;
  error?: string;
};

export type SaveSessionData = {
  title?: string;
  audio_path: string;
  language?: string;
  model_id?: string;
  duration?: number;
  segments: Segment[];
  pronunciation: PronunciationResult | null;
  corrections?: Correction[];
};

export type PickResult = { path: string; url: string } | null;

export type ModelDownloadEvent =
  | { model_id: string; status: "downloading"; bytes: number }
  | { model_id: string; status: "complete"; path: string; bytes: number }
  | { model_id: string; status: "cancelled"; bytes: number }
  | { model_id: string; status: "error"; error: string };

export type ModelLoadStatusEvent =
  | { model_id: string; status: "loading" }
  | { model_id: string; status: "loaded" }
  | { model_id: string; status: "error"; error: string };

export type TranscribeStatusEvent =
  | { status: "loading_model"; model_id?: string }
  | { status: "transcribing" }
  | { status: "low_memory_retry" }
  | { status: "language_detected"; language: string | null }
  | { status: "done"; duration: number; language?: string | null; model_id?: string }
  | { status: "error"; error: string };

export type OllamaModels = {
  url: string;
  models: string[];
  selected?: string | null;
  error?: string;
};

export type OllamaStatusEvent =
  | { status: "generating"; model: string }
  | { status: "done"; text: string }
  | { status: "error"; error: string };

type Listener = (payload: any) => void;
const listeners = new Map<string, Set<Listener>>();

declare global {
  interface Window {
    pywebview?: { api: any };
    __emit: (event: string, payload: any) => void;
  }
}

window.__emit = (event, payload) => {
  listeners.get(event)?.forEach((fn) => fn(payload));
};

export function on(event: string, fn: Listener): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
  return () => listeners.get(event)!.delete(fn);
}

async function ready(): Promise<any> {
  // pywebview sets `window.pywebview.api = {}` immediately on injection, then
  // populates methods asynchronously via _createApi(). Checking for the
  // existence of a known method avoids the race where `api` exists but is
  // still the empty placeholder.
  const start = Date.now();
  while (typeof window.pywebview?.api?.check_model !== "function") {
    if (Date.now() - start > 15000) {
      throw new Error(
        "pywebview bridge did not initialize within 15s. Did the Python window start? Is the Api class importable?",
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return window.pywebview.api;
}

export const api = {
  async checkModel(): Promise<ModelCheck> {
    return (await ready()).check_model();
  },
  async downloadModel(): Promise<{ started: boolean }> {
    return (await ready()).download_model();
  },
  async pickAudio(): Promise<PickResult> {
    return (await ready()).pick_audio_file();
  },
  async transcribe(
    path: string,
    options: { temperature?: number; model_id?: string; language?: string } = {},
  ): Promise<{ started: boolean; model_id?: string; language?: string }> {
    return (await ready()).transcribe(path, options);
  },
  async listModels(): Promise<CatalogModel[]> {
    const models = (await (await ready()).list_models()) as CatalogModel[];
    // Defensive: an older backend won't send `usable`. Fall back to `present`
    // so a field mismatch can't mislabel every model as unusable.
    return models.map((m) => ({ ...m, usable: m.usable ?? m.present }));
  },
  async getLanguages(): Promise<LanguageOption[]> {
    return (await ready()).get_languages();
  },
  async setActiveModel(modelId: string): Promise<{ active_model_id: string }> {
    return (await ready()).set_active_model(modelId);
  },
  async setActiveLanguage(language: string): Promise<{ active_language: string }> {
    return (await ready()).set_active_language(language);
  },
  async preloadModel(modelId?: string): Promise<{ started?: boolean; error?: string; model_id?: string }> {
    return (await ready()).preload_model(modelId);
  },
  async downloadModelById(modelId?: string): Promise<{ started: boolean; model_id?: string }> {
    return (await ready()).download_model(modelId);
  },
  async deleteModel(modelId: string): Promise<{ deleted: boolean; model_id: string }> {
    return (await ready()).delete_model(modelId);
  },
  async cancelDownload(modelId: string): Promise<{ cancelled: boolean; model_id: string }> {
    return (await ready()).cancel_download(modelId);
  },
  async checkPronModel(): Promise<PronModelCheck> {
    return (await ready()).check_pron_model();
  },
  async downloadPronModel(): Promise<{ started: boolean; model_id: string }> {
    return (await ready()).download_pron_model();
  },
  async cancelPronDownload(): Promise<{ cancelled: boolean }> {
    return (await ready()).cancel_pron_download();
  },
  async assessPronunciation(audioPath: string): Promise<{ started: boolean }> {
    return (await ready()).assess_pronunciation(audioPath);
  },
  async saveSession(data: SaveSessionData): Promise<SessionSummary> {
    return (await ready()).save_session(data);
  },
  async updateSession(id: string, data: Partial<SaveSessionData>): Promise<FullSession | null> {
    return (await ready()).update_session(id, data);
  },
  async listSessions(): Promise<SessionSummary[]> {
    return (await ready()).list_sessions();
  },
  async loadSession(id: string): Promise<FullSession | null> {
    return (await ready()).load_session(id);
  },
  async renameSession(id: string, title: string): Promise<{ ok: boolean }> {
    return (await ready()).rename_session(id, title);
  },
  async deleteSession(id: string): Promise<{ ok: boolean }> {
    return (await ready()).delete_session(id);
  },
  async getSettings(): Promise<Settings> {
    return (await ready()).get_settings();
  },
  async setCpuThreads(n: number): Promise<{ cpu_threads: number }> {
    return (await ready()).set_cpu_threads(n);
  },
  async setReleaseWhenIdle(enabled: boolean): Promise<{ release_when_idle: boolean }> {
    return (await ready()).set_release_when_idle(enabled);
  },
  async unloadAllModels(): Promise<{ whisper_loaded: boolean; pron_loaded: boolean }> {
    return (await ready()).unload_all_models();
  },
  async chooseModelsDir(): Promise<{ models_dir: string; changed: boolean } | null> {
    return (await ready()).choose_models_dir();
  },
  async resetModelsDir(): Promise<{ models_dir: string; changed: boolean }> {
    return (await ready()).reset_models_dir();
  },
  async checkForUpdate(): Promise<UpdateInfo> {
    return (await ready()).check_for_update();
  },
  async installUpdate(url: string): Promise<{ started: boolean }> {
    return (await ready()).install_update(url);
  },
  async getServerUrl(): Promise<string | null> {
    return (await ready()).get_server_url();
  },
  async saveText(content: string, defaultName: string): Promise<string | null> {
    return (await ready()).save_text(content, defaultName);
  },
  async ollamaListModels(): Promise<OllamaModels> {
    return (await ready()).ollama_list_models();
  },
  async setOllamaModel(model: string): Promise<{ selected: string | null }> {
    return (await ready()).set_ollama_model(model);
  },
  async ollamaCorrect(prompt: string, model: string): Promise<{ started: boolean; model: string }> {
    return (await ready()).ollama_correct(prompt, model);
  },
};
