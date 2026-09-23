/**
 * Filtro por etiquetas del dashboard: cada etiqueta es un botón que se
 * activa y desactiva, y varias activas se combinan en Y (ver `filterByTags`).
 * No se enseña nada si la organización todavía no usa etiquetas — un filtro
 * vacío solo estorba.
 */
export function TagFilter({
  tags,
  selected,
  onChange,
}: {
  tags: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  if (tags.length === 0) return null;

  function toggle(tag: string): void {
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-sm text-gray-400">Etiquetas:</span>
      {tags.map((tag) => {
        const isActive = selected.includes(tag);
        return (
          <button
            key={tag}
            onClick={() => toggle(tag)}
            aria-pressed={isActive}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              isActive
                ? "border-emerald-500 bg-emerald-600 text-white"
                : "border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
            }`}
          >
            {tag}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="text-xs text-gray-400 underline hover:text-white"
        >
          Quitar filtro
        </button>
      )}
    </div>
  );
}
