import { describe, it, expect } from "vitest";
import { nameToSlug } from "../lib/slug";

describe("nameToSlug", () => {
  it("converts Last, First to first-last", () => {
    expect(nameToSlug("Carlsen, Magnus")).toBe("magnus-carlsen");
  });

  it("handles single-name players", () => {
    expect(nameToSlug("Gragger")).toBe("gragger");
  });

  it("strips trailing space from first name", () => {
    expect(nameToSlug("Nimzowitsch, Aaron ")).toBe("aaron-nimzowitsch");
  });

  it("strips accents", () => {
    expect(nameToSlug("Erdős, Pál")).toBe("pal-erdos");
  });

  it("handles names with middle initials", () => {
    expect(nameToSlug("Tal, Mihail")).toBe("mihail-tal");
  });

  it("collapses multiple non-alnum chars to single hyphen", () => {
    expect(nameToSlug("O'Kelly, Alberic")).toBe("alberic-o-kelly");
  });

  it("strips leading/trailing hyphens", () => {
    expect(nameToSlug(", Foo")).toBe("foo");
  });
});
