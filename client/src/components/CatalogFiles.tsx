import { useState } from "react";
import { Download, FileArchive, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProductCatalogFile } from "@/lib/catalogFiles";

type CatalogFilesProps = {
  files: ProductCatalogFile[];
  disabled?: boolean;
  onUpload: (files: File[]) => void | Promise<void>;
  onDownload: (file: ProductCatalogFile) => void;
  onDelete: (file: ProductCatalogFile) => void;
};

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024)
    return `${(size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
  return `${(size / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

export default function CatalogFiles({
  files,
  disabled = false,
  onUpload,
  onDownload,
  onDelete,
}: CatalogFilesProps) {
  const [uploading, setUploading] = useState(false);

  return (
    <section
      className="memory-settings"
      aria-labelledby="catalog-files-heading"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <strong id="catalog-files-heading">
            <FileArchive
              size={17}
              style={{ verticalAlign: "middle", marginRight: 6 }}
            />
            Arquivos originais ({files.length})
          </strong>
          <p style={{ marginTop: 6 }}>
            Guarde aqui PDFs, arquivos Office, imagens e outros formatos
            diretamente do computador. O arquivo original fica em uma coleção
            local separada; isso não cria nem altera produtos e não usa Drive.
          </p>
        </div>
        <label className="button-like" aria-disabled={disabled || uploading}>
          <Upload size={15} /> Upload do computador
          <input
            type="file"
            multiple
            accept="*/*"
            hidden
            disabled={disabled || uploading}
            onChange={(event) => {
              const selected = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (!selected.length) return;
              setUploading(true);
              void Promise.resolve(onUpload(selected)).finally(() =>
                setUploading(false),
              );
            }}
          />
        </label>
      </div>
      <small>
        Até 50 MB por arquivo. Os bytes originais são arquivados neste
        dispositivo, sem envio automático.
      </small>
      {files.length === 0 ? (
        <small>Nenhum arquivo original arquivado.</small>
      ) : (
        [...files]
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .map((file) => (
            <div className="memory-row" key={file.id}>
              <span>
                <b>{file.name}</b>
                <br />
                <small>
                  {file.mime} · {formatBytes(file.size)} ·{" "}
                  {new Date(file.createdAt).toLocaleString("pt-BR")}
                </small>
              </span>
              <div style={{ display: "flex", flexShrink: 0, gap: 3 }}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onDownload(file)}
                  aria-label={`Baixar original ${file.name}`}
                  title="Baixar original"
                >
                  <Download size={15} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    const confirmed = window.confirm(
                      `Excluir somente “${file.name}” dos arquivos originais deste dispositivo? Produtos e outros arquivos não serão alterados.`,
                    );
                    if (confirmed) onDelete(file);
                  }}
                  aria-label={`Excluir original ${file.name}`}
                  title="Excluir arquivo original"
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          ))
      )}
    </section>
  );
}
