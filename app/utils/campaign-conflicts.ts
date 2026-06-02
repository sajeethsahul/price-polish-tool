import type { PricingPreviewItem, ScheduledProductSnapshot } from "../types/pricing";
import type { CampaignConflict, CampaignConflictCampaign, CampaignConflictSeverity, CampaignConflictType } from "../types/pricing";

export type ScheduledJobLike = {
  id: string;
  campaignId?: string | null;
  title: string;
  status: string;
  runAt: string;
  mode?: "one-time" | "time-window" | string;
  windowEndAt?: string | null;
  products?: ScheduledProductSnapshot[] | null;
};

export type CandidateScheduleLike = {
  title: string;
  status?: string;
  mode: "one-time" | "time-window";
  runAt: string;
  windowEndAt?: string | null;
  products: Array<{
    productId?: string | null;
    variantId?: string | null;
  }>;
};

type ScopeSets = {
  productIds: Set<string>;
  variantIds: Set<string>;
};

const CONFLICT_NEARBY_WINDOW_MS = 30 * 60 * 1000;

function toMs(value: string | null | undefined) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function normalizeEnd(startMs: number, endMs: number) {
  return endMs > startMs ? endMs : startMs + 1;
}

function scheduleTypeFromMode(mode: string | null | undefined): CampaignConflictCampaign["scheduleType"] {
  const normalized = (mode ?? "").toLowerCase();
  if (normalized === "one-time") return "one-time";
  if (normalized === "time-window") return "time-window";
  return "unknown";
}

function buildScopeFromItems(items: Array<{ productId?: string | null; variantId?: string | null }>) {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();

  for (const item of items) {
    const productId = String(item.productId ?? "").trim();
    const variantId = String(item.variantId ?? "").trim();
    if (productId) productIds.add(productId);
    if (variantId) variantIds.add(variantId);
  }

  return { productIds, variantIds };
}

function buildScopeFromPreviewItems(items: PricingPreviewItem[]) {
  return buildScopeFromItems(items.map((item) => ({ productId: item.productId, variantId: item.variantId })));
}

function buildScopeFromScheduledProducts(items: ScheduledProductSnapshot[] | null | undefined) {
  return buildScopeFromItems(Array.isArray(items) ? items : []);
}

function intersect(a: Set<string>, b: Set<string>) {
  const out: string[] = [];
  for (const value of a) {
    if (b.has(value)) out.push(value);
  }
  return out;
}

function windowsOverlap(candidate: { startMs: number; endMs: number }, existing: { startMs: number; endMs: number }) {
  return candidate.startMs < existing.endMs && candidate.endMs > existing.startMs;
}

function overlapsScope(candidate: ScopeSets, existing: ScopeSets) {
  const hasVariantScope =
    candidate.variantIds.size > 0 &&
    existing.variantIds.size > 0 &&
    candidate.variantIds.size === candidate.productIds.size &&
    existing.variantIds.size === existing.productIds.size;

  const overlappingVariantIds = intersect(candidate.variantIds, existing.variantIds);
  const overlappingProductIds = intersect(candidate.productIds, existing.productIds);

  const overlaps = hasVariantScope ? overlappingVariantIds.length > 0 : overlappingProductIds.length > 0;

  return {
    overlaps,
    overlappingVariantIds,
    overlappingProductIds,
  };
}

function resolveConflictSeverity(type: CampaignConflictType, context: { existingStatus: string }) {
  if (type === "active-window-overlap") return "critical" satisfies CampaignConflictSeverity;
  if (type === "window-overlap") return "warning" satisfies CampaignConflictSeverity;
  if (type === "scope-overlap") return "warning" satisfies CampaignConflictSeverity;
  if (type === "exact-time-overlap") return "warning" satisfies CampaignConflictSeverity;
  if (type === "nearby-time-overlap") return "info" satisfies CampaignConflictSeverity;
  if (type === "restore-window-overlap") return "info" satisfies CampaignConflictSeverity;
  return context.existingStatus.toLowerCase() === "active-window"
    ? ("critical" satisfies CampaignConflictSeverity)
    : ("warning" satisfies CampaignConflictSeverity);
}

function buildCampaignDescriptor(params: {
  scheduledJobId?: string | null;
  campaignId?: string | null;
  title: string;
  status: string;
  mode?: string | null;
  runAt: string | null;
  windowEndAt: string | null;
}): CampaignConflictCampaign {
  return {
    scheduledJobId: params.scheduledJobId ?? null,
    campaignId: params.campaignId ?? null,
    title: params.title,
    status: params.status,
    scheduleType: scheduleTypeFromMode(params.mode),
    startAt: params.runAt,
    endAt: params.windowEndAt,
  };
}

