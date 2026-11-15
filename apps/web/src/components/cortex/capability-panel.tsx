"use client";

import Link from "next/link";
import { useId, useMemo, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Database,
  FileText,
  ListPlus,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  CAPABILITIES,
  LOBES,
  LOBE_BY_ID,
  capabilitiesIn,
  type Capability,
  type FieldSpec,
  type FileIntake,
  type IntakeKind,
  type Lobe,
  type MetadataIntake,
} from "@/lib/cortex/capabilities";
import { stagedFor, useCortex, type StagedItem } from "@/store/cortex-store";

const TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function matchesAccept(file: File, accept: string): boolean {
  const name = file.name.toLowerCase();
  return accept
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry.startsWith(".") && name.endsWith(entry));
}

const KIND_LABEL: Record<IntakeKind, string> = {
  data: "Data",
  document: "Document",
  metadata: "Details",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10.5px] font-semibold tracking-[0.14em] text-mist uppercase">
      {children}
    </h3>
  );
}

function LobeChip({ lobe }: { lobe: Lobe }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: lobe.tint, color: lobe.ink }}
    >
      <span className="size-1.5 rounded-full" style={{ background: lobe.ink }} />
      {lobe.name}
      <span className="font-medium opacity-80">· {lobe.role}</span>
    </span>
  );
}

// ── File intake ─────────────────────────────────────────────────────────────

function Dropzone({
  intake,
  kind,
  lobe,
  onFiles,
}: {
  intake: FileIntake;
  kind: "data" | "document";
  lobe: Lobe;
  onFiles: (files: File[]) => void;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const Icon = kind === "data" ? Database : FileText;

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    const ok = files.filter((file) => matchesAccept(file, intake.accept));
    setRejected(files.filter((file) => !ok.includes(file)).map((file) => file.name));
    if (ok.length > 0) onFiles(ok);
  };

  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files);
        }}
        className="group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-xl border border-dashed px-3.5 py-3 transition-colors focus-within:outline-2 focus-within:outline-offset-2"
        style={{
          borderColor: over ? lobe.ink : "color-mix(in oklab, var(--color-line) 100%, transparent)",
          background: over ? lobe.tint : "rgba(255,255,255,0.65)",
          outlineColor: lobe.ink,
        }}
      >
        <input
          id={inputId}
          type="file"
          multiple
          accept={intake.accept}
          className="sr-only"
          onChange={(event) => {
            take(event.target.files);
            event.target.value = "";
          }}
        />
        <span
          className="mt-0.5 grid size-8 place-items-center rounded-lg"
          style={{ background: lobe.tint, color: lobe.ink }}
        >
          <Icon className="size-4" />
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-rock">{intake.label}</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-rock px-2 py-1 text-[11px] font-semibold text-white">
              <Upload className="size-3" />
              Choose files
            </span>
          </span>
          <span className="text-[12px] leading-snug text-shale">{intake.hint}</span>
          <span className="font-mono text-[10.5px] text-mist">
            {intake.formats} · or drop them here
          </span>
        </span>
      </label>
      {rejected.length > 0 && (
        <p className="text-[11.5px] text-signal-rose" role="alert">
          Not added: {rejected.join(", ")}. This pin takes {intake.formats}.
        </p>
      )}
    </div>
  );
}

// ── Metadata intake ─────────────────────────────────────────────────────────

const INPUT =
  "h-9 w-full min-w-0 rounded-lg border border-line bg-white px-2.5 text-[13px] text-rock outline-none transition-[border-color,box-shadow] focus:border-rock/60 focus:shadow-[0_0_0_3px_rgba(7,8,8,0.08)]";

