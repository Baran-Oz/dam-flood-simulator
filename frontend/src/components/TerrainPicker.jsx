import { useState, useEffect } from 'react'
import { SOURCES, KEY_PROVIDERS, sourceById } from '../lib/sources'
import styles from './SidePanel.module.css'

const free = SOURCES.filter(s => s.group === 'free')
const keyed = SOURCES.filter(s => s.group === 'key')

export default function TerrainPicker({ sourceId, keys, onSourceChange, onSaveKey }) {
  const source = sourceById(sourceId)
  const provider = source.keyProvider ? KEY_PROVIDERS[source.keyProvider] : null
  const savedKey = source.keyProvider ? keys[source.keyProvider] : null

  return (
    <>
      <select
        className={styles.select}
        value={source.id}
        onChange={e => onSourceChange(e.target.value)}
        aria-label="Terrain dataset"
      >
        <optgroup label="No key needed">
          {free.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </optgroup>
        <optgroup label="Needs a free API key">
          {keyed.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </optgroup>
      </select>

      <dl className={styles.sourceInfo}>
        <div><dt>Surveyed</dt><dd>{source.surveyed}</dd></div>
        <div><dt>Resolution</dt><dd>{source.resolution}</dd></div>
        <div><dt>Coverage</dt><dd>{source.coverage}</dd></div>
      </dl>
      <p className={styles.note}>{source.kind}</p>

      {provider && (
        <KeyField
          key={source.keyProvider}
          provider={provider}
          savedKey={savedKey}
          onSave={value => onSaveKey(source.keyProvider, value)}
        />
      )}
    </>
  )
}

function KeyField({ provider, savedKey, onSave }) {
  const [editing, setEditing] = useState(!savedKey)
  const [draft, setDraft] = useState('')
  useEffect(() => { if (!savedKey) setEditing(true) }, [savedKey])

  if (!editing) {
    return (
      <div className={styles.keyRow}>
        <span className={styles.kv}>
          {provider.label}: <strong>••••{savedKey.slice(-4)}</strong>
        </span>
        <div className={styles.sideBtns}>
          <button className={styles.link} onClick={() => { setDraft(''); setEditing(true) }}>Change</button>
          <button className={styles.link} onClick={() => onSave('')}>Remove</button>
        </div>
      </div>
    )
  }

  const submit = e => {
    e.preventDefault()
    const v = draft.trim()
    if (!v) return
    onSave(v)
    setEditing(false)
  }

  return (
    <form className={styles.keyForm} onSubmit={submit}>
      <label className={styles.keyLabel} htmlFor="api-key">
        {savedKey ? `New ${provider.label.toLowerCase()}` : `This dataset needs a ${provider.label.toLowerCase()}.`}
      </label>
      <div className={styles.keyInputRow}>
        <input
          id="api-key"
          className={styles.keyInput}
          type="password"
          autoComplete="off"
          spellCheck="false"
          placeholder={provider.placeholder}
          value={draft}
          onChange={e => setDraft(e.target.value)}
        />
        <button className={styles.secondary} type="submit" disabled={!draft.trim()}>Save</button>
      </div>
      <p className={styles.note}>
        <a className={styles.anchor} href={provider.url} target="_blank" rel="noreferrer">Get a free key ↗</a>
        {' '}· Stored only in this browser and sent only to that service.
        {savedKey && <> · <button type="button" className={styles.link} onClick={() => setEditing(false)}>Cancel</button></>}
      </p>
    </form>
  )
}