function computeConflictTypes(params: {
  candidateStartMs: number;
  candidateEndMs: number;
  existingStartMs: number;
  existingEndMs: number;
  existingStatus: string;
  candidateMode: "one-time" | "time-window";
  existingMode: string | null | undefined;
}) {
  const types: CampaignConflictType[] = [];

  types.push("window-overlap");

  const candidateMinute = Math.floor(params.candidateStartMs / 60000);
  const existingMinute = Math.floor(params.existingStartMs / 60000);

  if (candidateMinute === existingMinute) {
    types.push("exact-time-overlap");
  } else {
    const deltaMs = Math.abs(params.existingStartMs - params.candidateStartMs);
    if (deltaMs > 0 && deltaMs <= CONFLICT_NEARBY_WINDOW_MS) {
      types.push("nearby-time-overlap");
    }
  }

  if (params.existingStatus.toLowerCase() === "active-window") {
    types.push("active-window-overlap");
  }

  if (
    params.candidateMode === "time-window" &&
    (params.existingMode ?? "").toLowerCase() === "time-window"
  ) {
    types.push("restore-window-overlap");
  }

  return types;
}

function pushConflict(params: {
  out: CampaignConflict[];
  type: CampaignConflictType;
  primary: CampaignConflictCampaign;
  conflicting: CampaignConflictCampaign;
  affectedProductIds: string[];
  affectedVariantIds: string[];
  existingStatus: string;
}) {
  const id = [
    params.primary.scheduledJobId ?? params.primary.campaignId ?? "primary",
    params.conflicting.scheduledJobId ?? params.conflicting.campaignId ?? "conflict",
    params.type,
  ].join(":");

  params.out.push({
    id,
    conflictType: params.type,
    severity: resolveConflictSeverity(params.type, { existingStatus: params.existingStatus }),
    primary: params.primary,
    conflicting: params.conflicting,
    affectedProductIds: params.affectedProductIds,
    affectedVariantIds: params.affectedVariantIds,
    affectedProductCount: params.affectedProductIds.length,
    affectedVariantCount: params.affectedVariantIds.length,
  });
}

export function computeConflictsForCandidateSchedule(candidate: CandidateScheduleLike, jobs: ScheduledJobLike[]) {
  const conflicts: CampaignConflict[] = [];

  const startMs = toMs(candidate.runAt);
  if (startMs == null) return conflicts;

  const endMsRaw = candidate.mode === "time-window" ? toMs(candidate.windowEndAt ?? null) : startMs;
  const endMs = normalizeEnd(startMs, endMsRaw ?? startMs);

  const candidateScope = buildScopeFromItems(candidate.products);

  for (const job of jobs) {
    const jobStartMs = toMs(job.runAt);
    if (jobStartMs == null) continue;
    const jobEndRaw = (job.mode ?? "").toLowerCase() === "time-window" ? toMs(job.windowEndAt ?? null) : jobStartMs;
    const jobEndMs = normalizeEnd(jobStartMs, jobEndRaw ?? jobStartMs);

    if (!windowsOverlap({ startMs, endMs }, { startMs: jobStartMs, endMs: jobEndMs })) continue;

    const jobScope = buildScopeFromScheduledProducts(job.products);
    const scope = overlapsScope(candidateScope, jobScope);
    if (!scope.overlaps) continue;

    const primary = buildCampaignDescriptor({
      title: candidate.title,
      status: candidate.status ?? "pending",
      mode: candidate.mode,
      runAt: candidate.runAt,
      windowEndAt: candidate.mode === "time-window" ? (candidate.windowEndAt ?? null) : null,
    });
    const conflicting = buildCampaignDescriptor({
      scheduledJobId: job.id,
      campaignId: job.campaignId ?? null,
      title: job.title || "Scheduled Campaign",
      status: job.status,
      mode: job.mode ?? null,
      runAt: job.runAt,
      windowEndAt: job.windowEndAt ?? null,
    });

    const types = computeConflictTypes({
      candidateStartMs: startMs,
      candidateEndMs: endMs,
      existingStartMs: jobStartMs,
      existingEndMs: jobEndMs,
      existingStatus: job.status,
      candidateMode: candidate.mode,
      existingMode: job.mode,
    });

    pushConflict({
      out: conflicts,
      type: "scope-overlap",
      primary,
      conflicting,
      affectedProductIds: scope.overlappingProductIds,
      affectedVariantIds: scope.overlappingVariantIds,
      existingStatus: job.status,
    });

    for (const type of types) {
      pushConflict({
        out: conflicts,
        type,
        primary,
        conflicting,
        affectedProductIds: scope.overlappingProductIds,
        affectedVariantIds: scope.overlappingVariantIds,
        existingStatus: job.status,
      });
    }
  }

  return conflicts;
}

