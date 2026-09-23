import type { CreateMonitorInput, UpdateMonitorInput } from "../api/monitors";
import type { ApiMonitor, MonitorType } from "../api/types";
import { Collapsible, Field, FieldGroup, HeadersEditor, inputClass, TagsInput, type HeaderRow } from "./forms";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

// Métodos que llevan cuerpo. HEAD/GET con body es algo que ni la mitad de
// los servidores aceptan, así que el campo ni se enseña.
const METHODS_WITH_BODY = new Set<string>(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Estado del formulario de un monitor, compartido por "Nuevo monitor" y por
 * la edición desde la vista de detalle — son el mismo formulario con el tipo
 * bloqueado o no, y mantenerlos por separado era justo lo que hacía que la
 * edición se quedara atrás (solo nombre e intervalo).
 *
 * Todo son strings o listas, no el tipo final: un `<input type="number">`
 * vacío es "" y no 0, y las cabeceras se editan como pares ordenados aunque
 * acaben siendo un objeto. La conversión al contrato de la API pasa por
 * `toCreateInput`/`toUpdateInput`.
 */
export interface MonitorFormValues {
  name: string;
  type: MonitorType;
  target: string;
  method: string;
  headers: HeaderRow[];
  body: string;
  expectedStatus: string;
  intervalSeconds: number;
  timeoutMs: number;
  tags: string[];
  /** Etiqueta a medio escribir, todavía sin confirmar con Enter. */
  pendingTag: string;
}

export function emptyMonitorForm(): MonitorFormValues {
  return {
    name: "",
    type: "http",
    target: "",
    method: "GET",
    headers: [],
    body: "",
    expectedStatus: "",
    intervalSeconds: 300,
    timeoutMs: 5000,
    tags: [],
    pendingTag: "",
  };
}

export function monitorToForm(monitor: ApiMonitor): MonitorFormValues {
  return {
    name: monitor.name,
    type: monitor.type,
    target: monitor.target,
    method: monitor.method ?? "GET",
    headers: Object.entries(monitor.headers ?? {}).map(([key, value]) => ({ key, value })),
    body: monitor.body ?? "",
    expectedStatus: monitor.expectedStatus != null ? String(monitor.expectedStatus) : "",
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    tags: monitor.tags ?? [],
    pendingTag: "",
  };
}

/**
 * Da por buena la etiqueta a medio escribir. Se llama al enviar: quien
 * escribe "producción" y pulsa directamente "Guardar" espera que cuente, no
 * que desaparezca por no haber pulsado Enter antes.
 */
export function commitPendingTag(values: MonitorFormValues): MonitorFormValues {
  const pending = values.pendingTag.trim();
  if (!pending || values.tags.includes(pending)) return { ...values, pendingTag: "" };
  return { ...values, tags: [...values.tags, pending], pendingTag: "" };
}

// Solo las filas con nombre; una cabecera sin nombre es una fila que se
// empezó a escribir y se dejó a medias, no un dato.
function headersToObject(rows: HeaderRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.filter((row) => row.key.trim() !== "").map((row) => [row.key.trim(), row.value])
  );
}

export function toCreateInput(values: MonitorFormValues): CreateMonitorInput {
  const base: CreateMonitorInput = {
    name: values.name.trim(),
    type: values.type,
    target: values.target.trim(),
    intervalSeconds: values.intervalSeconds,
    timeoutMs: values.timeoutMs,
    tags: values.tags,
  };
  if (values.type !== "http") return base;

  const headers = headersToObject(values.headers);
  return {
    ...base,
    method: values.method,
    // `undefined` = no mandar el campo. La API rechaza un objeto de
    // cabeceras vacío tan mal como uno lleno de basura, pero enviar `{}` y
    // `""` deja al monitor con datos que no significan nada.
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: METHODS_WITH_BODY.has(values.method) && values.body !== "" ? values.body : undefined,
    expectedStatus: values.expectedStatus ? Number(values.expectedStatus) : undefined,
  };
}

/**
 * Patch completo: todos los campos editables van siempre, con `null` donde
 * el formulario los dejó vacíos. Mandar solo "lo que cambió" obligaría a
 * comparar contra el monitor original en cada campo y, sobre todo, haría
 * imposible distinguir "no lo toques" de "bórralo".
 */
export function toUpdateInput(values: MonitorFormValues): UpdateMonitorInput {
  const base: UpdateMonitorInput = {
    name: values.name.trim(),
    target: values.target.trim(),
    intervalSeconds: values.intervalSeconds,
    timeoutMs: values.timeoutMs,
    tags: values.tags,
  };
  if (values.type !== "http") return base;

  const headers = headersToObject(values.headers);
  return {
    ...base,
    method: values.method,
    headers: Object.keys(headers).length > 0 ? headers : null,
    body: METHODS_WITH_BODY.has(values.method) && values.body !== "" ? values.body : null,
    expectedStatus: values.expectedStatus ? Number(values.expectedStatus) : null,
  };
}

