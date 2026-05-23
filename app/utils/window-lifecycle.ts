export type WindowLifecycleState =
  | "scheduled-window"
  | "active-window"
  | "expired-window"
  | "restoring"
  | "auto-restored"
  | "window-stopped"
  | "cancelled-window";

export type WindowTimingInput = {
  runAt: Date | string | null | undefined;
  windowEndAt: Date | string | null | undefined;
};

export type ResolveWindowLifecycleInput = WindowTimingInput & {
  status?: string | null;
  source?: string | null;
  restoredAt?: Date | string | null;
  totalTrackedCount?: number;
  revertedCount?: number;
  unrecoverableCount?: number;
};

function toTime(value: Date | string | null | undefined) {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function isTimeWindowRecord(input: { status?: string | null; source?: string | null }) {
  const status = normalize(input.status);
  const source = normalize(input.source);
  return source === "schedule-window" || status.includes("window");
}

export function resolveWindowLifecycleState(
  window: ResolveWindowLifecycleInput,
  now: Date = new Date()
): WindowLifecycleState | null {
  if (!isTimeWindowRecord(window)) return null;

  const status = normalize(window.status);
  if (status === "cancelled-window" || status === "cancelled") {
    return "cancelled-window";
  }
  if (status === "window-stopped") {
    return "window-stopped";
  }

  const startMs = toTime(window.runAt);
  const endMs = toTime(window.windowEndAt);
  if (startMs == null || endMs == null || endMs <= startMs) return null;

  const nowMs = now.getTime();
  if (nowMs < startMs) return "scheduled-window";
  if (nowMs < endMs) return "active-window";

  if (status === "restoring") return "restoring";

  const totalTrackedCount = window.totalTrackedCount ?? 0;
  const completedRestoreCount = (window.revertedCount ?? 0) + (window.unrecoverableCount ?? 0);
  const hasCompletedRestore =
    status === "auto-restored" ||
    status === "window-stopped" ||
    Boolean(window.restoredAt) ||
    (totalTrackedCount > 0 && completedRestoreCount >= totalTrackedCount);

  return hasCompletedRestore ? "auto-restored" : "expired-window";
}

export function isWindowActive(window: ResolveWindowLifecycleInput, now: Date = new Date()) {
  return resolveWindowLifecycleState(window, now) === "active-window";
}

export function isWindowExpired(window: ResolveWindowLifecycleInput, now: Date = new Date()) {
  const state = resolveWindowLifecycleState(window, now);
  return state === "expired-window" || state === "restoring" || state === "auto-restored";
}
