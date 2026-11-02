import type { FieldValue, FormState } from './form'

export function FormPanel({ form, onChange }: { form: FormState; onChange: (f: FormState) => void }) {
  const set = (name: string, v: FieldValue) => onChange({ ...form, values: { ...form.values, [name]: v } })
  const changed = form.fields.filter(f => form.values[f.name] !== form.initial[f.name]).length
  return (
    <details className="panel" open>
      <summary className="panel-head">
        <h3>Form fields <span className="muted">· {form.fields.length}{changed ? `, ${changed} changed` : ''}</span></h3>
      </summary>
      <p className="hint">Values are written into the PDF's form when you save.</p>
      {form.fields.map(f => {
        const v = form.values[f.name]
        if (f.type === 'checkbox')
          return (
            <label key={f.name} className="check">
              <input type="checkbox" checked={!!v} onChange={e => set(f.name, e.target.checked)} />
              {f.name}
            </label>
          )
        return (
          <label key={f.name} className="field">
            {f.name}
            {f.type === 'text' ? (
              f.multiline ? (
                <textarea rows={3} value={String(v)} onChange={e => set(f.name, e.target.value)} />
              ) : (
                <input value={String(v)} onChange={e => set(f.name, e.target.value)} />
              )
            ) : (
              <select value={String(v)} onChange={e => set(f.name, e.target.value)}>
                <option value="">—</option>
                {f.options!.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            )}
          </label>
        )
      })}
      <label className="check">
        <input type="checkbox" checked={form.flatten} onChange={e => onChange({ ...form, flatten: e.target.checked })} />
        Flatten form (make fields non-editable)
      </label>
    </details>
  )
}
