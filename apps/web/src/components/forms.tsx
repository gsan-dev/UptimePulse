import { useState, type KeyboardEvent, type ReactNode } from "react";

// Estilo compartido por todos los campos de texto de la aplicación. Vivía
// copiado y pegado en cada página; aquí está una sola vez para que un cambio
// de aspecto no haya que perseguirlo por seis archivos.
export const inputClass =
  "w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-emerald-500";

/**
 * Un campo con UN solo control dentro: el `<label>` lo envuelve, que es la
 * forma más robusta de asociarlos (no hace falta un `id` único).
 *
 * La pista va FUERA del `<label>`: dentro pasa a formar parte del nombre
 * accesible del control, y un lector de pantalla acaba anunciando "Status
 * HTTP esperado Opcional. Si no se indica, cualquier status menor que 400…"
 * como si fuera el nombre del campo.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-sm text-gray-400">{label}</span>
        {children}
      </label>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/**
 * Lo mismo para un GRUPO de controles (varias filas de cabeceras, una lista
 * de checkboxes, un campo con botones al lado).
 *
 * Aquí el `<label>` envolvente no vale: un `<label>` solo puede etiquetar a
 * un control, y todo lo demás que haya dentro —incluidos los botones— hereda
 * su texto como nombre accesible. Es decir: el botón "+ Añadir cabecera"
 * pasaba a llamarse "Cabeceras personalizadas" para cualquier lector de
 * pantalla (y para cualquier test que lo buscara por su nombre). Con
 * `htmlFor` se etiqueta explícitamente al control principal del grupo, si lo
 * hay; si no, el texto es solo un encabezado.
 */
export function FieldGroup({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block text-sm text-gray-400">
          {label}
        </label>
      ) : (
        <span className="block text-sm text-gray-400">{label}</span>
      )}
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/**
 * Etiquetas como "chips": se escribe y se confirma con Enter o coma, y cada
 * una se quita con su ✕. Es un `<input>` normal por debajo, así que el
 * teclado y el autocompletado del navegador siguen funcionando.
 *
 * Lo que se esté escribiendo SIN confirmar también cuenta al guardar (ver
 * `commitPendingTag` en quien lo usa): escribir "producción" y pulsar
 * "Guardar" sin darle antes a Enter es el error más fácil de cometer aquí, y
 * perder la etiqueta en silencio sería lo peor que podría pasar.
 */
export function TagsInput({
  value,
  onChange,
  pending,
  onPendingChange,
  suggestions = [],
  id,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  pending: string;
  onPendingChange: (raw: string) => void;
  suggestions?: string[];
  id?: string;
}) {
  const listId = id ? `${id}-suggestions` : undefined;
  const available = suggestions.filter((tag) => !value.includes(tag));

  function addTag(raw: string): void {
    const tag = raw.trim();
    if (!tag || value.includes(tag)) {
      onPendingChange("");
      return;
    }
    onChange([...value, tag]);
    onPendingChange("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === ",") {
      // Enter dentro de un formulario lo enviaría; aquí significa "confirma
      // esta etiqueta".
      event.preventDefault();
      addTag(pending);
      return;
    }
    if (event.key === "Backspace" && pending === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300"
          >
            {tag}
            <button
              type="button"
              aria-label={`Quitar la etiqueta ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="text-emerald-400/70 hover:text-emerald-200"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <input
        id={id}
        list={listId}
        value={pending}
        onChange={(e) => onPendingChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addTag(pending)}
        placeholder="producción, api, cliente-acme…"
        className={inputClass}
      />
      {listId && available.length > 0 && (
        <datalist id={listId}>
          {available.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      )}
    </div>
  );
}

export interface HeaderRow {
  key: string;
  value: string;
}

/** Cabeceras HTTP personalizadas como pares nombre/valor. */
export function HeadersEditor({
  rows,
  onChange,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
}) {
  function update(index: number, patch: Partial<HeaderRow>): void {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex gap-2">
          <input
            value={row.key}
            onChange={(e) => update(index, { key: e.target.value })}
            placeholder="Authorization"
            aria-label={`Nombre de la cabecera ${index + 1}`}
            className={inputClass}
          />
          <input
            value={row.value}
            onChange={(e) => update(index, { value: e.target.value })}
            placeholder="Bearer …"
            aria-label={`Valor de la cabecera ${index + 1}`}
            className={inputClass}
          />
          <button
            type="button"
            aria-label={`Quitar la cabecera ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            className="shrink-0 rounded-md border border-white/10 px-3 text-gray-400 hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
        className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5"
      >
        + Añadir cabecera
      </button>
    </div>
  );
}

/**
 * Bloque plegable, para lo que la mayoría de la gente no necesita tocar
 * (método, cabeceras, body). Abierto de entrada si ya trae algo dentro: un
 * monitor con cabeceras configuradas no debe esconderlas al editarlo.
 */
export function Collapsible({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-white/10">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/5"
      >
        {summary}
        <span className="text-gray-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="space-y-4 border-t border-white/10 p-3">{children}</div>}
    </div>
  );
}
