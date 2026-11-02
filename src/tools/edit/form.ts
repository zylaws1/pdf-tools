import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, type PDFForm } from 'pdf-lib'

export type FieldType = 'text' | 'checkbox' | 'dropdown' | 'radio' | 'list'
export type FieldValue = string | boolean

export interface FormField {
  name: string
  type: FieldType
  options?: string[]
  multiline?: boolean
}

export interface FormState {
  fields: FormField[]
  initial: Record<string, FieldValue>
  values: Record<string, FieldValue>
  flatten: boolean
}

export async function readForm(bytes: Uint8Array): Promise<FormState | null> {
  try {
    const form = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getForm()
    const fields: FormField[] = []
    const values: Record<string, FieldValue> = {}
    for (const f of form.getFields()) {
      const name = f.getName()
      if (f instanceof PDFTextField) {
        fields.push({ name, type: 'text', multiline: f.isMultiline() })
        values[name] = f.getText() ?? ''
      } else if (f instanceof PDFCheckBox) {
        fields.push({ name, type: 'checkbox' })
        values[name] = f.isChecked()
      } else if (f instanceof PDFDropdown) {
        fields.push({ name, type: 'dropdown', options: f.getOptions() })
        values[name] = f.getSelected()[0] ?? ''
      } else if (f instanceof PDFRadioGroup) {
        fields.push({ name, type: 'radio', options: f.getOptions() })
        values[name] = f.getSelected() ?? ''
      } else if (f instanceof PDFOptionList) {
        fields.push({ name, type: 'list', options: f.getOptions() })
        values[name] = f.getSelected()[0] ?? ''
      }
    }
    return fields.length ? { fields, initial: { ...values }, values, flatten: false } : null
  } catch {
    return null
  }
}

export function applyForm(form: PDFForm, state: FormState) {
  for (const field of state.fields) {
    const v = state.values[field.name]
    if (v === state.initial[field.name]) continue
    try {
      const f = form.getField(field.name)
      if (f instanceof PDFTextField) f.setText(String(v))
      else if (f instanceof PDFCheckBox) {
        if (v) f.check()
        else f.uncheck()
      } else if (f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup) {
        if (v) f.select(String(v))
        else if (!(f instanceof PDFRadioGroup)) f.clear()
      }
    } catch (e) {
      throw new Error(`Couldn't fill field "${field.name}": ${e instanceof Error ? e.message : e}`)
    }
  }
  if (state.flatten) form.flatten()
}
