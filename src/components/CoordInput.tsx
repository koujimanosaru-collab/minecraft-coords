import { parseCoord } from '../lib/geo';
import { COORD_LIMIT, type Coords } from '../lib/types';

interface CoordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}

/** iPhone の数字キーボードにはマイナスがないので ± ボタンで符号を切り替える */
export function CoordInput({ label, value, onChange, invalid }: CoordInputProps) {
  const toggleSign = () => onChange(value.startsWith('-') ? value.slice(1) : `-${value}`);
  return (
    <label className={`coord-input${invalid ? ' invalid' : ''}`}>
      <span className="coord-label">{label}</span>
      <button type="button" className="sign-btn" onClick={toggleSign} aria-label={`${label} の符号を切り替え`}>
        ±
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="-?[0-9]*"
        autoComplete="off"
        enterKeyHint="next"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export interface CoordDraft {
  x: string;
  y: string;
  z: string;
}

export function CoordFields({
  draft,
  onChange,
  invalid = [],
}: {
  draft: CoordDraft;
  onChange: (d: CoordDraft) => void;
  invalid?: (keyof CoordDraft)[];
}) {
  return (
    <div className="coord-fields">
      {(['x', 'y', 'z'] as const).map((axis) => (
        <CoordInput
          key={axis}
          label={axis.toUpperCase()}
          value={draft[axis]}
          invalid={invalid.includes(axis)}
          onChange={(v) => onChange({ ...draft, [axis]: v })}
        />
      ))}
    </div>
  );
}

export const EMPTY_DRAFT: CoordDraft = { x: '', y: '', z: '' };

export function coordsToDraft(c: Coords): CoordDraft {
  return { x: String(c.x), y: String(c.y), z: String(c.z) };
}

/** 入力値を座標に変換。不正な軸があれば invalid に入れる */
export function draftToCoords(d: CoordDraft): { coords: Coords | null; invalid: (keyof CoordDraft)[] } {
  const invalid: (keyof CoordDraft)[] = [];
  const out = { x: 0, y: 0, z: 0 };
  for (const axis of ['x', 'y', 'z'] as const) {
    const n = parseCoord(d[axis]);
    if (n === null || Math.abs(n) > COORD_LIMIT) invalid.push(axis);
    else out[axis] = n;
  }
  return { coords: invalid.length ? null : out, invalid };
}
