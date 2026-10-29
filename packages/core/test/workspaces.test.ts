import { describe, expect, it } from "vitest";
import {
  createWorkspace,
  isUuid,
  parseWorkspace,
  serializeWorkspace,
  workspaceFromJson,
} from "../src/index.ts";
import { ids } from "./fixtures.ts";

const workspace = {
  id: ids.workspace,
  name: "Research",
  encryption: "end-to-end",
  created: "2026-10-30T08:00:00.000Z",
};

describe("workspaces", () => {
  it("round-trip through their JSON form", () => {
    const read = workspaceFromJson(workspace);
    expect(parseWorkspace(serializeWorkspace(read))).toEqual(read);
    expect(JSON.parse(serializeWorkspace(read))).toEqual({
      format: "nether.workspace",
      version: 1,
      workspace,
    });
  });

  it("are created unencrypted by default, with a new ID", () => {
    const created = createWorkspace("Personal", undefined, "2026-10-30T08:00:00.000Z");
    expect(isUuid(created.id)).toBe(true);
    expect(created).toMatchObject({ name: "Personal", encryption: "none" });
    expect(createWorkspace("Team", "end-to-end").encryption).toBe("end-to-end");
  });

  it("reject what is not a workspace", () => {
    expect(() => workspaceFromJson({ ...workspace, encryption: "aes" })).toThrow(
      "workspace.encryption must be one of",
    );
    expect(() => workspaceFromJson({ ...workspace, name: "  " })).toThrow(
      "workspace.name must not be empty",
    );
    expect(() => workspaceFromJson({ ...workspace, id: ids.workspace.slice(1) })).toThrow(
      "workspace.id must be a workspace ID",
    );
    expect(() =>
      parseWorkspace(
        serializeWorkspace(workspaceFromJson(workspace)).replace("nether.workspace", "nether.note"),
      ),
    ).toThrow('$.format must be one of "nether.workspace"');
  });
});
