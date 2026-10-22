const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string | number) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const bold = paint('1');
export const dim = paint('2');
export const red = paint('31');
export const green = paint('32');
export const yellow = paint('33');
export const cyan = paint('36');

export function step(n: number, title: string): void {
  console.log(`\n${bold(cyan(`[${n}]`))} ${bold(title)}`);
}

export function line(text = ''): void {
  console.log(`    ${text}`);
}
