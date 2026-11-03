import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isCardContentValid } from '../../domain/blocks'
import type { Block, CardState } from '../../domain/types'
import { commitImportDraft } from '../../importExport/commitImport'
import type { ImportDeckDraft } from '../../importExport/types'
import {
  checkImportSize,
  draftIsConfirmable,
  parseImportJson,
  toImportDraft,
} from '../../importExport/validate'
import { listDecks } from '../../storage/repositories'
import { BlockEditor } from '../blocks/BlockEditor'
import { BlockRenderer } from '../blocks/BlockRenderer'

const EXAMPLE_IMPORT_JSON = JSON.stringify(
  {
    format: 'open-cards',
    version: 1,
    decks: [
      {
        name: 'Vocabulario de inglés',
        description: 'Palabras clave y fórmulas de ejemplo',
        tags: ['Inglés', 'Básico'],
        cards: [
          {
            front: [{ type: 'text', content: 'to achieve' }],
            back: [{ type: 'text', content: 'lograr, conseguir' }],
          },
          {
            front: [{ type: 'text', content: 'Teorema de Pitágoras' }],
            back: [{ type: 'math', content: 'a^2 + b^2 = c^2' }],
          },
          {
            front: [{ type: 'text', content: 'Imprimir texto en Python' }],
            back: [
              {
                type: 'code',
                language: 'python',
                content: "print('¡Hola mundo!')",
              },
            ],
          },
        ],
      },
    ],
  },
  null,
  2,
)

const PLACEHOLDER_JSON = `{
  "format": "open-cards",
  "version": 1,
  "decks": [
    {
      "name": "Nombre del mazo",
      "cards": [
        {
          "front": [{ "type": "text", "content": "¿Pregunta?" }],
          "back": [{ "type": "text", "content": "Respuesta" }]
        }
      ]
    }
  ]
}`

const AI_PROMPT_TEMPLATE = `Actúa como generador de flashcards para la aplicación Open Cards.
Crea un mazo de tarjetas de estudio en formato JSON siguiendo estrictamente esta estructura:

{
  "format": "open-cards",
  "version": 1,
  "decks": [
    {
      "name": "[Nombre del mazo]",
      "description": "[Descripción opcional]",
      "tags": ["[Etiqueta 1]", "[Etiqueta 2]"],
      "cards": [
        {
          "front": [
            { "type": "text", "content": "Pregunta o término frontal" }
          ],
          "back": [
            { "type": "text", "content": "Respuesta o reverso" }
          ]
        }
      ]
    }
  ]
}

Reglas obligatorias:
1. "format" debe ser "open-cards" y "version" debe ser 1.
2. "decks" es un arreglo de mazos. Cada mazo debe tener "name" y "cards".
3. "front" y "back" son arreglos de bloques con "type" y "content":
   - Texto: { "type": "text", "content": "Texto (admite fórmulas matemáticas entre signos de dólar, ej: $x^2$)" }
   - Matemáticas (LaTeX): { "type": "math", "content": "\\\\frac{a}{b}" }
   - Código: { "type": "code", "language": "python", "content": "código aquí" }
4. Devuelve ÚNICAMENTE el bloque JSON válido, sin introducciones ni texto adicional antes o después.

Tema a desarrollar:
[ESCRIBE AQUÍ EL TEMA O PEGA TUS APUNTES]`

function revalidate(draft: ImportDeckDraft): ImportDeckDraft {
  const base = toImportDraft({
    name: draft.name,
    description: draft.description,
    tags: draft.tags,
    cards: draft.cards,
  })
  return {
    ...draft,
    errors: base.errors,
    warnings: base.warnings,
  }
}

