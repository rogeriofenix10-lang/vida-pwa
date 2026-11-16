import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  countUniqueCatalogImportAdds,
  type CatalogImportProduct,
  type Product,
} from "@/lib/catalogImport";

type CatalogImportPreviewProps = {
  fileName: string;
  incoming: CatalogImportProduct[];
  existing: Product[];
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function CatalogImportPreview({
  fileName,
  incoming,
  existing,
  disabled = false,
  onConfirm,
  onCancel,
}: CatalogImportPreviewProps) {
  const plannedAdds = useMemo(
    () => countUniqueCatalogImportAdds(existing, incoming),
    [existing, incoming],
  );
  const duplicates = incoming.length - plannedAdds;
  const examples = incoming.slice(0, 5);

  return (
    <section
      className="notification-settings"
      aria-labelledby="catalog-import-preview-heading"
    >
      <strong id="catalog-import-preview-heading">
        Prévia da importação · {fileName}
      </strong>
      <p>
        {incoming.length} linha(s) reconhecida(s); {plannedAdds} produto(s)
        novo(s) serão acrescentados e {duplicates} duplicado(s) exato(s) serão
        ignorados. Produtos existentes não serão substituídos. Nada foi salvo
        ainda.
      </p>
      <div
        style={{ display: "grid", gap: 6, maxHeight: 250, overflow: "auto" }}
      >
        {examples.map((product, index) => (
          <div
            className="memory-row"
            key={`${product.name}-${index}`}
            style={{ display: "block" }}
          >
            <b>{product.name}</b>
            <br />
            <small>
              {product.code || "Sem código"} ·{" "}
              {product.category || "Sem categoria"} · Preço:{" "}
              {product.price || "—"} · Estoque: {product.stock || "—"}
            </small>
            {product.description && (
              <small
                style={{
                  display: "block",
                  marginTop: 3,
                  whiteSpace: "pre-wrap",
                }}
              >
                {product.description}
              </small>
            )}
          </div>
        ))}
        {incoming.length > examples.length && (
          <small>
            Mais {incoming.length - examples.length} produto(s) serão incluídos
            após confirmação.
          </small>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          type="button"
          disabled={disabled || plannedAdds === 0}
          onClick={onConfirm}
        >
          <Check size={15} /> Confirmar importação
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={onCancel}
        >
          <X size={15} /> Cancelar
        </Button>
      </div>
    </section>
  );
}
