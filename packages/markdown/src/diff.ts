// Line diffs, as version history shows what changed between two versions of
// a note: Myers' algorithm, which finds the fewest lines to remove and add,
// over the lines left once the ones both texts start and end with are set
// aside.

/** A run of lines the same in both texts, removed from the first, or added in the second. */
export interface DiffPart {
  readonly kind: "same" | "removed" | "added";
  readonly lines: readonly string[];
}

/** The lines of a text; a final line break ends the last line rather than starting another. */
export function textLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** What changed from `before` to `after`, line by line, removals before additions at each place. */
export function diffLines(before: string, after: string): DiffPart[] {
  const a = textLines(before);
  const b = textLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++;
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], line: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) (last.lines as string[]).push(line);
    else parts.push({ kind, lines: [line] });
  };
  for (const line of a.slice(0, start)) push("same", line);
  for (const [kind, line] of myers(
    a.slice(start, a.length - end),
    b.slice(start, b.length - end),
  )) {
    push(kind, line);
  }
  for (const line of a.slice(a.length - end)) push("same", line);
  return parts;
}

/** The edit script from `a` to `b`, by Myers' O((N+M)D) algorithm with its trace kept. */
function myers(a: readonly string[], b: readonly string[]): [DiffPart["kind"], string][] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array<ArrayBuffer>[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
          ? (v[offset + k + 1] ?? 0)
          : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }
  // Back from the end along the trace.
  const script: [DiffPart["kind"], string][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    v = trace[d] ?? v;
    const k = x - y;
    const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
    const previousK = down ? k + 1 : k - 1;
    const previousX = v[offset + previousK] ?? 0;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x--;
      y--;
      script.push(["same", a[x] ?? ""]);
    }
    if (d > 0) {
      if (down) {
        y--;
        script.push(["added", b[y] ?? ""]);
      } else {
        x--;
        script.push(["removed", a[x] ?? ""]);
      }
    }
  }
  return script.reverse();
}
