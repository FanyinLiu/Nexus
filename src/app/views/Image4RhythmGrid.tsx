const IMAGE4_RHYTHM_ROWS = [
  ['header', 'H'],
  ['stage', 'L'],
  ['recap', 'R'],
  ['composer', 'C'],
] as const

export function Image4RhythmGrid() {
  return (
    <div className="image4-rhythm-grid" aria-hidden="true">
      {IMAGE4_RHYTHM_ROWS.map(([row]) => (
        <span
          key={row}
          className="image4-rhythm-grid__row"
          data-label={row}
          data-rhythm-row={row}
        />
      ))}
      <div className="image4-rhythm-grid__rail">
        {IMAGE4_RHYTHM_ROWS.map(([row, shortLabel]) => (
          <span key={row} data-label={row}>{shortLabel}</span>
        ))}
      </div>
    </div>
  )
}