export function ImportPage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [pending, setPending] = useState<ImportDeckDraft[]>([])
  const [pendingIndex, setPendingIndex] = useState<number | null>(null)
  const [current, setCurrent] = useState<ImportDeckDraft | null>(null)
  const [nameWarning, setNameWarning] = useState('')
  const [multiMode, setMultiMode] = useState(false)
  const [previewCard, setPreviewCard] = useState(0)
  const [showPreview, setShowPreview] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [copiedTarget, setCopiedTarget] = useState<'ejemplo' | 'prompt' | null>(null)

  const handleCopy = async (text: string, target: 'ejemplo' | 'prompt') => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopiedTarget(target)
      window.setTimeout(() => {
        setCopiedTarget((curr) => (curr === target ? null : curr))
      }, 2500)
    } catch {
      // Ignorar fallo de portapapeles si el entorno no lo permite
    }
  }

  const openDraft = async (draft: ImportDeckDraft, index: number | null) => {
    const decks = await listDecks()
    setNameWarning(
      decks.some((d) => d.name === draft.name)
        ? `Ya existe un mazo llamado «${draft.name}». Se importará como mazo nuevo.`
        : '',
    )
    setPendingIndex(index)
    setCurrent(revalidate(draft))
    setPreviewCard(0)
    setShowPreview(false)
  }

  const loadText = async (text: string, byteLength: number) => {
    setError('')
    const sizeError = checkImportSize(byteLength)
    if (sizeError) {
      setError(sizeError)
      return
    }
    const parsed = parseImportJson(text)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    const drafts = parsed.data.decks.map(toImportDraft)
    if (drafts.length === 1) {
      setMultiMode(false)
      setPending([])
      await openDraft(drafts[0], null)
      return
    }
    setMultiMode(true)
    setPending(drafts)
    setCurrent(null)
  }

  const updateCard = (
    index: number,
    side: 'front' | 'back',
    blocks: Block[],
  ) => {
    if (!current) return
    const cards = current.cards.map((c, i) =>
      i === index ? { ...c, [side]: blocks } : c,
    )
    setCurrent(revalidate({ ...current, cards }))
  }

  const confirm = async () => {
    if (!current || !draftIsConfirmable(current)) return
    const deck = await commitImportDraft(current)
    if (multiMode && pendingIndex != null) {
      const nextPending = pending.filter((_, i) => i !== pendingIndex)
      setPending(nextPending)
      setCurrent(null)
      setPendingIndex(null)
      if (nextPending.length === 0) {
        navigate(`/decks/${deck.id}`)
      }
      return
    }
    navigate(`/decks/${deck.id}`)
  }

  return (
    <div className="page">
      {!current && pending.length === 0 ? (
        <>
          <header className="page-header">
            <div className="page-header-main">
              <Link to="/">← Mazos</Link>
              <h1>Importar</h1>
            </div>
          </header>
          <section className="panel import-source stack">
            <p className="muted">
              Pega JSON y pulsa «Usar JSON», o elige un archivo. Cada mazo se
              revisa y confirma por separado. Siempre se añaden mazos nuevos.
            </p>

            <details className="import-format-guide">
              <summary className="import-format-summary">
                <span>¿Cuál es el formato JSON que acepta? (Guía, ejemplo y prompt para IA)</span>
              </summary>
              <div className="import-format-body stack">
                <p className="muted">
                  Open Cards valida el JSON con el esquema <code>open-cards v1</code>.
                  Tanto el frente (<code>front</code>) como el reverso (<code>back</code>) de cada tarjeta
                  deben ser <strong>listas de bloques</strong> (texto, fórmulas LaTeX o código).
                </p>

                <div className="import-format-specs">
                  <div>
                    <strong>1. Estructura general:</strong>
                    <ul>
                      <li><code>"format": "open-cards"</code> (obligatorio)</li>
                      <li><code>"version": 1</code> (obligatorio)</li>
                      <li><code>"decks"</code>: arreglo con uno o varios mazos.</li>
                    </ul>
                  </div>

                  <div>
                    <strong>2. Campos de cada mazo:</strong>
                    <ul>
                      <li><code>"name"</code>: nombre del mazo (obligatorio, texto de 1 a 120 caracteres).</li>
                      <li><code>"description"</code>: descripción breve (opcional).</li>
                      <li><code>"tags"</code>: arreglo de etiquetas de texto, ej. <code>["Biología", "Examen"]</code> (opcional).</li>
                      <li><code>"cards"</code>: arreglo de tarjetas pertenecientes al mazo (obligatorio).</li>
                    </ul>
                  </div>

                  <div>
                    <strong>3. Campos de cada tarjeta:</strong>
                    <ul>
                      <li><code>"front"</code>: arreglo de bloques para el frente de la tarjeta (al menos 1 bloque con contenido).</li>
                      <li><code>"back"</code>: arreglo de bloques para el reverso de la tarjeta (al menos 1 bloque con contenido).</li>
                      <li><code>"state"</code>: estado inicial opcional (<code>"unseen"</code>, <code>"seen"</code>, <code>"understood"</code> o <code>"needs_review"</code>). Por defecto es <code>"unseen"</code>.</li>
                    </ul>
                  </div>

                  <div>
                    <strong>4. Tipos de bloque disponibles (para front y back):</strong>
                    <ul>
                      <li>
                        <strong>Texto:</strong> <code>&#123; "type": "text", "content": "Pregunta con $fórmula$ en línea opcional" &#125;</code>
                      </li>
                      <li>
                        <strong>Matemáticas (fórmula en bloque KaTeX):</strong> <code>&#123; "type": "math", "content": "a^2 + b^2 = c^2" &#125;</code>
                      </li>
                      <li>
                        <strong>Código:</strong> <code>&#123; "type": "code", "language": "python", "content": "print('Hola')" &#125;</code>
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="row gap wrap">
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => {
                      setPasteText(EXAMPLE_IMPORT_JSON)
                      if (error) setError('')
                    }}
                  >
                    Cargar ejemplo en el editor
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => void handleCopy(EXAMPLE_IMPORT_JSON, 'ejemplo')}
                  >
                    {copiedTarget === 'ejemplo' ? '✓ Ejemplo copiado' : 'Copiar ejemplo JSON'}
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => void handleCopy(AI_PROMPT_TEMPLATE, 'prompt')}
                  >
                    {copiedTarget === 'prompt' ? '✓ Prompt copiado' : 'Copiar prompt para ChatGPT / IA'}
                  </button>
                </div>

                <div className="import-snippet-box">
                  <span className="import-snippet-title">Vista previa del JSON de ejemplo</span>
                  <pre
                    className="block-code"
                    style={{ maxHeight: '180px', fontSize: '0.82rem', whiteSpace: 'pre' }}
                  >
                    {EXAMPLE_IMPORT_JSON}
                  </pre>
                </div>
              </div>
            </details>

            <label className="field">
              <span>JSON</span>
              <textarea
                rows={10}
                value={pasteText}
                placeholder={PLACEHOLDER_JSON}
                onChange={(e) => {
                  setPasteText(e.target.value)
                  if (error) setError('')
                }}
              />
            </label>
            <div className="row gap wrap">
              <button
                type="button"
                className="button"
                disabled={!pasteText.trim()}
                onClick={() => {
                  const text = pasteText
                  void loadText(
                    text,
                    new TextEncoder().encode(text).length,
                  )
                }}
              >
                Usar JSON
              </button>
            </div>
            <div className="file-picker">
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="file-picker-input"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setFileName(file.name)
                  void file.text().then((text) => loadText(text, file.size))
                }}
              />
              <button
                type="button"
                className="button"
                onClick={() => fileRef.current?.click()}
              >
                Seleccionar archivo
              </button>
              <span className="muted">
                {fileName || 'Sin archivos seleccionados'}
              </span>
            </div>
            {error ? <p className="math-error">{error}</p> : null}
          </section>
        </>
      ) : null}

      {!current && pending.length > 0 ? (
        <>
          <header className="page-header">
            <div className="page-header-main">
              <Link to="/">← Mazos</Link>
              <h1>Importar</h1>
            </div>
          </header>
          <section className="panel stack">
            <h2>Mazos pendientes ({pending.length})</h2>
            <p className="muted">Confirma cada mazo por separado.</p>
            {pending.map((draft, i) => (
              <div key={`${draft.name}-${i}`} className="row between">
                <div>
                  <strong>{draft.name}</strong>
                  <p className="muted">
                    {draft.cards.length} tarjetas
                    {draft.errors.length
                      ? ` · ${draft.errors.length} error(es)`
                      : ''}
                  </p>
                </div>
                <button type="button" onClick={() => void openDraft(draft, i)}>
                  Revisar
                </button>
              </div>
            ))}
            <button
              type="button"
              className="ghost"
              onClick={() => navigate('/')}
            >
              Terminar más tarde
            </button>
          </section>
        </>
      ) : null}

      {current ? (
        <div className="import-draft">
          <header className="page-header">
            <div className="page-header-main">
              <Link to="/">← Mazos</Link>
              <h1>Importar mazo</h1>
              <p className="muted">
                Todo lo que ves es editable antes de guardar.
              </p>
            </div>
            <div className="page-header-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setShowPreview((v) => !v)}
              >
                {showPreview ? 'Editar' : 'Vista previa'}
              </button>
            </div>
          </header>

          {nameWarning ? <p className="warn">{nameWarning}</p> : null}
          {current.errors.map((err) => (
            <p key={err} className="math-error">
              {err}
            </p>
          ))}

          <section className="panel import-meta stack">
            <label className="field">
              <span>Nombre del mazo</span>
              <input
                value={current.name}
                onChange={(e) =>
                  setCurrent(revalidate({ ...current, name: e.target.value }))
                }
              />
            </label>
            <div className="import-meta-row">
              <label className="field">
                <span>Descripción</span>
                <input
                  value={current.description}
                  onChange={(e) =>
                    setCurrent(
                      revalidate({
                        ...current,
                        description: e.target.value,
                      }),
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Etiquetas</span>
                <input
                  value={current.tags.join(', ')}
                  placeholder="Cálculo, Examen 1"
                  onChange={(e) =>
                    setCurrent(
                      revalidate({
                        ...current,
                        tags: e.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean),
                      }),
                    )
                  }
                />
              </label>
            </div>
          </section>

          {showPreview && current.cards[previewCard] ? (
            <section className="panel stack">
              <div className="row between">
                <h2>Vista previa</h2>
                <p className="muted">
                  {previewCard + 1} de {current.cards.length}
                </p>
              </div>
              <div className="study-flash preview-only">
                <span className="study-face-label">ANVERSO</span>
                <div className="study-flash-content">
                  <BlockRenderer blocks={current.cards[previewCard].front} />
                </div>
              </div>
              <div className="study-flash preview-only">
                <span className="study-face-label">REVERSO</span>
                <div className="study-flash-content">
                  <BlockRenderer blocks={current.cards[previewCard].back} />
                </div>
              </div>
              <div className="row gap">
                <button
                  type="button"
                  className="ghost"
                  disabled={previewCard === 0}
                  onClick={() => setPreviewCard((i) => Math.max(0, i - 1))}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={previewCard >= current.cards.length - 1}
                  onClick={() =>
                    setPreviewCard((i) =>
                      Math.min(current.cards.length - 1, i + 1),
                    )
                  }
                >
                  Siguiente
                </button>
              </div>
            </section>
          ) : (
            current.cards.map((card, index) => (
              <section key={index} className="panel import-card stack">
                <div className="row between">
                  <h2>Tarjeta {index + 1}</h2>
                  <p className="muted">
                    {index + 1} de {current.cards.length} · Borrador
                  </p>
                </div>
                <label className="field">
                  <span>Estado</span>
                  <select
                    value={card.state}
                    onChange={(e) => {
                      const state = e.target.value as CardState
                      const cards = current.cards.map((c, i) =>
                        i === index ? { ...c, state } : c,
                      )
                      setCurrent(revalidate({ ...current, cards }))
                    }}
                  >
                    <option value="unseen">No vista</option>
                    <option value="seen">Vista</option>
                    <option value="understood">Comprendida</option>
                    <option value="needs_review">Para repasar</option>
                  </select>
                </label>
                {!isCardContentValid(card.front, card.back) ? (
                  <p className="math-error">Contenido incompleto</p>
                ) : null}
                <BlockEditor
                  label="Anverso"
                  blocks={card.front}
                  onChange={(blocks) => updateCard(index, 'front', blocks)}
                />
                <BlockEditor
                  label="Reverso"
                  blocks={card.back}
                  onChange={(blocks) => updateCard(index, 'back', blocks)}
                />
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    const cards = current.cards.filter((_, i) => i !== index)
                    setCurrent(revalidate({ ...current, cards }))
                  }}
                >
                  Quitar tarjeta
                </button>
              </section>
            ))
          )}

          <div className="import-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setCurrent(null)
                setPendingIndex(null)
                if (!multiMode) setPending([])
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!draftIsConfirmable(current)}
              onClick={() => void confirm()}
            >
              Confirmar este mazo
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