export function computeConflictsBetweenScheduledJobs(jobs: ScheduledJobLike[]) {
  const byJobId = new Map<string, CampaignConflict[]>();

  const parsed = jobs
    .map((job) => {
      const startMs = toMs(job.runAt);
      if (startMs == null) return null;
      const endRaw = (job.mode ?? "").toLowerCase() === "time-window" ? toMs(job.windowEndAt ?? null) : startMs;
      const endMs = normalizeEnd(startMs, endRaw ?? startMs);
      return { job, startMs, endMs, scope: buildScopeFromScheduledProducts(job.products) };
    })
    .filter(Boolean) as Array<{ job: ScheduledJobLike; startMs: number; endMs: number; scope: ScopeSets }>;

  for (const item of parsed) {
    byJobId.set(item.job.id, []);
  }

  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const a = parsed[i];
      const b = parsed[j];

      if (!windowsOverlap({ startMs: a.startMs, endMs: a.endMs }, { startMs: b.startMs, endMs: b.endMs })) continue;

      const scopeAB = overlapsScope(a.scope, b.scope);
      if (!scopeAB.overlaps) continue;

      const primaryA = buildCampaignDescriptor({
        scheduledJobId: a.job.id,
        campaignId: a.job.campaignId ?? null,
        title: a.job.title || "Scheduled Campaign",
        status: a.job.status,
        mode: a.job.mode ?? null,
        runAt: a.job.runAt,
        windowEndAt: a.job.windowEndAt ?? null,
      });
      const primaryB = buildCampaignDescriptor({
        scheduledJobId: b.job.id,
        campaignId: b.job.campaignId ?? null,
        title: b.job.title || "Scheduled Campaign",
        status: b.job.status,
        mode: b.job.mode ?? null,
        runAt: b.job.runAt,
        windowEndAt: b.job.windowEndAt ?? null,
      });

      const typesAB = computeConflictTypes({
        candidateStartMs: a.startMs,
        candidateEndMs: a.endMs,
        existingStartMs: b.startMs,
        existingEndMs: b.endMs,
        existingStatus: b.job.status,
        candidateMode: scheduleTypeFromMode(a.job.mode) === "time-window" ? "time-window" : "one-time",
        existingMode: b.job.mode,
      });
      const typesBA = computeConflictTypes({
        candidateStartMs: b.startMs,
        candidateEndMs: b.endMs,
        existingStartMs: a.startMs,
        existingEndMs: a.endMs,
        existingStatus: a.job.status,
        candidateMode: scheduleTypeFromMode(b.job.mode) === "time-window" ? "time-window" : "one-time",
        existingMode: a.job.mode,
      });

      const conflictsA = byJobId.get(a.job.id) ?? [];
      const conflictsB = byJobId.get(b.job.id) ?? [];

      pushConflict({
        out: conflictsA,
        type: "scope-overlap",
        primary: primaryA,
        conflicting: primaryB,
        affectedProductIds: scopeAB.overlappingProductIds,
        affectedVariantIds: scopeAB.overlappingVariantIds,
        existingStatus: b.job.status,
      });
      pushConflict({
        out: conflictsB,
        type: "scope-overlap",
        primary: primaryB,
        conflicting: primaryA,
        affectedProductIds: scopeAB.overlappingProductIds,
        affectedVariantIds: scopeAB.overlappingVariantIds,
        existingStatus: a.job.status,
      });

      for (const type of typesAB) {
        pushConflict({
          out: conflictsA,
          type,
          primary: primaryA,
          conflicting: primaryB,
          affectedProductIds: scopeAB.overlappingProductIds,
          affectedVariantIds: scopeAB.overlappingVariantIds,
          existingStatus: b.job.status,
        });
      }
      for (const type of typesBA) {
        pushConflict({
          out: conflictsB,
          type,
          primary: primaryB,
          conflicting: primaryA,
          affectedProductIds: scopeAB.overlappingProductIds,
          affectedVariantIds: scopeAB.overlappingVariantIds,
          existingStatus: a.job.status,
        });
      }

      byJobId.set(a.job.id, conflictsA);
      byJobId.set(b.job.id, conflictsB);
    }
  }

  return byJobId;
}

export function maxSeverity(conflicts: CampaignConflict[]): CampaignConflictSeverity | null {
  if (conflicts.length === 0) return null;
  if (conflicts.some((c) => c.severity === "critical")) return "critical";
  if (conflicts.some((c) => c.severity === "warning")) return "warning";
  return "info";
}

export function conflictTone(severity: CampaignConflictSeverity): "info" | "warning" | "critical" {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  return "info";
}
