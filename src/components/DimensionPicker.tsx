import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from '../lib/types';

/** オーバーワールド／ネザー／エンドの 3 択（各ディメンションの色） */
export function DimensionPicker({ value, onChange }: { value: Dimension; onChange: (d: Dimension) => void }) {
  return (
    <div className="dim-switch dim-picker" role="radiogroup" aria-label="ディメンション">
      {DIMENSIONS.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={d === value}
          className={`dim-btn dim-btn-${d}${d === value ? ' active' : ''}`}
          onClick={() => onChange(d)}
        >
          {DIMENSION_LABELS[d]}
        </button>
      ))}
    </div>
  );
}
