const isColorSupported =
  !process.env.NO_COLOR &&
  (process.stdout.isTTY || process.env.FORCE_COLOR === '1');

function wrap(code, close = 39) {
  return (text) => (isColorSupported ? `\x1b[${code}m${text}\x1b[${close}m` : String(text));
}

export const colors = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),

  // Standard foregrounds
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
  white: wrap(37),
  gray: wrap(90),

  // Bright foregrounds
  brightRed: wrap(91),
  brightGreen: wrap(92),
  brightYellow: wrap(93),
  brightBlue: wrap(94),
  brightMagenta: wrap(95),
  brightCyan: wrap(96),

  // Helpers
  strip: (str) => str.replace(/\x1b\[[0-9;]*m/g, ''),
  isSupported: isColorSupported,
};

export default colors;
