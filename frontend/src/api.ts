// Thin wrapper over pywebview's JS bridge + a tiny event bus
// for Python-pushed events (Python calls window.__emit(...) via evaluate_js).

export type Segment = {
  start: number;
  end: number;
  text: string;
  avg_logprob: number;
  no_speech_prob: number;
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
  type: "official" | "fine-tune";
  description: string;
  default?: boolean;
  present: boolean;
  size_on_disk: number;
  active: boolean;
};

export type LanguageOption = { code: string; name: string };

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
  | { status: "language_detected"; language: string | null }
  | { status: "done"; duration: number; language?: string | null; model_id?: string }
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
    return (await ready()).list_models();
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
  async getServerUrl(): Promise<string | null> {
    return (await ready()).get_server_url();
  },
  async saveText(content: string, defaultName: string): Promise<string | null> {
    return (await ready()).save_text(content, defaultName);
  },
};
