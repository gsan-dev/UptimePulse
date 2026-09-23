import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { createMonitor, listMonitors } from "../api/monitors";
import { FormError } from "../components/FormError";
import {
  commitPendingTag,
  emptyMonitorForm,
  MonitorFormFields,
  toCreateInput,
  type MonitorFormValues,
} from "../components/MonitorFormFields";
import { collectTags } from "../lib/tags";

export function NewMonitorPage() {
  const navigate = useNavigate();
  const [values, setValues] = useState<MonitorFormValues>(emptyMonitorForm);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Las etiquetas que ya existen en la organización se ofrecen como
  // sugerencias: sin esto es demasiado fácil acabar con "produccion",
  // "producción" y "prod" como tres grupos distintos. Si falla, el campo
  // sigue funcionando a mano.
  useEffect(() => {
    let cancelled = false;
    void listMonitors()
      .then((monitors) => {
        if (!cancelled) setTagSuggestions(collectTags(monitors));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const submitted = commitPendingTag(values);
    setValues(submitted);
    try {
      await createMonitor(toCreateInput(submitted));
      navigate("/monitors");
    } catch (err) {
      setError(err instanceof ApiError ? err : "No se pudo crear el monitor");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-white">Nuevo monitor</h1>
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6"
      >
        <FormError error={error} />

        <MonitorFormFields values={values} onChange={setValues} tagSuggestions={tagSuggestions} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {isSubmitting ? "Creando…" : "Crear monitor"}
        </button>
      </form>
    </div>
  );
}
