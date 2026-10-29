/**
 * Thrown when data does not fit Nether's model. `path` points at the value
 * that is wrong, such as `note.content[2].attrs.level`.
 */
export class ModelError extends Error {
  readonly path: string;

  constructor(path: string, problem: string) {
    super(`${path} ${problem}`);
    this.name = "ModelError";
    this.path = path;
  }
}
