import { emptyPlan, normalizePlan, uid, type FloorPlan } from "../shared/plan";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  imageUrl?: string; // data URL preview of an attached reference image
  proposal?: FloorPlan; // a plan the agent proposed
  status?: "pending" | "accepted" | "rejected";
  error?: boolean;
}

export interface Project {
  id: string;
  plan: FloorPlan;
  messages: ChatMessage[];
  updatedAt: number;
}

const KEY = "roomwright.projects.v1";
const CURRENT = "roomwright.current.v1";

export function loadProjects(): Project[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as Project[];
    return raw.map((p) => ({ ...p, plan: normalizePlan(p.plan) }));
  } catch {
    return [];
  }
}

export function saveProjects(list: Project[]) {
  try {
    // Don't persist image previews; they can blow the storage quota.
    const slim = list.map((p) => ({ ...p, messages: p.messages.map(({ imageUrl: _drop, ...m }) => m) }));
    localStorage.setItem(KEY, JSON.stringify(slim));
  } catch {
    /* storage full or unavailable */
  }
}

export function loadCurrentId(): string | null {
  try {
    return localStorage.getItem(CURRENT);
  } catch {
    return null;
  }
}

export function saveCurrentId(id: string) {
  try {
    localStorage.setItem(CURRENT, id);
  } catch {
    /* ignore */
  }
}

export const newProject = (): Project => ({ id: uid("proj"), plan: emptyPlan(), messages: [], updatedAt: Date.now() });
