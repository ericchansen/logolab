import {
  useEffect,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { parseHexColor } from '../domain/colors'

interface HexTextInputProps {
  value: string
  onChange: (hex: string) => void
  label: string
  className?: string
}

/**
 * An editable hex field. Commits while typing as soon as the text parses, and
 * reverts to the committed color when it does not, so an invalid value never
 * reaches the design model.
 */
export function HexTextInput({ value, onChange, label, className }: HexTextInputProps) {
  const committed = parseHexColor(value) ?? value
  const [draft, setDraft] = useState(committed)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (!isEditing) {
      setDraft(committed)
    }
  }, [committed, isEditing])

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value
    setDraft(text)
    const parsed = parseHexColor(text)
    if (parsed && parsed !== committed) {
      onChange(parsed)
    }
  }

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    setIsEditing(true)
    event.target.select()
  }

  const handleBlur = () => {
    setIsEditing(false)
    setDraft(committed)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      setDraft(committed)
      event.currentTarget.blur()
    }
  }

  return (
    <input
      className={className ? `hex-text ${className}` : 'hex-text'}
      aria-label={label}
      type="text"
      value={draft}
      maxLength={7}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  )
}

interface HexColorInputProps {
  value: string
  onChange: (hex: string) => void
  swatchLabel: string
  hexLabel: string
  className?: string
}

/**
 * A native color swatch paired with an editable hex field. Both drive the same
 * `onChange`, so each call site keeps its own update semantics.
 */
export function HexColorInput({
  value,
  onChange,
  swatchLabel,
  hexLabel,
  className,
}: HexColorInputProps) {
  return (
    <span className={className ? `hex-color ${className}` : 'hex-color'}>
      <input
        aria-label={swatchLabel}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <HexTextInput value={value} onChange={onChange} label={hexLabel} />
    </span>
  )
}
