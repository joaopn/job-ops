import { describe, expect, it } from "vitest";
import { canonicalizeJobUrl } from "./job-url";

describe("canonicalizeJobUrl", () => {
  it("collapses LinkedIn URLs that differ only by tracking params", () => {
    const a =
      "https://www.linkedin.com/jobs/view/senior-machine-learning-engineer-multimodal-data-at-canva-4395318810/?refId=1WX%2B%2B6JQbWdrutKKE6rfMw%3D%3D&trackingId=S5LBDTKGYvVxuLiz2AO9Hw%3D%3D";
    const b =
      "https://www.linkedin.com/jobs/view/senior-machine-learning-engineer-multimodal-data-at-canva-4395318810/?refId=JT%2FTmiNA3hPe87bC%2FJOWGw%3D%3D&trackingId=bZwfipC%2BYOgdGP8Jor0vfQ%3D%3D";
    expect(canonicalizeJobUrl(a)).toBe(canonicalizeJobUrl(b));
    expect(canonicalizeJobUrl(a)).toBe(
      "https://www.linkedin.com/jobs/view/senior-machine-learning-engineer-multimodal-data-at-canva-4395318810/",
    );
  });

  it("strips utm_* and ad-click params", () => {
    expect(
      canonicalizeJobUrl(
        "https://jobs.example.com/p/123?utm_source=x&utm_medium=email&gclid=abc&fbclid=def",
      ),
    ).toBe("https://jobs.example.com/p/123");
  });

  it("preserves params that carry job identity", () => {
    expect(
      canonicalizeJobUrl("https://www.indeed.com/viewjob?jk=abc123&from=serp&tk=xyz"),
    ).toBe("https://www.indeed.com/viewjob?jk=abc123");
    expect(
      canonicalizeJobUrl(
        "https://www.linkedin.com/jobs/collections/?currentJobId=999&trackingId=zzz",
      ),
    ).toBe("https://www.linkedin.com/jobs/collections/?currentJobId=999");
  });

  it("drops the fragment", () => {
    expect(canonicalizeJobUrl("https://x.com/job/1#apply")).toBe(
      "https://x.com/job/1",
    );
  });

  it("returns the trimmed input when it is not a parseable URL", () => {
    expect(canonicalizeJobUrl("  not a url  ")).toBe("not a url");
    expect(canonicalizeJobUrl("")).toBe("");
  });
});
