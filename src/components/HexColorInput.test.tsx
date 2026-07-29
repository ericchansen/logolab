import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HexColorInput, HexTextInput } from './HexColorInput'

afterEach(cleanup)

function Controlled({
  initial = '#112233',
  onChange,
}: {
  initial?: string
  onChange?: (hex: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <HexTextInput
      value={value}
      label="Swatch hex"
      onChange={(hex) => {
        setValue(hex)
        onChange?.(hex)
      }}
    />
  )
}

function hexField() {
  return screen.getByLabelText<HTMLInputElement>('Swatch hex')
}

describe('HexTextInput', () => {
  it('commits while typing as soon as the text parses', () => {
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    const field = hexField()

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '#e3008' } })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: '#e3008c' } })
    expect(onChange).toHaveBeenCalledWith('#e3008c')
  })

  it.each([
    ['#E3008C', '#e3008c'],
    ['e3008c', '#e3008c'],
    ['#abc', '#aabbcc'],
    ['abc', '#aabbcc'],
    ['  #E3008C  ', '#e3008c'],
  ])('accepts %s and commits %s', (typed, expected) => {
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    const field = hexField()

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: typed } })

    expect(onChange).toHaveBeenCalledWith(expected)
  })

  it('reverts to the committed color on blur when the text is unparseable', () => {
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    const field = hexField()

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'nothex' } })
    expect(field.value).toBe('nothex')
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.blur(field)
    expect(field.value).toBe('#112233')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reverts on Enter when the text is unparseable', () => {
    render(<Controlled />)
    const field = hexField()

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '##' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.blur(field)

    expect(field.value).toBe('#112233')
  })

  it('normalizes the displayed value after Enter on valid input', () => {
    render(<Controlled />)
    const field = hexField()

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'ABC' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.blur(field)

    expect(field.value).toBe('#aabbcc')
  })

  it('selects the whole value on focus so the hex can be copied out', () => {
    render(<Controlled />)
    const field = hexField()
    const select = vi.spyOn(field, 'select')

    fireEvent.focus(field)

    expect(select).toHaveBeenCalled()
  })

  it('shows an externally updated value while not editing', () => {
    const { rerender } = render(
      <HexTextInput value="#112233" label="Swatch hex" onChange={vi.fn()} />,
    )
    expect(hexField().value).toBe('#112233')

    rerender(<HexTextInput value="#E3008C" label="Swatch hex" onChange={vi.fn()} />)
    expect(hexField().value).toBe('#e3008c')
  })
})

describe('HexColorInput', () => {
  it('drives the same onChange from the swatch and the hex field', () => {
    const onChange = vi.fn()
    render(
      <HexColorInput
        value="#112233"
        swatchLabel="A base color"
        hexLabel="A base color hex"
        onChange={onChange}
      />,
    )

    const swatch = screen.getByLabelText('A base color')
    fireEvent.change(swatch, { target: { value: '#e3008c' } })
    expect(onChange).toHaveBeenLastCalledWith('#e3008c')

    const hex = screen.getByLabelText('A base color hex')
    fireEvent.focus(hex)
    fireEvent.change(hex, { target: { value: '#00ff00' } })
    expect(onChange).toHaveBeenLastCalledWith('#00ff00')
  })
})
