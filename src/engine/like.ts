/** SQL LIKE over Unicode code points, with ASCII-only case folding.
 * Backtracking returns to the most recent % instead of exploring an
 * exponential regex search tree. Worst-case work is O(text × pattern).
 */
export function like(text: string, pattern: string): boolean {
  const fold = (value: string) =>
    Array.from(value.replace(/[A-Z]/g, (c) => c.toLowerCase()));
  const input = fold(text),
    tokens = fold(pattern);
  let i = 0,
    j = 0,
    wildcard = -1,
    retry = 0;
  while (i < input.length) {
    if (
      j < tokens.length &&
      (tokens[j] === "_" || (tokens[j] !== "%" && tokens[j] === input[i]))
    ) {
      i++;
      j++;
    } else if (tokens[j] === "%") {
      wildcard = j++;
      retry = i;
    } else if (wildcard >= 0) {
      j = wildcard + 1;
      i = ++retry;
    } else return false;
  }
  while (tokens[j] === "%") j++;
  return j === tokens.length;
}
