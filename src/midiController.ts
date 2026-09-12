export type GridMidiAction =
  | { kind: "preset"; presetIndex: number }
  | { kind: "symbolScale"; presetIndex: number; value: number }
  | { kind: "zSeparation"; presetIndex: number; value: number };

export const scaleMidiValue = (value: number, minimum: number, maximum: number) =>
  Math.round(minimum + (value / 127) * (maximum - minimum));

export const mapGridMidiMessage = (data: ArrayLike<number>): GridMidiAction | null => {
  if (data.length < 3) {
    return null;
  }

  const status = data[0];
  const control = data[1];
  const value = data[2];
  const messageType = status & 0xf0;

  if (messageType === 0x90 && value > 0 && control >= 40 && control <= 43) {
    return { kind: "preset", presetIndex: control - 40 };
  }

  if (messageType !== 0xb0) {
    return null;
  }

  if (control >= 32 && control <= 35) {
    return { kind: "symbolScale", presetIndex: control - 32, value };
  }

  if (control >= 36 && control <= 39) {
    return { kind: "zSeparation", presetIndex: control - 36, value };
  }

  return null;
};