export function targetLabel(type: MonitorType): string {
  return type === "tcp" ? "Host:puerto" : type === "ping" ? "Host o IP" : "URL";
}

function targetPlaceholder(type: MonitorType): string {
  return type === "http" ? "https://ejemplo.com" : type === "tcp" ? "ejemplo.com:443" : "ejemplo.com";
}

/**
 * Los campos de un monitor, sin botones ni `<form>`: los pone quien lo usa,
 * que es lo único que cambia entre crear (con selector de tipo) y editar
 * (con el tipo fijo, porque cambiarlo cambiaría el significado de todo el
 * historial de checks que ya tiene).
 */
export function MonitorFormFields({
  values,
  onChange,
  typeLocked = false,
  tagSuggestions = [],
}: {
  values: MonitorFormValues;
  /**
   * Recibe una FUNCIÓN de actualización, no el valor ya calculado. Con el
   * valor, dos cambios dentro del mismo manejador se pisan: el campo de
   * etiquetas confirma una etiqueta (`tags`) y acto seguido vacía lo que se
   * estaba escribiendo (`pendingTag`), y el segundo, calculado sobre el
   * `values` de un render que ya está obsoleto, devolvía `tags` a su valor
   * anterior — la etiqueta recién añadida desaparecía sin más.
   */
  onChange: (update: (previous: MonitorFormValues) => MonitorFormValues) => void;
  typeLocked?: boolean;
  tagSuggestions?: string[];
}) {
  function set<K extends keyof MonitorFormValues>(key: K, value: MonitorFormValues[K]): void {
    onChange((previous) => ({ ...previous, [key]: value }));
  }

  const isHttp = values.type === "http";
  const hasAdvanced =
    values.headers.length > 0 || values.body !== "" || (values.method !== "GET" && values.method !== "");

  return (
    <>
      <Field label="Nombre">
        <input
          id="monitor-name"
          required
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Tipo">
        {typeLocked ? (
          <p className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-400">
            {values.type.toUpperCase()} — el tipo no se puede cambiar después de crear el monitor.
          </p>
        ) : (
          <select
            id="monitor-type"
            value={values.type}
            onChange={(e) => set("type", e.target.value as MonitorType)}
            className={inputClass}
          >
            <option value="http">HTTP</option>
            <option value="tcp">TCP</option>
            <option value="ping">Ping (ICMP)</option>
          </select>
        )}
      </Field>

      <Field label={targetLabel(values.type)}>
        <input
          id="monitor-target"
          required
          value={values.target}
          onChange={(e) => set("target", e.target.value)}
          placeholder={targetPlaceholder(values.type)}
          className={inputClass}
        />
      </Field>

      {isHttp && (
        <>
          <Field
            label="Status HTTP esperado"
            hint="Opcional. Si no se indica, cualquier status < 400 cuenta como operativo."
          >
            <input
              id="monitor-expected-status"
              inputMode="numeric"
              value={values.expectedStatus}
              onChange={(e) => set("expectedStatus", e.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder="200"
              className={inputClass}
            />
          </Field>

          <Collapsible summary="Petición HTTP (método, cabeceras, body)" defaultOpen={hasAdvanced}>
            <Field label="Método">
              <select
                id="monitor-method"
                value={values.method}
                onChange={(e) => set("method", e.target.value)}
                className={inputClass}
              >
                {HTTP_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </Field>

            <FieldGroup label="Cabeceras personalizadas">
              <HeadersEditor rows={values.headers} onChange={(rows) => set("headers", rows)} />
            </FieldGroup>

            {METHODS_WITH_BODY.has(values.method) && (
              <Field label="Body" hint="Se envía tal cual; si es JSON, acuérdate de la cabecera Content-Type.">
                <textarea
                  id="monitor-body"
                  rows={4}
                  value={values.body}
                  onChange={(e) => set("body", e.target.value)}
                  placeholder='{"ping":"pong"}'
                  className={`${inputClass} font-mono text-sm`}
                />
              </Field>
            )}
          </Collapsible>
        </>
      )}

      <Field label="Intervalo en segundos" hint="Mínimo 30.">
        <input
          id="monitor-interval"
          type="number"
          min={30}
          required
          value={values.intervalSeconds}
          onChange={(e) => set("intervalSeconds", Number(e.target.value))}
          className={inputClass}
        />
      </Field>

      <Field label="Timeout en milisegundos">
        <input
          id="monitor-timeout"
          type="number"
          min={1000}
          required
          value={values.timeoutMs}
          onChange={(e) => set("timeoutMs", Number(e.target.value))}
          className={inputClass}
        />
      </Field>

      <FieldGroup
        label="Etiquetas"
        htmlFor="monitor-tags"
        hint="Para agrupar y filtrar en el dashboard. Enter o coma para añadir."
      >
        <TagsInput
          id="monitor-tags"
          value={values.tags}
          onChange={(tags) => set("tags", tags)}
          pending={values.pendingTag}
          onPendingChange={(raw) => set("pendingTag", raw)}
          suggestions={tagSuggestions}
        />
      </FieldGroup>
    </>
  );
}