function Field({
  spec,
  value,
  onChange,
  inputId,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (value: string) => void;
  inputId: string;
}) {
  if (spec.type === "select") {
    return (
      <select id={inputId} className={INPUT} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {spec.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (spec.type === "textarea") {
    return (
      <textarea
        id={inputId}
        rows={3}
        className={`${INPUT} h-auto resize-y py-2 leading-snug`}
        placeholder={spec.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <div className="relative">
      <input
        id={inputId}
        type={spec.type}
        inputMode={spec.type === "number" ? "decimal" : undefined}
        className={`${INPUT} ${spec.unit ? "pr-8" : ""}`}
        placeholder={spec.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {spec.unit && (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px] text-mist">
          {spec.unit}
        </span>
      )}
    </div>
  );
}

function MetadataForm({
  capability,
  intake,
  lobe,
}: {
  capability: Capability;
  intake: MetadataIntake;
  lobe: Lobe;
}) {
  const formId = useId();
  const stageMetadata = useCortex((state) => state.stageMetadata);
  const empty = useMemo(
    () => Object.fromEntries(intake.fields.map((field) => [field.id, ""])) as Record<string, string>,
    [intake.fields],
  );
  const [values, setValues] = useState<Record<string, string>>(empty);
  const [missing, setMissing] = useState<string[]>([]);
  const [added, setAdded] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const gaps = intake.fields
      .filter((field) => field.required && !values[field.id]?.trim())
      .map((field) => field.label);
    setMissing(gaps);
    if (gaps.length > 0) {
      setAdded(null);
      return;
    }
    const filled = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value.trim() !== ""),
    );
    const name = values[intake.titleField]?.trim() || capability.name;
    stageMetadata(capability.id, name, filled);
    setValues(empty);
    setAdded(name);
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-3 rounded-xl border border-line bg-white/65 px-3.5 py-3"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <span
          className="mt-0.5 grid size-8 place-items-center rounded-lg"
          style={{ background: lobe.tint, color: lobe.ink }}
        >
          <ListPlus className="size-4" />
        </span>
        <span className="grid gap-0.5">
          <span className="text-[13px] font-semibold text-rock">{intake.label}</span>
          <span className="text-[12px] leading-snug text-shale">{intake.hint}</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {intake.fields.map((field) => {
          const inputId = `${formId}-${field.id}`;
          return (
            <div key={field.id} className={`grid min-w-0 gap-1 ${field.wide ? "col-span-2" : ""}`}>
              <label htmlFor={inputId} className="text-[11.5px] font-medium text-shale">
                {field.label}
                {field.required && <span className="text-signal-amber"> *</span>}
              </label>
              <Field
                spec={field}
                inputId={inputId}
                value={values[field.id] ?? ""}
                onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
              />
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-h-4 text-[11.5px]" aria-live="polite">
          {missing.length > 0 ? (
            <span className="text-signal-rose">Fill in {missing.join(" and ")}.</span>
          ) : added ? (
            <span className="text-carbon-400">Staged “{added}”.</span>
          ) : null}
        </p>
        <button
          type="submit"
          className="h-9 rounded-lg bg-rock px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-rock/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rock"
        >
          {intake.submitLabel}
        </button>
      </div>
    </form>
  );
}

// ── Staged list ─────────────────────────────────────────────────────────────

function describe(item: StagedItem, capability: Capability): string {
  if (item.kind !== "metadata") {
    return [KIND_LABEL[item.kind], formatBytes(item.size)].filter(Boolean).join(" · ");
  }
  const intake = capability.metadata;
  if (!intake || !item.fields) return KIND_LABEL.metadata;
  return intake.fields
    .filter((field) => field.id !== intake.titleField && item.fields?.[field.id])
    .slice(0, 3)
    .map((field) => `${field.label}: ${item.fields?.[field.id]}${field.unit ? ` ${field.unit}` : ""}`)
    .join(" · ") || KIND_LABEL.metadata;
}

function StagedList({ capability, lobe }: { capability: Capability; lobe: Lobe }) {
  const staged = useCortex((state) => state.staged);
  const unstage = useCortex((state) => state.unstage);
  const items = stagedFor(staged, capability.id);

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-[12.5px] text-shale">
        Nothing staged for {capability.name} yet. What you add above appears here.
      </p>
    );
  }

  return (
    <ul className="grid gap-1.5">
      {items.map((item) => {
        const Icon = item.kind === "data" ? Database : item.kind === "document" ? FileText : ListPlus;
        return (
          <li
            key={item.id}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-line bg-white px-2.5 py-2"
          >
            <span
              className="grid size-7 place-items-center rounded-md"
              style={{ background: lobe.tint, color: lobe.ink }}
            >
              <Icon className="size-3.5" />
            </span>
            <span className="grid min-w-0">
              <span className="truncate text-[12.5px] font-semibold text-rock" title={item.name}>
                {item.name}
              </span>
              <span className="truncate text-[11px] text-mist">
                {describe(item, capability)} · {TIME.format(new Date(item.addedAt))}
              </span>
            </span>
            <button
              type="button"
              onClick={() => unstage(item.id)}
              aria-label={`Remove ${item.name}`}
              className="grid size-7 place-items-center rounded-md text-mist transition-colors hover:bg-ink-700 hover:text-rock focus-visible:outline-2 focus-visible:outline-rock"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Panels ──────────────────────────────────────────────────────────────────

function PanelFrame({
  titleId,
  eyebrow,
  title,
  summary,
  onClose,
  children,
  footer,
}: {
  titleId: string;
  eyebrow: React.ReactNode;
  title: string;
  summary: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="hairline flex items-start justify-between gap-3 border-b px-5 pt-5 pb-4">
        <div className="grid min-w-0 gap-2">
          <div>{eyebrow}</div>
          <h2 id={titleId} className="text-[24px] leading-tight font-semibold tracking-tight text-rock">
            {title}
          </h2>
          <p className="text-[13.5px] leading-snug text-shale">{summary}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-shale transition-colors hover:bg-ink-700 hover:text-rock focus-visible:outline-2 focus-visible:outline-rock"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="scroll-slim grid min-h-0 flex-1 content-start gap-6 overflow-y-auto px-5 py-5">
        {children}
      </div>
      {footer && (
        <footer className="hairline flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-[11.5px]">
          {footer}
        </footer>
      )}
    </div>
  );
}

export function CapabilityPanel({ capability }: { capability: Capability }) {
  const titleId = useId();
  const lobe = LOBE_BY_ID[capability.lobe];
  const select = useCortex((state) => state.select);
  const stageFiles = useCortex((state) => state.stageFiles);
  const siblings = capabilitiesIn(capability.lobe).filter((item) => item.id !== capability.id);

  return (
    <PanelFrame
      titleId={titleId}
      eyebrow={<LobeChip lobe={lobe} />}
      title={capability.name}
      summary={capability.summary}
      onClose={() => select(null)}
      footer={
        <>
          <span className="min-w-0 text-mist">
            In Sentinel today: <code className="font-mono text-[11px] text-shale">{capability.source}</code>
          </span>
          {capability.consoleHref && (
            <Link
              href={capability.consoleHref}
              className="inline-flex shrink-0 items-center gap-1 font-semibold text-rock underline-offset-2 hover:underline"
            >
              Current console
              <ArrowUpRight className="size-3.5" />
            </Link>
          )}
        </>
      }
    >
      <section className="grid gap-2.5">
        <SectionTitle>What Cortex learns</SectionTitle>
        <ul className="grid gap-1.5">
          {capability.learns.map((line) => (
            <li key={line} className="grid grid-cols-[10px_minmax(0,1fr)] items-baseline gap-2 text-[13px] text-rock">
              <span className="size-1.5 translate-y-[-1px] rounded-full" style={{ background: lobe.ink }} />
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <SectionTitle>Teach Cortex</SectionTitle>
          <span className="text-[11px] text-mist">Stays in this browser for now</span>
        </div>
        {capability.data && (
          <Dropzone
            intake={capability.data}
            kind="data"
            lobe={lobe}
            onFiles={(files) => stageFiles(capability.id, "data", files)}
          />
        )}
        {capability.document && (
          <Dropzone
            intake={capability.document}
            kind="document"
            lobe={lobe}
            onFiles={(files) => stageFiles(capability.id, "document", files)}
          />
        )}
        {capability.metadata && (
          <MetadataForm
            key={capability.id}
            capability={capability}
            intake={capability.metadata}
            lobe={lobe}
          />
        )}
      </section>

      <section className="grid gap-2.5">
        <SectionTitle>Staged for {capability.name}</SectionTitle>
        <StagedList capability={capability} lobe={lobe} />
        <p className="text-[11.5px] leading-snug text-mist">
          Files are listed, not uploaded. The new Cortex backend will take what is staged here.
        </p>
      </section>

      {siblings.length > 0 && (
        <section className="grid gap-2">
          <SectionTitle>Also in {lobe.name}</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {siblings.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => select(item.id)}
                className="rounded-full border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-rock transition-colors hover:border-rock/40 focus-visible:outline-2 focus-visible:outline-rock"
              >
                {item.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </PanelFrame>
  );
}

export function CorePanel() {
  const titleId = useId();
  const select = useCortex((state) => state.select);
  const staged = useCortex((state) => state.staged);

  const totals = useMemo(() => {
    const byKind: Record<IntakeKind, number> = { data: 0, document: 0, metadata: 0 };
    for (const item of staged) byKind[item.kind] += 1;
    return byKind;
  }, [staged]);

  return (
    <PanelFrame
      titleId={titleId}
      eyebrow={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEE9FD] px-2 py-0.5 text-[11px] font-semibold text-[#5536B0]">
          <span className="size-1.5 rounded-full bg-[#5536B0]" />
          The core
        </span>
      }
      title="Cortex"
      summary="The AI expert at the centre of MinRV data quality. Every pin is a capability carried over from Data Sentinel. Feed a pin and the expert learns from it."
      onClose={() => select(null)}
    >
      <section className="grid gap-2.5">
        <SectionTitle>Staged in this browser</SectionTitle>
        <dl className="grid grid-cols-3 gap-2">
          {(["data", "document", "metadata"] as const).map((kind) => (
            <div key={kind} className="rounded-xl border border-line bg-white px-3 py-2.5">
              <dt className="text-[11px] text-mist">{kind === "data" ? "Data files" : kind === "document" ? "Documents" : "Details"}</dt>
              <dd className="tabular text-[22px] leading-tight font-semibold text-rock">{totals[kind]}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11.5px] leading-snug text-mist">
          Nothing is sent yet. The new backend will pick up what is staged here.
        </p>
      </section>

      <section className="grid gap-3">
        <SectionTitle>{CAPABILITIES.length} capabilities in six lobes</SectionTitle>
        <ul className="grid gap-3">
          {LOBES.map((lobe) => (
            <li key={lobe.id} className="grid gap-1.5">
              <div className="flex items-baseline gap-2">
                <span className="size-2 translate-y-[-1px] rounded-full" style={{ background: lobe.ink }} />
                <span className="text-[13px] font-semibold text-rock">{lobe.name}</span>
                <span className="text-[12px] text-mist">{lobe.role}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-4">
                {capabilitiesIn(lobe.id).map((item) => {
                  const count = stagedFor(staged, item.id).length;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => select(item.id)}
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1"
                      style={{ background: lobe.tint, color: lobe.ink, outlineColor: lobe.ink }}
                    >
                      {item.name}
                      {count > 0 && (
                        <span className="tabular rounded-full bg-white/80 px-1.5 text-[10.5px]">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </PanelFrame>
  );
}
