// Words the generator builds titles and sentences from. Plain, neutral
// vocabulary: the text only has to look like notes, not say anything.

// prettier-ignore
export const adjectives = [
  "quiet", "early", "shared", "open", "small", "weekly", "annual", "local", "remote", "rough",
  "final", "draft", "new", "old", "careful", "simple", "steady", "bright", "slow", "quick",
  "long", "short", "plain", "public", "private", "daily", "minor", "major", "light", "dark",
  "warm", "cold", "first", "second", "last", "next", "spare", "clear", "hidden", "central",
] as const;

// prettier-ignore
export const nouns = [
  "garden", "river", "project", "meeting", "budget", "design", "review", "roadmap", "release", "draft",
  "kitchen", "library", "harbor", "station", "market", "bridge", "window", "ledger", "letter", "journal",
  "recipe", "lecture", "chapter", "theory", "method", "sketch", "outline", "summary", "archive", "index",
  "workshop", "interview", "survey", "report", "proposal", "contract", "invoice", "schedule", "checklist", "timeline",
  "habit", "routine", "goal", "lesson", "question", "answer", "idea", "pattern", "principle", "practice",
  "server", "client", "network", "backup", "editor", "plugin", "theme", "query", "schema", "database",
  "forest", "mountain", "island", "valley", "village", "tower", "orchard", "meadow", "canyon", "lagoon",
] as const;

// prettier-ignore
export const verbs = [
  "plans", "writes", "reviews", "ships", "tracks", "links", "sorts", "shapes", "measures", "tests",
  "drafts", "builds", "collects", "explains", "follows", "keeps", "moves", "opens", "records", "shares",
] as const;

// prettier-ignore
export const tags = [
  "project", "idea", "reading", "meeting", "person", "reference", "todo", "review", "health", "travel",
  "area/work", "area/home", "area/research", "area/writing", "status/active", "status/done", "status/waiting",
] as const;

export const languages = ["ts", "go", "sql", "json", "yaml", "sh"] as const;

export const calloutKinds = ["note", "tip", "warning", "info", "question"] as const;
