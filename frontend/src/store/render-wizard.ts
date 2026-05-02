import { create } from "zustand";

export type AssignmentMode = "select_all" | "random_mix" | "per_video";
export type LangFilter = "ALL" | "FR" | "US";

type WizardState = {
  step: 1 | 2 | 3 | 4;

  // step 1
  selectedSourceIds: number[];
  pendingFiles: File[];

  // step 2
  uploadedSourceIds: number[];

  // step 3
  languageFilter: LangFilter;
  mode: AssignmentMode;
  randomMixK: number;
  // perVideoMatrix[sourceId] = list of templateIds
  perVideoMatrix: Record<number, number[]>;

  // step 4
  jobName: string;
  metadataEnabled: boolean;
  metadataModel: string;
  metadataCountry: string;
  metadataLanguage: string;
  metadataDateWindow: number;

  // actions
  setStep: (s: 1 | 2 | 3 | 4) => void;
  toggleSource: (id: number) => void;
  setSelectedSourceIds: (ids: number[]) => void;
  setPendingFiles: (files: File[]) => void;
  appendUploadedSourceId: (id: number) => void;
  resetUploadedSourceIds: () => void;
  setLanguageFilter: (f: LangFilter) => void;
  setMode: (m: AssignmentMode) => void;
  setRandomMixK: (k: number) => void;
  togglePerVideo: (sourceId: number, templateId: number) => void;
  setJobName: (n: string) => void;
  setMetadataEnabled: (b: boolean) => void;
  setMetadataModel: (m: string) => void;
  setMetadataCountry: (c: string) => void;
  setMetadataLanguage: (l: string) => void;
  setMetadataDateWindow: (n: number) => void;
  reset: () => void;
};

function defaultJobName(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `Render ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const initial = (): Omit<WizardState,
  | "setStep" | "toggleSource" | "setSelectedSourceIds" | "setPendingFiles"
  | "appendUploadedSourceId" | "resetUploadedSourceIds" | "setLanguageFilter"
  | "setMode" | "setRandomMixK" | "togglePerVideo" | "setJobName"
  | "setMetadataEnabled" | "setMetadataModel" | "setMetadataCountry"
  | "setMetadataLanguage" | "setMetadataDateWindow" | "reset"
> => ({
  step: 1,
  selectedSourceIds: [],
  pendingFiles: [],
  uploadedSourceIds: [],
  languageFilter: "ALL",
  mode: "select_all",
  randomMixK: 1,
  perVideoMatrix: {},
  jobName: defaultJobName(),
  metadataEnabled: false,
  metadataModel: "iPhone 17 Pro",
  metadataCountry: "USA",
  metadataLanguage: "en-US",
  metadataDateWindow: 7,
});

export const useWizardStore = create<WizardState>((set) => ({
  ...initial(),
  setStep: (s) => set({ step: s }),
  toggleSource: (id) =>
    set((state) => {
      const next = state.selectedSourceIds.includes(id)
        ? state.selectedSourceIds.filter((x) => x !== id)
        : [...state.selectedSourceIds, id];
      return { selectedSourceIds: next };
    }),
  setSelectedSourceIds: (ids) => set({ selectedSourceIds: ids }),
  setPendingFiles: (files) => set({ pendingFiles: files }),
  appendUploadedSourceId: (id) =>
    set((s) => ({
      uploadedSourceIds: [...s.uploadedSourceIds, id],
      selectedSourceIds: [...s.selectedSourceIds, id],
    })),
  resetUploadedSourceIds: () => set({ uploadedSourceIds: [] }),
  setLanguageFilter: (f) => set({ languageFilter: f }),
  setMode: (m) => set({ mode: m }),
  setRandomMixK: (k) => set({ randomMixK: k }),
  togglePerVideo: (sourceId, templateId) =>
    set((state) => {
      const current = state.perVideoMatrix[sourceId] ?? [];
      const next = current.includes(templateId)
        ? current.filter((x) => x !== templateId)
        : [...current, templateId];
      return {
        perVideoMatrix: { ...state.perVideoMatrix, [sourceId]: next },
      };
    }),
  setJobName: (n) => set({ jobName: n }),
  setMetadataEnabled: (b) => set({ metadataEnabled: b }),
  setMetadataModel: (m) => set({ metadataModel: m }),
  setMetadataCountry: (c) => set({ metadataCountry: c }),
  setMetadataLanguage: (l) => set({ metadataLanguage: l }),
  setMetadataDateWindow: (n) => set({ metadataDateWindow: n }),
  reset: () => set(initial()),
}));
