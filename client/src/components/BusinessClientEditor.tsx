import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BUSINESS_CLIENT_FIELDS,
  BUSINESS_CLIENT_FIELD_LABELS,
  type BusinessClientField,
  type BusinessClientValues,
} from "@/lib/businessRecords";

type Props = {
  values: BusinessClientValues;
  extraFields: Record<string, string>;
  onValuesChange: (values: BusinessClientValues) => void;
  onExtraFieldsChange: (fields: Record<string, string>) => void;
  prefix: string;
};

export default function BusinessClientEditor({
  values,
  extraFields,
  onValuesChange,
  onExtraFieldsChange,
  prefix,
}: Props) {
  const extraRows = useMemo(() => Object.entries(extraFields), [extraFields]);
  const updateValue = (field: BusinessClientField, value: string) => {
    onValuesChange({ ...values, [field]: value });
  };
  const updateExtra = (oldName: string, name: string, value: string) => {
    const next: Record<string, string> = {};
    for (const [key, existing] of extraRows) {
      if (key === oldName) {
        let cleanName = name.trim() || oldName;
        if (cleanName !== oldName && Object.hasOwn(extraFields, cleanName)) {
          let suffix = 2;
          while (Object.hasOwn(extraFields, `${cleanName} (${suffix})`)) suffix += 1;
          cleanName = `${cleanName} (${suffix})`;
        }
        next[cleanName] = value;
      } else {
        next[key] = existing;
      }
    }
    onExtraFieldsChange(next);
  };
  const removeExtra = (name: string) => {
    const next = { ...extraFields };
    delete next[name];
    onExtraFieldsChange(next);
  };
  const addExtra = () => {
    let index = extraRows.length + 1;
    let name = `Campo adicional ${index}`;
    while (Object.hasOwn(extraFields, name)) {
      index += 1;
      name = `Campo adicional ${index}`;
    }
    onExtraFieldsChange({ ...extraFields, [name]: "" });
  };

  return <div className="business-field-editor">
    <div className="business-field-grid">
      {BUSINESS_CLIENT_FIELDS.map((field) => <label className={`business-field business-field-${field}`} key={field}>
        <span>{BUSINESS_CLIENT_FIELD_LABELS[field]}</span>
        {field === "notes"
          ? <textarea id={`${prefix}-${field}`} value={values[field] ?? ""} onChange={(event) => updateValue(field, event.target.value)} rows={3} />
          : <input id={`${prefix}-${field}`} value={values[field] ?? ""} onChange={(event) => updateValue(field, event.target.value)} autoComplete={field === "email" ? "email" : field === "phone" || field === "whatsapp" ? "tel" : "off"} />}
      </label>)}
    </div>
    <section className="business-extra-fields" aria-label="Campos extras importados ou manuais">
      <div className="business-extra-heading"><strong>Campos adicionais</strong><Button type="button" variant="outline" size="sm" onClick={addExtra}><Plus size={14} /> Adicionar campo</Button></div>
      {extraRows.length === 0 && <small>Campos extras encontrados no arquivo serão preservados aqui.</small>}
      {extraRows.map(([name, value], index) => <div className="business-extra-row" key={`${name}-${index}`}>
        <label><span>Campo</span><input aria-label={`Nome do campo adicional ${index + 1}`} value={name} onChange={(event) => updateExtra(name, event.target.value, value)} /></label>
        <label><span>Valor</span><input aria-label={`Valor do campo adicional ${index + 1}`} value={value} onChange={(event) => updateExtra(name, name, event.target.value)} /></label>
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => removeExtra(name)} aria-label={`Remover campo ${name}`}><Trash2 size={15} /></Button>
      </div>)}
    </section>
  </div>;
}
